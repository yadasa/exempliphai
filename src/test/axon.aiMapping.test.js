import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

import { validateFillPlan } from '../public/contentScripts/fillPlanValidator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFromRepo(rel) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function buildVmForAtsFixture(html) {
  const { window } = parseHTML(html);

  window.getComputedStyle =
    window.getComputedStyle || (() => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  window.CSS = window.CSS || {};
  window.CSS.escape =
    window.CSS.escape || ((s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, (m) => `\\${m}`));

  const ctx = { console };
  Object.assign(ctx, window);
  ctx.window = ctx;
  ctx.document = window.document;
  ctx.globalThis = ctx;
  ctx.getComputedStyle = window.getComputedStyle;
  ctx.CSS = window.CSS;

  // Provide validator + provider stubs for aiFillPlan
  ctx.__exempliphaiFillPlan = { validate: validateFillPlan };

  const calls = [];
  ctx.__exempliphaiProviders = {
    gemini: {
      mapFieldsToFillPlan: async (args) => {
        calls.push(args);

        // Return actions for whatever fields the orchestrator passes.
        const actions = (args.unresolvedFields || []).map((f, i) => {
          const label = String(f?.descriptor?.label || '').toLowerCase();
          const fp = f.field_fingerprint;

          // Map the authorization question to a profile key.
          if (label.includes('authorization to work') || label.includes('authorized to work')) {
            return {
              action_id: `a_${i}`,
              field_fingerprint: fp,
              descriptor: f.descriptor,
              value: { source: 'profile', source_key: 'Legally Authorized to Work' },
              apply: { mode: 'set_value', allow_overwrite: false },
              confidence: 0.9,
            };
          }

          // Default: skip
          return {
            action_id: `a_${i}`,
            field_fingerprint: fp,
            descriptor: f.descriptor,
            value: { source: 'skip' },
          };
        });

        return {
          version: '0.1',
          plan_id: 'p1',
          created_at: new Date().toISOString(),
          domain: args.domain,
          page_url: args.pageUrl,
          provider: { name: 'gemini', model: 'stub' },
          snapshot_hash: args.snapshotHash,
          actions,
        };
      },
    },
  };

  vm.createContext(ctx);

  const utilsSrc = readFromRepo('src/public/contentScripts/utils.js');
  const formSnapshotSrc = readFromRepo('src/public/contentScripts/formSnapshot.js');
  const policySrc = readFromRepo('src/public/contentScripts/policy.js');
  const fillExecutorSrc = readFromRepo('src/public/contentScripts/fillExecutor.js');
  const aiFillPlanSrc = readFromRepo('src/public/contentScripts/aiFillPlan.js');

  vm.runInContext(utilsSrc, ctx, { filename: 'utils.js' });
  vm.runInContext(formSnapshotSrc, ctx, { filename: 'formSnapshot.js' });
  vm.runInContext(policySrc, ctx, { filename: 'policy.js' });
  vm.runInContext(fillExecutorSrc, ctx, { filename: 'fillExecutor.js' });
  vm.runInContext(aiFillPlanSrc, ctx, { filename: 'aiFillPlan.js' });

  assert.ok(ctx.__SmartApply?.formSnapshot);
  assert.ok(ctx.__SmartApply?.policy);
  assert.ok(ctx.__SmartApply?.fillExecutor);
  assert.ok(ctx.__SmartApply?.aiFillPlan);

  return { ctx, calls };
}

test('fixture: axon.html — custom question can be filled via AI mapping while consent-like ack field is excluded', async () => {
  const html = readFromRepo('examples/greenhouse/axon.html');
  const { ctx, calls } = buildVmForAtsFixture(html);

  const form = ctx.document.querySelector('#application-form');
  assert.ok(form);

  const authInput = ctx.document.querySelector('input#question_29774312003');
  assert.ok(authInput);
  authInput.value = '';
  authInput.setAttribute('value', '');

  const ackInput = ctx.document.querySelector('input#question_29774316003');
  assert.ok(ackInput);
  ackInput.value = '';
  ackInput.setAttribute('value', '');

  const fsnap = ctx.__SmartApply.formSnapshot;
  const fpAuth = fsnap.stableFingerprint(authInput, { root: form });
  const fpAck = fsnap.stableFingerprint(ackInput, { root: form });

  const snapshot = {
    domain: 'job-boards.greenhouse.io',
    page_url: 'https://job-boards.greenhouse.io/axon/jobs/7638856003',
    snapshot_hash: 'sha256:axon',
    unresolved_fields: [
      {
        field_fingerprint: fpAuth,
        control: { kind: 'combobox', tag: 'input', role: 'combobox', id: authInput.id },
        descriptor: {
          label: fsnap.computeBestLabel(authInput),
          section: 'Application Questions',
          required: true,
          options: ['Yes', 'No'],
        },
      },
      {
        field_fingerprint: fpAck,
        control: { kind: 'combobox', tag: 'input', role: 'combobox', id: ackInput.id },
        descriptor: {
          label: fsnap.computeBestLabel(ackInput) || 'ACKNOWLEDGMENT OF RECEIPT AND REVIEW',
          section: 'Application Questions',
          required: true,
          options: ['Acknowledge'],
        },
      },
    ],
  };

  const tier1 = await ctx.__SmartApply.aiFillPlan.generateTier1(
    snapshot,
    ['Legally Authorized to Work', 'Job Notice Period'],
    { apiKey: 'k', allowAiMapping: true }
  );

  assert.equal(tier1.ok, true, JSON.stringify(tier1.error || null));

  // Provider should only see non-consent fields.
  assert.equal(calls.length, 1);
  const seenFps = new Set((calls[0].unresolvedFields || []).map((f) => f.field_fingerprint));
  assert.ok(seenFps.has(fpAuth));
  assert.ok(!seenFps.has(fpAck), 'Consent-like ACK field should be filtered before provider call');

  const v = validateFillPlan(tier1.plan);
  assert.equal(v.ok, true, JSON.stringify(v.errors || null));

  const profile = { 'Legally Authorized to Work': 'Yes' };

  const execRes = await ctx.__SmartApply.fillExecutor.execute(tier1.plan, {
    root: form,
    profile,
    force: true,
  });

  assert.equal(execRes.applied, 1);
  assert.equal(authInput.value, 'Yes');
  assert.equal(ackInput.value, '', 'ACK field should remain unchanged');
});
