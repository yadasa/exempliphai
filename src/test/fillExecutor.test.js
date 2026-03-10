import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFromRepo(rel) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function createThrowingConsole() {
  return {
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    assert: (cond, msg) => {
      if (!cond) throw new Error(msg || 'console.assert failed');
    },
  };
}

function buildVmForFixture(html) {
  const { window } = parseHTML(html);

  // Polyfills used by formSnapshot / fingerprint resolution
  window.getComputedStyle =
    window.getComputedStyle || (() => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  window.CSS = window.CSS || {};
  window.CSS.escape =
    window.CSS.escape || ((s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, (m) => `\\${m}`));

  const ctx = { console: createThrowingConsole() };
  Object.assign(ctx, window);
  ctx.window = ctx;
  ctx.document = window.document;
  ctx.globalThis = ctx;
  ctx.getComputedStyle = window.getComputedStyle;
  ctx.CSS = window.CSS;

  vm.createContext(ctx);

  const utilsSrc = readFromRepo('src/public/contentScripts/utils.js');
  const formSnapshotSrc = readFromRepo('src/public/contentScripts/formSnapshot.js');
  const fillExecutorSrc = readFromRepo('src/public/contentScripts/fillExecutor.js');

  // Sanity: we are evaluating classic scripts (not ESM) inside vm.
  assert.equal(/\bimport\s/.test(utilsSrc), false, 'utils.js should not contain ESM import');
  assert.equal(/\bexport\s/.test(utilsSrc), false, 'utils.js should not contain ESM export');
  assert.equal(/\bimport\s/.test(formSnapshotSrc), false, 'formSnapshot.js should not contain ESM import');
  assert.equal(/\bexport\s/.test(formSnapshotSrc), false, 'formSnapshot.js should not contain ESM export');
  assert.equal(/\bimport\s/.test(fillExecutorSrc), false, 'fillExecutor.js should not contain ESM import');
  assert.equal(/\bexport\s/.test(fillExecutorSrc), false, 'fillExecutor.js should not contain ESM export');

  vm.runInContext(utilsSrc, ctx, { filename: 'utils.js' });
  vm.runInContext(formSnapshotSrc, ctx, { filename: 'formSnapshot.js' });
  vm.runInContext(fillExecutorSrc, ctx, { filename: 'fillExecutor.js' });

  assert.ok(ctx.__SmartApply?.formSnapshot, 'formSnapshot should attach');
  assert.ok(ctx.__SmartApply?.fillExecutor, 'fillExecutor should attach');

  return ctx;
}

test('fillExecutor: set_value + audit + undoAll', async () => {
  const html = readFromRepo('examples/fixtures/executor-basic.html');
  const ctx = buildVmForFixture(html);

  const root = ctx.document.getElementById('app');
  const first = ctx.document.getElementById('first');
  const ce = ctx.document.getElementById('ce');

  assert.equal(first.value, 'OldFirst');
  assert.equal(ce.textContent.trim(), 'Old CE');

  const fpFirst = ctx.__SmartApply.formSnapshot.stableFingerprint(first, { root });
  const fpCe = ctx.__SmartApply.formSnapshot.stableFingerprint(ce, { root });

  const plan = {
    version: '0.1',
    plan_id: 't1',
    created_at: new Date().toISOString(),
    domain: 'example.test',
    page_url: 'https://example.test/form',
    actions: [
      {
        action_id: 'a1',
        field_fingerprint: fpFirst,
        control: { kind: 'input', id: 'first' },
        value: { source: 'literal', literal: 'NewFirst' },
        apply: { mode: 'set_value', allow_overwrite: true },
        confidence: 0.99,
      },
      {
        action_id: 'a2',
        field_fingerprint: fpCe,
        control: { kind: 'contenteditable', id: 'ce' },
        value: { source: 'literal', literal: 'New CE' },
        apply: { mode: 'set_value', allow_overwrite: true },
        confidence: 0.99,
      },
    ],
  };

  const res = await ctx.__SmartApply.fillExecutor.execute(plan, { root });
  assert.equal(res.applied, 2);

  assert.equal(first.value, 'NewFirst');
  assert.equal(ce.textContent, 'New CE');

  const r1 = res.results.find((r) => r.action_id === 'a1');
  const r2 = res.results.find((r) => r.action_id === 'a2');
  assert.ok(r1.old_hash && r1.new_hash);
  assert.ok(r2.old_hash && r2.new_hash);
  assert.notEqual(r1.old_hash, r1.new_hash);
  assert.notEqual(r2.old_hash, r2.new_hash);

  const undoRes = ctx.__SmartApply.fillExecutor.undoAll();
  assert.equal(undoRes.ok, true);
  assert.equal(first.value, 'OldFirst');
  assert.equal(ce.textContent.trim(), 'Old CE');
});

test('fillExecutor: select_best_option + undo', async () => {
  const html = readFromRepo('examples/fixtures/executor-basic.html');
  const ctx = buildVmForFixture(html);

  const root = ctx.document.getElementById('app');
  const role = ctx.document.getElementById('role');

  assert.equal(role.value, 'b');

  const fpRole = ctx.__SmartApply.formSnapshot.stableFingerprint(role, { root });

  const plan = {
    version: '0.1',
    plan_id: 't2',
    created_at: new Date().toISOString(),
    domain: 'example.test',
    page_url: 'https://example.test/form',
    actions: [
      {
        action_id: 's1',
        field_fingerprint: fpRole,
        control: { kind: 'select', id: 'role' },
        value: { source: 'literal', literal: 'Option A' },
        apply: { mode: 'select_best_option', allow_overwrite: true },
        confidence: 0.9,
      },
    ],
  };

  const res = await ctx.__SmartApply.fillExecutor.execute(plan, { root });
  assert.equal(res.applied, 1);
  assert.equal(role.value, 'a');

  ctx.__SmartApply.fillExecutor.undoAll();
  assert.equal(role.value, 'b');
});

test('fillExecutor: confidence threshold skips unless force', async () => {
  const html = readFromRepo('examples/fixtures/executor-basic.html');
  const ctx = buildVmForFixture(html);

  const root = ctx.document.getElementById('app');
  const first = ctx.document.getElementById('first');
  const fpFirst = ctx.__SmartApply.formSnapshot.stableFingerprint(first, { root });

  const plan = {
    version: '0.1',
    plan_id: 't3',
    created_at: new Date().toISOString(),
    domain: 'example.test',
    page_url: 'https://example.test/form',
    actions: [
      {
        action_id: 'c1',
        field_fingerprint: fpFirst,
        control: { kind: 'input', id: 'first' },
        value: { source: 'literal', literal: 'LowConf' },
        apply: { mode: 'set_value', allow_overwrite: true },
        confidence: 0.5,
      },
    ],
  };

  const res1 = await ctx.__SmartApply.fillExecutor.execute(plan, { root, force: false });
  assert.equal(res1.applied, 0);
  assert.equal(res1.results[0].status, 'skipped_confidence');
  assert.equal(first.value, 'OldFirst');

  const res2 = await ctx.__SmartApply.fillExecutor.execute(plan, { root, force: true });
  assert.equal(res2.applied, 1);
  assert.equal(first.value, 'LowConf');
});

test('fillExecutor: merges deterministic + AI plans (dedupe fingerprints, deterministic wins)', async () => {
  const html = readFromRepo('examples/fixtures/executor-basic.html');
  const ctx = buildVmForFixture(html);

  const root = ctx.document.getElementById('app');
  const first = ctx.document.getElementById('first');
  const fpFirst = ctx.__SmartApply.formSnapshot.stableFingerprint(first, { root });

  const deterministicPlan = {
    actions: [
      {
        action_id: 'd1',
        field_fingerprint: fpFirst,
        control: { kind: 'input', id: 'first' },
        value: { source: 'literal', literal: 'DetValue' },
        apply: { mode: 'set_value', allow_overwrite: true },
        confidence: 0.8,
      },
    ],
  };

  const aiPlan = {
    actions: [
      {
        action_id: 'ai1',
        field_fingerprint: fpFirst,
        control: { kind: 'input', id: 'first' },
        value: { source: 'literal', literal: 'AiValue' },
        apply: { mode: 'set_value', allow_overwrite: true },
        confidence: 0.99,
      },
    ],
  };

  const res = await ctx.__SmartApply.fillExecutor.execute(
    { deterministicPlan, aiPlan },
    { root, force: true, preferMerge: 'deterministic' }
  );

  assert.equal(res.applied, 1);
  assert.equal(first.value, 'DetValue');
});
