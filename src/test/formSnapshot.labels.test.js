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

test('formSnapshot labels: xapo fixture returns full human-visible question label with required marker', () => {
  const html = fs.readFileSync(new URL('../../examples/greenhouse/xapo.html', import.meta.url), 'utf8');
  const ctx = loadFormSnapshotWithHtml(html);

  const form = ctx.document.querySelector('#application-form') || ctx.document.querySelector('form');
  assert.ok(form, 'fixture should contain a form');

  const snapshot = ctx.__SmartApply.formSnapshot.findControls(form);
  const control = snapshot.find((c) => c && c.control && c.control.id === 'question_29351026003');
  assert.ok(control, 'snapshot should include the years-of-experience combobox control');

  assert.equal(control.label, 'How many years of experience do you have?*');
});

test('formSnapshot labels: lever fixture prefers preceding question div/span text for custom questions', () => {
  const html = fs.readFileSync(new URL('../../examples/lever/onit.html', import.meta.url), 'utf8');
  const ctx = loadFormSnapshotWithHtml(html);

  const input = ctx.document.querySelector('input.card-field-input[placeholder="Type your response"]');
  assert.ok(input, 'fixture should contain the salary expectations input');

  const label = ctx.__SmartApply.formSnapshot.computeBestLabel(input);
  assert.equal(label, 'What are your base salary expectations for this role?✱');
});
