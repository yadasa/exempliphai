import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs';

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

test('formSnapshot: bundled unit tests pass (linkedom fixture)', () => {
  const src = fs.readFileSync(new URL('../public/contentScripts/formSnapshot.js', import.meta.url), 'utf8');

  const { window } = parseHTML('<html><body></body></html>');

  // Minimal polyfills used by formSnapshot
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
  vm.runInContext(src, ctx, { filename: 'formSnapshot.js' });

  assert.ok(ctx.__SmartApply?.formSnapshot, 'formSnapshot should attach to __SmartApply.formSnapshot');
  assert.equal(typeof ctx.__SmartApply.formSnapshot.runUnitTests, 'function');

  const ok = ctx.__SmartApply.formSnapshot.runUnitTests();
  assert.equal(ok, true);
});
