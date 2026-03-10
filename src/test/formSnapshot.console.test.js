import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs';

function createRecordingConsole() {
  const calls = [];
  return {
    calls,
    log: (...args) => calls.push({ level: 'log', args }),
    warn: (...args) => calls.push({ level: 'warn', args }),
    error: (...args) => calls.push({ level: 'error', args }),
    assert: (cond, msg) => {
      if (!cond) throw new Error(msg || 'console.assert failed');
    },
  };
}

test('autofill: logs AI-prompt-ready form snapshot JSON on page load', () => {
  const formSnapshotSrc = fs.readFileSync(
    new URL('../public/contentScripts/formSnapshot.js', import.meta.url),
    'utf8'
  );
  const autofillSrc = fs.readFileSync(
    new URL('../public/contentScripts/autofill.js', import.meta.url),
    'utf8'
  );

  const { window } = parseHTML(`
    <html><body>
      <form id="application-form">
        <div>
          <label for="fn">First Name</label>
          <input id="fn" name="first_name" autocomplete="given-name" />
        </div>

        <div>
          <label for="yrs">Years of Experience</label>
          <select id="yrs" name="years">
            <option value="">Select…</option>
            <option value="0-1">0-1</option>
            <option value="1-3">1-3</option>
          </select>
        </div>

        <fieldset>
          <legend>Work Authorization</legend>
          <label><input type="radio" name="auth" value="Yes" />Yes</label>
          <label><input type="radio" name="auth" value="No" />No</label>
        </fieldset>
      </form>
    </body></html>
  `);

  // Minimal polyfills used by formSnapshot
  window.getComputedStyle =
    window.getComputedStyle || (() => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  window.CSS = window.CSS || {};
  window.CSS.escape =
    window.CSS.escape || ((s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, (m) => `\\${m}`));

  const recConsole = createRecordingConsole();

  const ctx = { console: recConsole };
  Object.assign(ctx, window);

  // linkedom's event methods are non-enumerable; wire them explicitly.
  ctx.addEventListener = window.addEventListener?.bind(window);
  ctx.removeEventListener = window.removeEventListener?.bind(window);
  ctx.dispatchEvent = window.dispatchEvent?.bind(window);
  ctx.Event = window.Event;

  ctx.window = ctx;
  ctx.document = window.document;
  ctx.globalThis = ctx;
  ctx.getComputedStyle = window.getComputedStyle;
  ctx.CSS = window.CSS;

  vm.createContext(ctx);
  vm.runInContext(formSnapshotSrc, ctx, { filename: 'formSnapshot.js' });
  vm.runInContext(autofillSrc, ctx, { filename: 'autofill.js' });

  // Prevent the rest of autofill.js load handler from running complex logic.
  ctx.setupLongTextareaHints = () => {};
  ctx.injectAutofillNowButton = () => {};
  ctx.awaitForm = () => {};

  const Ev = ctx.Event || window.Event;
  ctx.dispatchEvent(new Ev('load'));

  const snapshotCall = recConsole.calls.find(
    (c) => c.level === 'log' && c.args && String(c.args[0] || '').includes('SmartApply: Form Snapshot JSON:')
  );
  assert.ok(snapshotCall, 'Should console.log the SmartApply: Form Snapshot JSON: message');

  const jsonStr = snapshotCall.args[1];
  assert.equal(typeof jsonStr, 'string');

  const parsed = JSON.parse(jsonStr);
  assert.ok(Array.isArray(parsed), 'Snapshot should be a JSON array');

  // Ensure the example options are included (AI-prompt-ready)
  const yrs = parsed.find((c) => c && c.control && c.control.id === 'yrs');
  assert.ok(yrs, 'Snapshot should include the select control');
  assert.ok(
    Array.isArray(yrs.options) && yrs.options.some((o) => o && (o.label === '0-1' || o.value === '0-1')),
    'Snapshot should include select options (e.g., 0-1)'
  );

  const auth = parsed.find((c) => c && c.kind === 'radio-group');
  assert.ok(auth, 'Snapshot should include a radio-group descriptor');
  assert.ok(
    Array.isArray(auth.options) && auth.options.some((o) => o && o.value === 'Yes'),
    'Snapshot should include radio-group options (Yes/No)'
  );
});
