import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

import {
  parseToISODate,
  splitDateParts,
  formatForNativeDateInput,
  setContentEditableValue,
  getWidgetAdapter,
} from '../public/contentScripts/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

test('date utils: parse dd/mm/yyyy (DMY)', () => {
  assert.equal(parseToISODate('09/03/2026', { order: 'DMY' }), '2026-03-09');
  assert.deepEqual(splitDateParts('09/03/2026', { order: 'DMY' }), {
    year: '2026',
    month: '03',
    day: '09',
  });
});

test('date utils: parse mm/dd/yyyy (MDY)', () => {
  assert.equal(parseToISODate('03/09/2026', { order: 'MDY' }), '2026-03-09');
  assert.deepEqual(splitDateParts('03/09/2026', { order: 'MDY' }), {
    year: '2026',
    month: '03',
    day: '09',
  });
});

test('date utils: parse ISO passthrough + formatForNativeDateInput', () => {
  assert.equal(parseToISODate('2026-03-09'), '2026-03-09');
  assert.equal(formatForNativeDateInput('2026-03-09'), '2026-03-09');
});

test('date utils: parse month-name formats', () => {
  assert.equal(parseToISODate('March 9, 2026'), '2026-03-09');
  assert.equal(parseToISODate('9 March 2026'), '2026-03-09');
});

test('setContentEditableValue: writes + dispatches beforeinput/input on fixture', () => {
  const html = readFixture('examples/fixtures/contenteditable-date.html');
  const { document } = parseHTML(html);

  const el = document.getElementById('editor');
  assert.ok(el);

  const events = [];
  el.addEventListener('beforeinput', () => events.push('beforeinput'));
  el.addEventListener('input', () => events.push('input'));

  const ok = setContentEditableValue(el, 'Hello world');
  assert.equal(ok, true);
  assert.equal(el.textContent, 'Hello world');
  assert.ok(events.includes('beforeinput'));
  assert.ok(events.includes('input'));
});

test('widget adapter stub: matches Greenhouse react-select combobox on fixture', () => {
  const html = readFixture('examples/greenhouse/axon.html');
  const { document } = parseHTML(html);

  const gender = document.querySelector('input#gender');
  assert.ok(gender);

  const adapter = getWidgetAdapter(gender);
  assert.ok(adapter);
  assert.equal(adapter.id, 'react-select');

  const firstName = document.querySelector('input#first_name');
  assert.ok(firstName);
  assert.equal(getWidgetAdapter(firstName), null);
});
