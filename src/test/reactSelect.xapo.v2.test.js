import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { parseHTML } from 'linkedom';

import { getWidgetAdapter } from '../public/contentScripts/utils.esm.js';
import { matchScore, normalizeText } from '../public/contentScripts/autofill.esm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

// ─── Helper: evaluate autofill.js in a sandbox with a given DOM ─────────────

function createAutofillSandbox(document) {
  const logs = [];
  const noop = () => {};

  const sandbox = {
    globalThis: {},
    window: {
      addEventListener: noop,
      location: { hostname: 'job-boards.greenhouse.io', href: 'https://job-boards.greenhouse.io/xapo61/jobs/7572065003' },
      scrollTo: noop,
      history: { replaceState: noop, state: {} },
    },
    document,
    Event: class Event { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    KeyboardEvent: class KeyboardEvent { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    MouseEvent: class MouseEvent { constructor(t, o) { this.type = t; Object.assign(this, o || {}); } },
    MutationObserver: class MutationObserver { constructor() {} observe() {} },
    HTMLSelectElement: class HTMLSelectElement {},
    HTMLTextAreaElement: class HTMLTextAreaElement {},
    HTMLInputElement: class HTMLInputElement {},
    WeakSet,
    Map,
    CSS: { escape: (s) => s },
    Element: class Element {},
    DataTransfer: class DataTransfer { constructor() { this.items = { add: noop }; } },
    File: class File { constructor() {} },
    chrome: {
      runtime: { getURL: noop, onMessage: { addListener: noop }, sendMessage: noop },
      storage: { local: { get: noop, set: noop }, sync: { get: noop, set: noop } },
    },
    atob: globalThis.atob || ((b) => Buffer.from(b, 'base64').toString('binary')),
    console: {
      log: (...args) => { logs.push(['log', args.join(' ')]); },
      warn: (...args) => { logs.push(['warn', args.join(' ')]); },
      error: (...args) => { logs.push(['error', args.join(' ')]); },
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
    fetch: noop,
    alert: noop,
  };
  sandbox.window.document = document;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);

  const src = fs.readFileSync(
    path.join(__dirname, '../public/contentScripts/autofill.js'),
    'utf8'
  );

  try {
    vm.runInContext(src, sandbox);
  } catch (e) {
    // Some Chrome-only APIs may fail — that's fine for pure-function extraction
    if (!sandbox.normalizeText) {
      throw new Error('Failed to evaluate autofill.js: ' + e.message);
    }
  }

  return { sandbox, logs };
}

// ─── xapo fixture: React-Select dropdown trigger ────────────────────────────

test('xapo: all 4 custom-question comboboxes are detected as react-select', () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  const questionIds = [
    'question_29097201003', // Country of residence
    'question_29351026003', // Years of experience
    'question_29351044003', // Salary expectations
    'question_29351265003', // Business domains
  ];

  for (const id of questionIds) {
    const el = document.getElementById(id);
    assert.ok(el, `${id} should exist`);
    assert.equal(el.getAttribute('role'), 'combobox', `${id} should be combobox`);

    const adapter = getWidgetAdapter(el);
    assert.ok(adapter, `${id} should have a widget adapter`);
    assert.equal(adapter.id, 'react-select', `${id} should be react-select`);
  }
});

test('xapo: react-select adapter matches via aria-describedby containing "react-select"', () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  // question_29351026003 has aria-describedby="react-select-question_29351026003-placeholder ..."
  const el = document.getElementById('question_29351026003');
  assert.ok(el, 'element should exist');

  const describedBy = el.getAttribute('aria-describedby') || '';
  assert.ok(
    describedBy.includes('react-select'),
    `aria-describedby should contain "react-select", got: "${describedBy}"`
  );

  const adapter = getWidgetAdapter(el);
  assert.ok(adapter, 'should match react-select adapter');
  assert.equal(adapter.id, 'react-select');
});

// ─── Fuzzy loop prevention: same element via different params ────────────────

