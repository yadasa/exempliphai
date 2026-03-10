import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { parseHTML } from 'linkedom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readSource(relFromExempliphaiSrc) {
  const base = path.resolve(__dirname, '..'); // exempliphai/src
  return fs.readFileSync(path.join(base, relFromExempliphaiSrc), 'utf8');
}

function createSandboxWithDom(document, window) {
  const logs = [];
  const noop = () => {};

  const sandbox = {
    globalThis: {},
    window,
    document,
    console: {
      log: (...args) => logs.push(['log', args.join(' ')]),
      warn: (...args) => logs.push(['warn', args.join(' ')]),
      error: (...args) => logs.push(['error', args.join(' ')]),
    },
    setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Date,
    Intl,
    Array,
    Object,
    Set,
    Map,
    Math,
    Number,
    String,
    RegExp,
    JSON,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    atob: globalThis.atob || ((b) => Buffer.from(b, 'base64').toString('binary')),
    CSS: { escape: (s) => s },
    chrome: {
      runtime: { getURL: noop, onMessage: { addListener: noop }, sendMessage: noop },
      storage: { local: { get: noop, set: noop }, sync: { get: noop, set: noop } },
    },
    fetch: noop,
    alert: noop,
  };

  // linkedom implements Event (with internal fields required by dispatchEvent),
  // but not KeyboardEvent/MouseEvent. We polyfill them by *returning* a native
  // linkedom Event instance from the constructor.
  sandbox.Event = window.Event;
  sandbox.KeyboardEvent = class KeyboardEvent {
    constructor(type, init = {}) {
      const ev = new window.Event(type, init);
      Object.assign(ev, init || {});
      return ev;
    }
  };
  sandbox.MouseEvent = class MouseEvent {
    constructor(type, init = {}) {
      const ev = new window.Event(type, init);
      Object.assign(ev, init || {});
      return ev;
    }
  };

  sandbox.MutationObserver = window.MutationObserver || class MutationObserver { observe() {} };

  // Element/input constructors from linkedom for instanceof checks in utils/autofill.
  sandbox.Element = window.Element;
  sandbox.HTMLSelectElement = window.HTMLSelectElement;
  sandbox.HTMLTextAreaElement = window.HTMLTextAreaElement;
  sandbox.HTMLInputElement = window.HTMLInputElement;

  // Make window === globalThis within the sandbox (classic content-script style)
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.document = document;
  sandbox.window.document = document;
  sandbox.addEventListener = noop;
  sandbox.location = { hostname: 'job-boards.greenhouse.io', href: 'https://job-boards.greenhouse.io/xapo61/jobs/7572065003' };
  sandbox.history = { replaceState: noop, state: {} };
  sandbox.scrollTo = noop;

  vm.createContext(sandbox);
  return { sandbox, logs };
}

