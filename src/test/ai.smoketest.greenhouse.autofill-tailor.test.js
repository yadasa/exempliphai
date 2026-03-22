import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';
import vm from 'node:vm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

function buildVmForGreenhouseFixture(html, { hostname } = {}) {
  const { window } = parseHTML(html);

  // Ensure stable location fields
  window.location = window.location || {};
  window.location.hostname = hostname || 'job-boards.greenhouse.io';
  window.location.href = window.location.href || `https://${window.location.hostname}/jobs/1`;

  // Add a job description via meta tag (works even when the fixture HTML has no <body>/<head> wrapper).
  const jdText =
    'This is a test job description. '.repeat(20) +
    'Responsibilities include building reliable browser automation, integrating AI providers safely, and writing tests.';

  const meta = window.document.createElement('meta');
  meta.setAttribute('name', 'description');
  meta.setAttribute('content', jdText);

  // Prefer attaching at document root so it is not inside the <form>.
  try {
    window.document.appendChild(meta);
  } catch (_) {
    // ignore
  }

  const localStore = Object.create(null);
  const syncStore = Object.create(null);

  const chrome = {
    runtime: {
      lastError: null,
      sendMessage: (msg, cb) => {
        try {
          if (msg?.action !== 'SMARTAPPLY_GEMINI_FETCH') {
            cb?.({ ok: false, error: 'unsupported_action' });
            return;
          }

          const url = String(msg?.url || '');
          let body = {};
          try {
            body = msg?.body ? JSON.parse(String(msg.body)) : {};
          } catch (_) {
            body = {};
          }

          const usageMetadata = {
            promptTokenCount: 10,
            candidatesTokenCount: 20,
            totalTokenCount: 30,
          };

          // Deep tasks use gemini-pro; return JSON.
          if (url.includes('/gemini-pro:generateContent')) {
            const tailored = {
              tailored_resume_text: 'TAILORED_RESUME_TEXT',
              tailored_resume_details: {
                skills: ['JavaScript', 'Browser Extensions'],
                experiences: [
                  {
                    jobTitle: 'Engineer',
                    jobEmployer: 'Acme',
                    jobDuration: '1y',
                    isCurrentEmployer: false,
                    roleBulletsString: '• Built reliable extension automation',
                  },
                ],
                certifications: [],
              },
              keywordsAdded: ['extensions'],
              changesDescription: 'Aligned resume to job description.',
            };

            cb?.({
              ok: true,
              status: 200,
              json: {
                candidates: [
                  {
                    content: {
                      parts: [{ text: JSON.stringify(tailored) }],
                    },
                  },
                ],
                usageMetadata,
              },
            });
            return;
          }

          // Quick tasks use flash; return plain answer.
          cb?.({
            ok: true,
            status: 200,
            json: {
              candidates: [
                {
                  content: {
                    parts: [{ text: 'AI_ANSWER' }],
                  },
                },
              ],
              usageMetadata,
            },
          });
        } catch (e) {
          cb?.({ ok: false, error: String(e?.message || e) });
        }
      },
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const out = {};
          const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
          for (const k of list) out[k] = localStore[k];
          cb?.(out);
        },
        set: (obj, cb) => {
          Object.assign(localStore, obj || {});
          cb?.();
        },
      },
      sync: {
        get: (keys, cb) => {
          const out = {};
          const list = Array.isArray(keys) ? keys : Object.keys(keys || {});
          for (const k of list) out[k] = syncStore[k];
          cb?.(out);
        },
        set: (obj, cb) => {
          Object.assign(syncStore, obj || {});
          cb?.();
        },
      },
    },
  };

  // Seed stores
  syncStore['API Key'] = 'TEST_KEY';
  syncStore.autoTailorResumes = true;
  localStore.Resume_details = JSON.stringify({ skills: ['JavaScript'], experiences: [], certifications: [] });

  const logs = [];
  const ctx = {
    console: {
      log: (...a) => logs.push(['log', ...a].join(' ')),
      warn: (...a) => logs.push(['warn', ...a].join(' ')),
      error: (...a) => logs.push(['error', ...a].join(' ')),
      trace: (...a) => logs.push(['trace', ...a].join(' ')),
    },
    setTimeout,
    clearTimeout,
    Date,
    WeakSet,
    Map,
    Set,
    Promise,
    chrome,

    // Hard-fail if anything tries to do a direct network fetch during the test.
    fetch: () => {
      throw new Error('direct fetch should not be used in content-script AI calls');
    },

    // Minimal globals expected by autofill.js
    normalizeText: (s) => String(s || '').trim().toLowerCase(),
    matchScore: (a, b) => (String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase() ? 100 : 0),
    sleep: async () => {},
    delays: { initial: 0, short: 0 },
    curDateStr: () => '2026-03-22',
    setNativeValue: (el, val) => {
      el.value = String(val ?? '');
    },
    dispatchInputAndChange: () => {},
    alert: () => {
      throw new Error('alert() should not be called in tests');
    },

    getStorageDataSync: async () => ({ ...syncStore }),
    getStorageDataLocal: async (keys) => {
      const out = {};
      for (const k of keys || []) out[k] = localStore[k];
      return out;
    },
  };

  Object.assign(ctx, window);

  // autofill.js registers event listeners on window.
  ctx.addEventListener = ctx.addEventListener || (() => {});
  ctx.removeEventListener = ctx.removeEventListener || (() => {});

  ctx.window = ctx;
  ctx.document = window.document;
  ctx.globalThis = ctx;

  vm.createContext(ctx);

  // Load Gemini provider first (as the manifest would).
  const geminiClassicSrc = readFixture('src/public/contentScripts/providers/gemini.classic.js');
  vm.runInContext(geminiClassicSrc, ctx, { filename: 'gemini.classic.js' });

  const autofillSrc = readFixture('src/public/contentScripts/autofill.js');
  vm.runInContext(autofillSrc, ctx, { filename: 'autofill.js' });

  // Prevent test flakiness from storage logging.
  ctx._saAppendAiUsageLog = async () => {};
  ctx._saAppendAuditLog = async () => {};

  return { ctx, logs, localStore, syncStore };
}

test('smoke (greenhouse fixture): AI answer uses classic gemini provider + background proxy', async () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { ctx } = buildVmForGreenhouseFixture(html, { hostname: 'job-boards.greenhouse.io' });

  const el = ctx.document.getElementById('question_29351266003');
  assert.ok(el, 'fixture should include the long-form textarea');

  await ctx._saGenerateAiAnswer(el, { noAlert: true, quiet: true });
  assert.equal(el.value, 'AI_ANSWER');
});

test('smoke (greenhouse fixture): auto-tailor calls gemini provider deep + saves tailored resume details', async () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { ctx, localStore, syncStore } = buildVmForGreenhouseFixture(html, { hostname: 'job-boards.greenhouse.io' });

  const ctx0 = ctx._saExtractJobContextFromPage();
  assert.ok(String(ctx0?.jobDescription || '').length >= 180, 'test harness should inject a detectable job description');

  const r = await ctx._saMaybeAutoTailorResume(syncStore);
  assert.equal(!!r?.ok, true);

  // Should have written tailored_resume_details
  assert.ok(localStore.tailored_resume_details, 'should save tailored resume details to local storage');

  // Should set preferred resume details for this run.
  assert.ok(ctx.__SmartApplyResumeDetailsForFill, 'should set __SmartApplyResumeDetailsForFill');
});