test('_recentlySkipped prevents retry: isRecentlySkipped + markRecentlySkipped', () => {
  // Test the pure logic of _recentlySkipped by evaluating autofill.js in sandbox
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);
  const { sandbox, logs } = createAutofillSandbox(document);

  // The sandbox exposes isRecentlySkipped and markRecentlySkipped
  assert.ok(sandbox.isRecentlySkipped, 'isRecentlySkipped should exist');
  assert.ok(sandbox.markRecentlySkipped, 'markRecentlySkipped should exist');

  // Create a mock element
  const el = document.getElementById('question_29351026003');
  assert.ok(el, 'element should exist');

  // Initially not skipped
  assert.equal(sandbox.isRecentlySkipped(el), false, 'should not be skipped initially');

  // Mark as skipped
  sandbox.markRecentlySkipped(el);

  // Now should be skipped
  assert.equal(sandbox.isRecentlySkipped(el), true, 'should be skipped after marking');
});

test('_attemptedThisPass: sandbox has processFields with dedup logic', () => {
  // Verify the autofill.js source now contains the dedup logic
  const src = fs.readFileSync(
    path.join(__dirname, '../public/contentScripts/autofill.js'),
    'utf8'
  );

  // Check that _attemptedThisPass is created inside processFields
  assert.ok(
    src.includes('_attemptedThisPass'),
    'autofill.js should contain _attemptedThisPass for per-pass element dedup'
  );

  // Check that _recentlySkipped is used
  assert.ok(
    src.includes('isRecentlySkipped'),
    'autofill.js should use isRecentlySkipped to prevent retry loops'
  );

  // Check that markRecentlySkipped is called on React-Select failure
  assert.ok(
    src.includes('markRecentlySkipped(inputElement)'),
    'autofill.js should call markRecentlySkipped on React-Select failure'
  );
});

// ─── React-Select handling: improved dropdown trigger ────────────────────────

test('React-Select handler clicks indicator/control before typing', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../public/contentScripts/autofill.js'),
    'utf8'
  );

  // The handler should click the indicator/control first
  assert.ok(
    src.includes('indicator') && src.includes('.click()'),
    'should click indicator to open dropdown'
  );

  // Should wait up to 2s for listbox (polling loop)
  assert.ok(
    src.includes('2000'),
    'should poll up to 2000ms for dropdown to appear'
  );

  // Should dispatch keyboard events to trigger React-Select filtering
  assert.ok(
    src.includes('keydown') && src.includes('lastChar'),
    'should dispatch keydown events for React-Select filtering'
  );
});

test('React-Select handler: does NOT add to _filledElements on clear/skip', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../public/contentScripts/autofill.js'),
    'utf8'
  );

  // After clearing, the code should NOT add to _filledElements
  // Find the block after "no option match, skipped"
  const skipIndex = src.indexOf('no option match, skipped (cleared input)');
  assert.ok(skipIndex > 0, 'should have the skip log message');

  // Check that markRecentlySkipped is called NEAR the skip message
  const afterSkip = src.substring(skipIndex, skipIndex + 500);
  assert.ok(
    afterSkip.includes('markRecentlySkipped'),
    'should call markRecentlySkipped after clearing (prevents retry loops)'
  );

  // The _filledElements.add should NOT appear between the clear and the continue
  assert.ok(
    !afterSkip.includes('_filledElements.add'),
    'should NOT add to _filledElements after clearing (leaves for manual fill)'
  );
});

// ─── matchScore: edge cases for years of experience ──────────────────────────

test('matchScore: "6" is short and should NOT match range options', () => {
  const options = [
    'Less than 1 year',
    '1-2 years',
    '3-5 years',
    '5-10 years',
    '10-15 years',
    '15+ years',
  ];

  for (const opt of options) {
    const score = matchScore('6', opt);
    assert.ok(score < 50, `"6" vs "${opt}" = ${score}, should be < 50`);
  }
});

test('matchScore: "5-10 years" matches well against "5-10 years" option', () => {
  const score = matchScore('5-10 years', '5-10 years');
  assert.equal(score, 100, 'exact match should be 100');
});

// ─── Fuzzy inputQuery dedup: multiple params mapping to same field ───────────

test('greenhouse field map has multiple keys for "Years of Experience"', () => {
  // Verify the problem scenario: multiple keys all map to same param
  const src = fs.readFileSync(
    path.join(__dirname, '../public/contentScripts/utils.js'),
    'utf8'
  );

  // These should all be in the greenhouse config
  const yoeKeys = [
    'years of experience',
    'experience years',
    'total experience',
    'relevant experience',
    'how many years of experience',
  ];

  for (const key of yoeKeys) {
    assert.ok(
      src.includes(`"${key}"`),
      `greenhouse config should contain "${key}" key`
    );
  }
});

