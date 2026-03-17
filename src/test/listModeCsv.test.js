import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadBuildQueueFromCsv() {
  const src = fs.readFileSync(new URL('../vue_src/components/SettingsTab.vue', import.meta.url), 'utf8');

  const scriptMatch = src.match(/<script\s+lang="ts">([\s\S]*?)<\/script>/i);
  assert.ok(scriptMatch, 'SettingsTab.vue should contain a <script lang="ts"> block');
  const scriptTs = scriptMatch[1];

  // Extract the parseCsv + buildQueueFromCsv functions. We stop before sendMessage()
  // to avoid pulling in chrome runtime dependencies.
  const fnMatch = scriptTs.match(/function\s+parseCsv[\s\S]*?\n}\n\nfunction\s+sendMessage/);
  assert.ok(fnMatch, 'Expected parseCsv/buildQueueFromCsv to exist before sendMessage');

  const fnsTs = fnMatch[0].replace(/\n\nfunction\s+sendMessage[\s\S]*$/, '\n');

  const moduleTs = `${fnsTs}\n\n// expose for tests\n(globalThis).__csvFns = { parseCsv, buildQueueFromCsv };\n`;

  const out = ts.transpileModule(moduleTs, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  });

  const ctx = { console };
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  vm.runInContext(out.outputText, ctx, { filename: 'SettingsTab.vue:csvFns' });

  assert.ok(ctx.__csvFns?.buildQueueFromCsv, 'buildQueueFromCsv should be defined');
  return ctx.__csvFns.buildQueueFromCsv;
}

test('list mode CSV: headerless single-line comma-separated URLs becomes one queue item per URL', () => {
  const buildQueueFromCsv = loadBuildQueueFromCsv();

  const csv = fs.readFileSync(
    new URL('./fixtures/list-mode-headerless-singleline-multiurl.csv', import.meta.url),
    'utf8'
  );

  const out = JSON.parse(JSON.stringify(buildQueueFromCsv(csv)));
  assert.equal(out.length, 4);
  assert.deepEqual(
    out.map((x) => x.url),
    [
      'https://jobs.lever.co/onit/b36c16ab-cd92-424c-b69c-a39c3b7a7fbb/apply',
      'https://jobs.lever.co/acme/11111111-1111-1111-1111-111111111111/apply',
      'https://jobs.lever.co/foobar/22222222-2222-2222-2222-222222222222/apply',
      'https://jobs.lever.co/baz/33333333-3333-3333-3333-333333333333/apply',
    ]
  );
});

test('list mode CSV: headerless url,notes remains url+notes (no splitting)', () => {
  const buildQueueFromCsv = loadBuildQueueFromCsv();

  const csv = [
    'https://example.com/apply,first note',
    'https://example.com/apply2,"note, with comma"',
    '',
  ].join('\n');

  const out = JSON.parse(JSON.stringify(buildQueueFromCsv(csv)));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { url: 'https://example.com/apply', notes: 'first note' });
  assert.deepEqual(out[1], { url: 'https://example.com/apply2', notes: 'note, with comma' });
});

test('list mode CSV: headered url/notes parses normally', () => {
  const buildQueueFromCsv = loadBuildQueueFromCsv();

  const csv = [
    'url,notes',
    'https://example.com/a,hello',
    'https://example.com/b,',
  ].join('\n');

  const out = JSON.parse(JSON.stringify(buildQueueFromCsv(csv)));
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { url: 'https://example.com/a', notes: 'hello' });
  assert.deepEqual(out[1], { url: 'https://example.com/b', notes: '' });
});
