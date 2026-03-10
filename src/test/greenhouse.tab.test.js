import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

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
