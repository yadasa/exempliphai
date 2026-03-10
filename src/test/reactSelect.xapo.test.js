import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

import { getWidgetAdapter } from '../public/contentScripts/utils.esm.js';
import { matchScore, normalizeText } from '../public/contentScripts/autofill.esm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

// ─── xapo fixture: React-Select combobox identification ─────────────────────

test('xapo fixture: years-of-experience combobox is detected as react-select', () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  // The "How many years of experience do you have?" combobox
  const yearsInput = document.getElementById('question_29351026003');
  assert.ok(yearsInput, 'years-of-experience input should exist');
  assert.equal(yearsInput.getAttribute('role'), 'combobox');

  const adapter = getWidgetAdapter(yearsInput);
  assert.ok(adapter, 'should detect a widget adapter');
  assert.equal(adapter.id, 'react-select');
});

test('xapo fixture: salary expectations combobox is detected as react-select', () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  const salaryInput = document.getElementById('question_29351044003');
  assert.ok(salaryInput, 'salary input should exist');
  assert.equal(salaryInput.getAttribute('role'), 'combobox');

  const adapter = getWidgetAdapter(salaryInput);
  assert.ok(adapter, 'should detect a widget adapter');
  assert.equal(adapter.id, 'react-select');
});

test('xapo fixture: country of residence combobox is detected as react-select', () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  const countryInput = document.getElementById('question_29097201003');
  assert.ok(countryInput, 'country input should exist');
  assert.equal(countryInput.getAttribute('role'), 'combobox');

  const adapter = getWidgetAdapter(countryInput);
  assert.ok(adapter, 'should detect a widget adapter');
  assert.equal(adapter.id, 'react-select');
});

test('xapo fixture: plain text inputs are NOT detected as react-select', () => {
  const html = readFixture('examples/greenhouse/xapo.html');
  const { document } = parseHTML(html);

  const firstName = document.getElementById('first_name');
  assert.ok(firstName, 'first_name input should exist');
  assert.equal(getWidgetAdapter(firstName), null);
});

// ─── matchScore: React-Select option matching for years-of-experience ──────

test('matchScore: "6" vs typical range options scores below 50 (no false match)', () => {
  // Typical Greenhouse "years of experience" options are range-based
  const rangeOptions = [
    'Less than 1 year',
    '1-2 years',
    '3-5 years',
    '5-10 years',
    '10-15 years',
    '15+ years',
  ];

  for (const opt of rangeOptions) {
    const score = matchScore('6', opt);
    assert.ok(
      score < 50,
      `matchScore("6", "${opt}") = ${score} — should be < 50 to prevent false match`
    );
  }
});

test('matchScore: "6" matches "6+ years" with high score (exact substring)', () => {
  const score = matchScore('6', '6+ years');
  assert.ok(score >= 50, `matchScore("6", "6+ years") = ${score} — should be >= 50`);
});

test('matchScore: "Black or African American" matches race option well', () => {
  const score = matchScore('Black or African American', 'Black or African American');
  assert.equal(score, 100, 'exact match should be 100');
});

test('matchScore: "Black or African American" does NOT match unrelated options', () => {
  const unrelated = [
    'WMT - Wealth Management',
    'FCP - Financial Crime Prevention',
    'Gibraltar',
    'United States',
  ];

  for (const opt of unrelated) {
    const score = matchScore('Black or African American', opt);
    assert.ok(
      score < 50,
      `matchScore("Black or African American", "${opt}") = ${score} — should be < 50`
    );
  }
});

test('normalizeText: handles various input formats', () => {
  assert.equal(normalizeText('6'), '6');
  assert.equal(normalizeText('5-10 years'), '5 10 years');
  assert.equal(normalizeText('Black or African American'), 'black or african american');
  assert.equal(normalizeText('  Hello   World  '), 'hello world');
  assert.equal(normalizeText(null), '');
  assert.equal(normalizeText(undefined), '');
});