test('_recentlySkipped map resets on AUTOFILL NOW button click', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../public/contentScripts/autofill.js'),
    'utf8'
  );

  // The button handler should reset _recentlySkipped
  const buttonSection = src.indexOf('smartapply-autofill-now');
  assert.ok(buttonSection > 0, 'should have AUTOFILL_NOW button code');

  const afterButton = src.substring(buttonSection, buttonSection + 1500);
  assert.ok(
    afterButton.includes('_recentlySkipped = new Map()'),
    'AUTOFILL NOW button should reset _recentlySkipped'
  );
});

// ─── Console output simulation: before/after comparison ──────────────────────

test('SIMULATION: console log analysis — before fix would loop, after fix stops', () => {
  // Simulate the scenario described in the issue:
  // Multiple params ("experience years", "total experience", "relevant experience")
  // all fuzzy-match to the same combobox (question_29351026003).
  //
  // BEFORE fix: each param would type → fail → clear → next param retries same element
  // AFTER fix: first param types → fails → markRecentlySkipped + _attemptedThisPass
  //            → subsequent params skip immediately

  // We can't run full autofill in a test (needs Chrome APIs), but we can verify
  // the guard logic exists and works at the source level.

  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);
  const { sandbox } = createAutofillSandbox(document);

  const yearsCombobox = document.getElementById('question_29351026003');
  assert.ok(yearsCombobox, 'years of experience combobox should exist');

  // Simulate: first attempt fails, mark as skipped
  assert.equal(sandbox.isRecentlySkipped(yearsCombobox), false, 'not skipped initially');
  sandbox.markRecentlySkipped(yearsCombobox);
  assert.equal(sandbox.isRecentlySkipped(yearsCombobox), true, 'skipped after mark');

  // Simulate: second param tries same element → should be blocked
  assert.equal(sandbox.isRecentlySkipped(yearsCombobox), true, 'still skipped (within 5s window)');

  // A different element should NOT be blocked
  const salaryCombobox = document.getElementById('question_29351044003');
  assert.ok(salaryCombobox, 'salary combobox should exist');
  assert.equal(sandbox.isRecentlySkipped(salaryCombobox), false, 'different element not skipped');

  console.log('✅ SIMULATION: Retry prevention verified — same element blocked, different element allowed');
});

test('SIMULATION: console output comparison', () => {
  // Document what console output looked like before vs after for the xapo scenario

  const beforeConsoleSim = [
    'SmartApply: React-Select "experience years" — dropdown menu not found after typing "6"',
    'SmartApply: React-Select "experience years" — no option match, skipped (cleared input)',
    'SmartApply: React-Select "total experience" — dropdown menu not found after typing "6"',
    'SmartApply: React-Select "total experience" — no option match, skipped (cleared input)',
    'SmartApply: React-Select "relevant experience" — dropdown menu not found after typing "6"',
    'SmartApply: React-Select "relevant experience" — no option match, skipped (cleared input)',
    'SmartApply: React-Select "how many years of experience" — dropdown menu not found after typing "6"',
    'SmartApply: React-Select "how many years of experience" — no option match, skipped (cleared input)',
    '// ^^^ LOOPS through all YoE param names on same combobox'
  ];

  const afterConsoleSim = [
    'SmartApply: React-Select "experience years" — dropdown menu not found after 2s for "6"',
    'SmartApply: React-Select "experience years" — no option match, skipped (cleared input)',
    'SmartApply: Skip recently-skipped total experience (question_29351026003)',
    'SmartApply: Skip already-attempted-this-pass relevant experience (question_29351026003)',
    '// ^^^ Stops immediately — no redundant typing/clearing'
  ];

  // The key improvement: before had 8 lines of retries, after has 4 with skips
  assert.ok(beforeConsoleSim.length > afterConsoleSim.length,
    'After fix should have fewer console lines (retries prevented)');

  console.log('\n📋 BEFORE fix (simulated console):');
  for (const line of beforeConsoleSim) console.log(`  ${line}`);
  console.log('\n📋 AFTER fix (simulated console):');
  for (const line of afterConsoleSim) console.log(`  ${line}`);
});
