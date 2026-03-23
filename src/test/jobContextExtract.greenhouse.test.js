import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHTML } from 'linkedom';

import { extractJobContextFromDocument } from '../public/contentScripts/autofill.esm.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFixture(relFromRepoRoot) {
  const repoRoot = path.resolve(__dirname, '../..');
  return fs.readFileSync(path.join(repoRoot, relFromRepoRoot), 'utf8');
}

test('greenhouse: extractJobContextFromDocument finds title + description on job post', () => {
  const html = readFixture('examples/greenhouse/planetscale.html');
  const { document } = parseHTML(html);

  const ctx = extractJobContextFromDocument(document);
  assert.equal(ctx.ok, true);
  assert.match(ctx.title, /Solutions Engineer/i);
  assert.ok(String(ctx.description || '').length > 500);
});
