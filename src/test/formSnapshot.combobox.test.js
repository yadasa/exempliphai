import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import vm from 'node:vm';
import fs from 'node:fs';

function createThrowingConsole() {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
    assert: (cond, msg) => {
      if (!cond) throw new Error(msg || 'console.assert failed');
    },
  };
}

function loadFormSnapshotWithHtml(html) {
  const formSnapshotSrc = fs.readFileSync(
    new URL('../public/contentScripts/formSnapshot.js', import.meta.url),
    'utf8'
  );

  const { window } = parseHTML(`<html><body>${html}</body></html>`);

  // Minimal polyfills used by formSnapshot
  window.getComputedStyle =
    window.getComputedStyle || (() => ({ display: 'block', visibility: 'visible', opacity: '1' }));
  window.CSS = window.CSS || {};
  window.CSS.escape =
    window.CSS.escape || ((s) => String(s).replace(/[^a-zA-Z0-9_\-]/g, (m) => `\\${m}`));

  // linkedom may report empty client rects; avoid treating everything as hidden.
  try {
    const proto = window.HTMLElement && window.HTMLElement.prototype;
    if (proto) {
      proto.getClientRects = () => [{ x: 0, y: 0, width: 1, height: 1 }];
    }
  } catch (_) {}

  const ctx = { console: createThrowingConsole() };
  Object.assign(ctx, window);
  ctx.window = ctx;
  ctx.document = window.document;
  ctx.globalThis = ctx;
  ctx.getComputedStyle = window.getComputedStyle;
  ctx.CSS = window.CSS;

  vm.createContext(ctx);
  vm.runInContext(formSnapshotSrc, ctx, { filename: 'formSnapshot.js' });

  assert.ok(ctx.__SmartApply?.formSnapshot, 'formSnapshot should attach to __SmartApply.formSnapshot');
  return ctx;
}

function installMockReactSelectOpenHandlers(ctx, input, { options, listboxId } = {}) {
  const doc = ctx.document;
  const lbId = listboxId || `react-select-${input.id}-listbox`;

  function open() {
    input.setAttribute('aria-expanded', 'true');

    // Simulate a widget mutating the input while opening (we must restore).
    input.value = 'CHANGED_BY_WIDGET';
    try {
      input.setSelectionRange(0, input.value.length);
    } catch (_) {}

    if (doc.getElementById(lbId)) return;
    const listbox = doc.createElement('div');
    listbox.id = lbId;
    listbox.setAttribute('role', 'listbox');
    listbox.className = 'select__menu-list';

    for (const opt of options || []) {
      const o = doc.createElement('div');
      o.className = 'select__option';
      o.setAttribute('role', 'option');
      o.setAttribute('data-value', opt);
      o.textContent = opt;
      listbox.appendChild(o);
    }

    doc.body.appendChild(listbox);
  }

  function close() {
    input.setAttribute('aria-expanded', 'false');
    const listbox = doc.getElementById(lbId);
    if (listbox) listbox.remove();
  }

  input.addEventListener('keydown', (e) => {
    const key = e && (e.key || e.code || '');
    const keyCode = e && (e.keyCode || e.which);

    if (key === 'ArrowRight' || keyCode === 39) open();
    if ((key === 'Enter' || key === 'NumpadEnter' || keyCode === 13) && e.shiftKey) open();
    if (key === 'Escape' || keyCode === 27) close();
  });
}

test('formSnapshot combobox: extracts dynamic options via open/close without changing input value', () => {
  const ctx = loadFormSnapshotWithHtml(`
    <form id="f">
      <label id="exp-label" for="exp">Years of experience</label>
      <div class="select-shell">
        <input id="exp" role="combobox" aria-expanded="false" aria-labelledby="exp-label" value="ORIGINAL" />
      </div>
    </form>
  `);

  const form = ctx.document.querySelector('#f');
  const input = ctx.document.querySelector('#exp');
  assert.ok(form && input);

  installMockReactSelectOpenHandlers(ctx, input, {
    options: ['0-1 years', '1-3 years', '3-5 years', '5+ years'],
  });

  const snapshot = ctx.__SmartApply.formSnapshot.findControls(form);
  const c = snapshot.find((x) => x && x.kind === 'combobox' && x.control && x.control.id === 'exp');
  assert.ok(c, 'snapshot should include the combobox');

  assert.equal(c.dynamicOptions, true, 'combobox descriptor should mark dynamicOptions when opened');
  assert.ok(Array.isArray(c.options) && c.options.length >= 4, 'should extract combobox options');
  assert.ok(c.options.some((o) => o && o.label === '0-1 years'), 'should include expected option label');

  // Non-destructive: value restored and listbox removed/closed.
  assert.equal(input.value, 'ORIGINAL');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(ctx.document.querySelectorAll('[role="listbox"]').length, 0);
});

test('formSnapshot combobox: xapo fixture can capture dynamic options for years + salary (mock open)', () => {
  const html = fs.readFileSync(new URL('../../examples/greenhouse/xapo.html', import.meta.url), 'utf8');
  const ctx = loadFormSnapshotWithHtml(html);

  const form = ctx.document.querySelector('#application-form') || ctx.document.querySelector('form');
  assert.ok(form, 'fixture should contain a form');

  const years = ctx.document.querySelector('#question_29351026003');
  const salary = ctx.document.querySelector('#question_29351044003');
  assert.ok(years && salary, 'fixture should contain the expected combobox inputs');

  installMockReactSelectOpenHandlers(ctx, years, {
    listboxId: `react-select-${years.id}-listbox`,
    options: ['0-1 years', '1-3 years', '3-5 years', '5+ years'],
  });

  installMockReactSelectOpenHandlers(ctx, salary, {
    listboxId: `react-select-${salary.id}-listbox`,
    options: ['$50k-$75k', '$75k-$100k', '$100k-$150k', '$150k+'],
  });

  const snapshot = ctx.__SmartApply.formSnapshot.findControls(form);

  const yearsCtl = snapshot.find((c) => c && c.control && c.control.id === 'question_29351026003');
  assert.ok(yearsCtl, 'snapshot should include years-of-experience combobox');
  assert.equal(yearsCtl.dynamicOptions, true);
  assert.ok(Array.isArray(yearsCtl.options) && yearsCtl.options.some((o) => o && o.label === '0-1 years'));

  const salaryCtl = snapshot.find((c) => c && c.control && c.control.id === 'question_29351044003');
  assert.ok(salaryCtl, 'snapshot should include salary expectations combobox');
  assert.equal(salaryCtl.dynamicOptions, true);
  assert.ok(Array.isArray(salaryCtl.options) && salaryCtl.options.some((o) => o && o.label === '$100k-$150k'));
});