function attachMockReactSelect({ document, inputId, optionsText }) {
  const input = document.getElementById(inputId);
  assert.ok(input, 'input should exist');

  const shell = input.closest('.select-shell');
  assert.ok(shell, 'select-shell should exist');

  const valueContainer = shell.querySelector('.select__value-container') || shell;

  const listboxId = `react-select-${inputId}-listbox`;
  let open = false;
  let focusedIndex = -1;

  const buildListbox = (filter = '') => {
    const existing = document.getElementById(listboxId);
    if (existing) existing.remove();

    const lb = document.createElement('div');
    lb.id = listboxId;
    lb.setAttribute('role', 'listbox');

    const f = String(filter || '').toLowerCase().trim();
    const filtered = !f
      ? optionsText
      : optionsText.filter(t => String(t).toLowerCase().includes(f));

    for (let i = 0; i < filtered.length; i++) {
      const opt = document.createElement('div');
      opt.id = `${listboxId}-opt-${i}`;
      opt.setAttribute('role', 'option');
      opt.textContent = filtered[i];
      opt.setAttribute('aria-selected', 'false');
      lb.appendChild(opt);
    }

    shell.appendChild(lb);
    return lb;
  };

  const setFocused = (idx) => {
    const lb = document.getElementById(listboxId);
    if (!lb) return;
    const opts = Array.from(lb.querySelectorAll('[role="option"]'));
    if (!opts.length) return;

    focusedIndex = Math.max(0, Math.min(idx, opts.length - 1));

    for (let i = 0; i < opts.length; i++) {
      opts[i].setAttribute('aria-selected', i === focusedIndex ? 'true' : 'false');
    }

    input.setAttribute('aria-activedescendant', opts[focusedIndex].id);
  };

  const selectFocused = () => {
    const lb = document.getElementById(listboxId);
    if (!lb) return;
    const opts = Array.from(lb.querySelectorAll('[role="option"]'));
    if (focusedIndex < 0 || focusedIndex >= opts.length) return;

    // write selected value
    let single = valueContainer.querySelector('.select__single-value');
    if (!single) {
      single = document.createElement('div');
      single.className = 'select__single-value';
      valueContainer.appendChild(single);
    }
    single.textContent = opts[focusedIndex].textContent;

    // close
    open = false;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.removeAttribute('aria-controls');
    lb.remove();
  };

  const openMenu = () => {
    if (open) return;
    open = true;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', listboxId);
    buildListbox(input.value);
    focusedIndex = -1;
  };

  const closeMenu = () => {
    open = false;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.removeAttribute('aria-controls');
    const lb = document.getElementById(listboxId);
    if (lb) lb.remove();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') {
      openMenu();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      openMenu();
      return;
    }
    if (e.key === 'Escape') {
      closeMenu();
      return;
    }
    if (!open) return;

    if (e.key === 'ArrowDown') {
      if (focusedIndex < 0) setFocused(0);
      else setFocused(focusedIndex + 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (focusedIndex < 0) setFocused(0);
      else setFocused(focusedIndex - 1);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      selectFocused();
    }
  });

  const refilter = () => {
    if (!open) return;
    buildListbox(input.value);
    focusedIndex = -1;
  };
  input.addEventListener('input', refilter);
  input.addEventListener('change', refilter);

  return { input, shell, valueContainer };
}

test('xapo react-select: ArrowRight open → poll → best match → ArrowDown/Enter select', async () => {
  // Minimal xapo-like combobox DOM
  const html = `
    <html><body>
      <div class="select-shell remix-css-b62m3t-container">
        <div class="select__control remix-css-13cymwt-control">
          <div class="select__value-container remix-css-hlgwow">
            <div class="select__placeholder" id="react-select-question_29351026003-placeholder">Select...</div>
            <div class="select__input-container remix-css-19bb58m" data-value="">
              <input class="select__input" id="question_29351026003" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-haspopup="true" value="" />
            </div>
          </div>
          <div class="select__indicators">
            <button type="button">v</button>
          </div>
        </div>
      </div>
    </body></html>`;

  const { document, window } = parseHTML(html);

  attachMockReactSelect({
    document,
    inputId: 'question_29351026003',
    optionsText: ['0-1 years', '3-5 years', '6+ years', '10+ years'],
  });

  const { sandbox, logs } = createSandboxWithDom(document, window);

  // Evaluate utils.js first (setNativeValue, sleep, event factories)
  const utilsSrc = readSource('public/contentScripts/utils.js');
  vm.runInContext(utilsSrc, sandbox);

  // Then evaluate autofill.js (fillReactSelectKeyboard)
  const autofillSrc = readSource('public/contentScripts/autofill.js');
  vm.runInContext(autofillSrc, sandbox);

  assert.equal(typeof sandbox.fillReactSelectKeyboard, 'function', 'fillReactSelectKeyboard should be defined');

  const input = document.getElementById('question_29351026003');
  const ok = await sandbox.fillReactSelectKeyboard(input, '6', 'Years of experience', {
    timeoutMs: 3000,
    minScore: 40,
    tag: 'SmartApply: React-Select "Years of experience"',
  });

  assert.equal(ok, true, 'should select an option via keyboard');

  const selectedEl = document.querySelector('.select__single-value');
  assert.ok(selectedEl, 'should render a single-value element after selection');
  assert.equal(selectedEl.textContent.trim(), '6+ years');

  // Smoke check logs mention selection
  const flat = logs.map(([, m]) => m).join('\n');
  assert.ok(
    flat.includes('Selected') && flat.includes('6+ years'),
    `logs should mention Selected 6+ years, got:\n${flat}`
  );
});
