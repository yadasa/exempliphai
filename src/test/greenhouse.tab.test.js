import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';
import vm from 'node:vm';

import { tabToFirstInput } from '../public/contentScripts/autofill.esm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

test('greenhouse: tabToFirstInput focuses the first input in form', async () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  const form = document.querySelector('form');
  assert.ok(form, 'fixture should include a <form>');

  const firstName = document.getElementById('first_name');
  assert.ok(firstName, 'fixture should include #first_name');

  let focusFired = false;
  firstName.addEventListener('focus', () => {
    focusFired = true;
  });

  const el = await tabToFirstInput({
    document,
    root: form,
    tabCount: 6,
    delayMs: 0,
    sleep: async () => {},
  });

  assert.equal(el, firstName, 'should return the first input element');
  assert.equal(focusFired, true, 'should focus the first input element');
});

function cloneMathWithRandom(randomValue) {
  const out = {};
  for (const k of Object.getOwnPropertyNames(Math)) {
    out[k] = Math[k];
  }
  out.random = () => randomValue;
  return out;
}

function buildAutofillVmForFixture(html, { hostname, randomValue = 0 } = {}) {
  const { window } = parseHTML(html);

  // linkedom doesn't always include these browser bits.
  window.scrollTo = window.scrollTo || (() => {});
  window.history = window.history || { replaceState: () => {}, state: {} };
  window.location = window.location || {};
  window.location.hostname = hostname || 'job-boards.greenhouse.io';
  window.location.href = window.location.href || `https://${window.location.hostname}/jobs/1`;

  const logs = [];
  const ctx = {
    console: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push('WARN ' + args.join(' ')),
      error: (...args) => logs.push('ERROR ' + args.join(' ')),
    },
    setTimeout,
    clearTimeout,
    Date,
    WeakSet,
    Map,
    Set,
    Promise,
  };

  Object.assign(ctx, window);

  // autofill.js is a classic content script and registers load handlers.
  ctx.addEventListener = ctx.addEventListener || (() => {});

  // Ensure deterministic "random 6–7" behavior without mutating Node's Math.
  ctx.Math = cloneMathWithRandom(randomValue);

  ctx.window = ctx;
  ctx.document = window.document;
  ctx.globalThis = ctx;

  vm.createContext(ctx);

  const autofillSrc = readFixture('src/public/contentScripts/autofill.js');
  vm.runInContext(autofillSrc, ctx, { filename: 'autofill.js' });

  return { ctx, logs };
}

test('greenhouse: tryAutofillNow auto-runs and triggers optional tabs when unfocused', async () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { ctx, logs } = buildAutofillVmForFixture(html, { hostname: 'job-boards.greenhouse.io', randomValue: 0 });

  let tabCalled = false;
  ctx.tabToFirstInput = async () => {
    tabCalled = true;
    return ctx.document.getElementById('first_name');
  };

  let autofillCalled = false;
  ctx.autofill = async () => {
    autofillCalled = true;
  };

  const ok = await ctx.tryAutofillNow({ force: false, reason: 'test' });

  assert.equal(ok, true, 'should run autofill on Greenhouse even when not forced');
  assert.equal(autofillCalled, true, 'should call autofill');
  assert.equal(tabCalled, true, 'should request optional tabs when no active field is focused');
  assert.ok(
    logs.some((l) => l.includes('SmartApply: Optional tabs (x6) → Starting autofill')),
    'should log optional tabs count before filling'
  );
});

test('greenhouse: tryAutofillNow does not tab when a usable control is already focused', async () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { ctx } = buildAutofillVmForFixture(html, { hostname: 'job-boards.greenhouse.io', randomValue: 0 });

  const firstName = ctx.document.getElementById('first_name');
  assert.ok(firstName, 'fixture should include #first_name');
  firstName.focus();

  let tabCalled = false;
  ctx.tabToFirstInput = async () => {
    tabCalled = true;
    return firstName;
  };

  let autofillCalled = false;
  ctx.autofill = async () => {
    autofillCalled = true;
  };

  const ok = await ctx.tryAutofillNow({ force: false, reason: 'test' });

  assert.equal(ok, true, 'should run autofill');
  assert.equal(autofillCalled, true, 'should call autofill');
  assert.equal(tabCalled, false, 'should not tab when focus is already in a usable control');
});
