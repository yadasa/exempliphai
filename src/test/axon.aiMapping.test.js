import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

import { mapUnresolvedFieldsToFillPlan } from '../public/contentScripts/aiFillPlan.js';
import { buildFingerprintIndex, applyFillPlan } from '../public/contentScripts/fillExecutor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

function loadFormSnapshotIntoContext(window) {
  const src = fs.readFileSync(new URL('../public/contentScripts/formSnapshot.js', import.meta.url), 'utf8');

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

  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'formSnapshot.js' });

  assert.ok(ctx.__SmartApply?.formSnapshot);
  return ctx.__SmartApply.formSnapshot;
}

function stubSetNativeValue(el, value) {
  // Minimal for linkedom
  // @ts-ignore
  el.value = String(value ?? '');
  try {
    el.setAttribute('value', String(value ?? ''));
  } catch (_) {}
  return true;
}

test('hybrid AI mapping (fixture: axon.html): fills a custom authorization question via FillPlan + blocks consent-like ack field', async () => {
  const html = readFixture('examples/greenhouse/axon.html');
  const { window, document } = parseHTML(html);

  const formSnapshot = loadFormSnapshotIntoContext(window);

  const form = document.querySelector('#application-form');
  assert.ok(form);

  const authInput = document.querySelector('input#question_29774312003');
  assert.ok(authInput);

  // Simulate an unresolved empty field (fixture HTML contains historical misfill values).
  authInput.value = '';
  authInput.setAttribute('value', '');

  const labelAuth = formSnapshot.computeBestLabel(authInput);
  assert.ok(labelAuth.toLowerCase().includes('authorization to work'));

  const fpAuth = formSnapshot.stableFingerprint(authInput, { root: form });
  assert.ok(fpAuth.startsWith('fp:'));

  const ackInput = document.querySelector('input#question_29774316003');
  assert.ok(ackInput);
  ackInput.value = '';
  ackInput.setAttribute('value', '');

  const fpAck = formSnapshot.stableFingerprint(ackInput, { root: form });

  // Stub provider returns a plan mapping:
  // - auth question -> profile key
  // - ack field (consent-like) -> tries to fill (should be blocked by policy)
  const provider = {
    async mapFieldsToFillPlan() {
      return {
        version: '0.1',
        plan_id: 'p1',
        created_at: new Date().toISOString(),
        domain: 'job-boards.greenhouse.io',
        page_url: 'https://job-boards.greenhouse.io/axon/jobs/7638856003',
        provider: { name: 'gemini', model: 'stub' },
        actions: [
          {
            action_id: 'a_auth',
            field_fingerprint: fpAuth,
            value: { source: 'profile', source_key: 'Legally Authorized to Work' },
            apply: { mode: 'set_value', allow_overwrite: false },
            confidence: 0.9,
            reason: 'authorization to work -> Legally Authorized to Work',
          },
          {
            action_id: 'a_ack',
            field_fingerprint: fpAck,
            value: { source: 'profile', source_key: 'Job Notice Period' },
            apply: { mode: 'set_value', allow_overwrite: false },
            confidence: 0.8,
            reason: 'should be blocked: acknowledgement',
          },
        ],
      };
    },
  };

  const unresolvedFields = [
    {
      field_fingerprint: fpAuth,
      control: { kind: 'combobox', tag: 'input', type: 'text', role: 'combobox', id: authInput.id },
      descriptor: { label: labelAuth, required: true, visible: true, options: ['Yes', 'No'] },
    },
  ];

  const plan = await mapUnresolvedFieldsToFillPlan({
    provider,
    providerName: 'gemini',
    domain: 'job-boards.greenhouse.io',
    pageUrl: 'https://job-boards.greenhouse.io/axon/jobs/7638856003',
    allowedProfileKeys: ['Legally Authorized to Work', 'Job Notice Period'],
    unresolvedFields,
  });

  const index = buildFingerprintIndex({
    root: form,
    findControls: formSnapshot.findControls,
    stableFingerprint: (el) => formSnapshot.stableFingerprint(el, { root: form }),
  });

  const profile = {
    'Legally Authorized to Work': 'Yes',
    'Job Notice Period': '2 weeks',
  };

  const report = await applyFillPlan({
    plan,
    root: form,
    profile,
    index,
    formSnapshot,
    allowSensitive: false,
    defaultAllowOverwrite: false,
    setNativeValue: stubSetNativeValue,
  });

  assert.equal(authInput.value, 'Yes');
  assert.equal(ackInput.value, '', 'Consent-like ACK field should not be filled');

  assert.equal(report.applied, 1);
  assert.ok(report.details.some((d) => d.fp === fpAck && d.reason?.includes('consent')));
});
