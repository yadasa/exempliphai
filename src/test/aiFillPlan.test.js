import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

import { validateFillPlan } from '../public/contentScripts/fillPlanValidator.js';

function createConsole() {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
    assert: (cond, msg) => {
      if (!cond) throw new Error(msg || 'console.assert failed');
    },
  };
}

function loadAiFillPlanIntoContext(ctx) {
  const src = fs.readFileSync(new URL('../public/contentScripts/aiFillPlan.js', import.meta.url), 'utf8');
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'aiFillPlan.js' });
}

test('aiFillPlan: attaches to __SmartApply.aiFillPlan', () => {
  const ctx = {
    console: createConsole(),
    setTimeout,
    clearTimeout,
    Date,
    Math,
    globalThis: null,
    __exempliphaiProviders: {
      gemini: { mapFieldsToFillPlan: async () => ({ actions: [] }) },
    },
    __exempliphaiFillPlan: { validate: validateFillPlan },
    location: { hostname: 'example.com', href: 'https://example.com/apply' },
  };
  ctx.globalThis = ctx;

  loadAiFillPlanIntoContext(ctx);

  assert.ok(ctx.__SmartApply?.aiFillPlan);
  assert.equal(typeof ctx.__SmartApply.aiFillPlan.generateTier1, 'function');
});

test('aiFillPlan.generateTier1: calls gemini, validates plan, returns actionable actions', async () => {
  const calls = [];

  const ctx = {
    console: createConsole(),
    setTimeout,
    clearTimeout,
    Date,
    Math,
    globalThis: null,
    location: { hostname: 'boards.greenhouse.io', href: 'https://boards.greenhouse.io/example/job' },
    __exempliphaiFillPlan: { validate: validateFillPlan },
    __exempliphaiProviders: {
      gemini: {
        mapFieldsToFillPlan: async (args) => {
          calls.push(args);
          // Return a plan that includes a skip action with illegal extras.
          return {
            version: '0.1',
            plan_id: 'p1',
            created_at: new Date().toISOString(),
            domain: args.domain,
            page_url: args.pageUrl,
            provider: { name: 'gemini', model: 'test' },
            snapshot_hash: args.snapshotHash,
            actions: [
              {
                action_id: 'a1',
                field_fingerprint: args.unresolvedFields[0].field_fingerprint,
                value: { source: 'profile', source_key: 'Email' },
              },
              {
                action_id: 'a2',
                field_fingerprint: args.unresolvedFields[1].field_fingerprint,
                value: { source: 'skip', source_key: 'SHOULD_NOT_BE_HERE' },
              },
              {
                action_id: 'a3',
                field_fingerprint: 'fp:hallucinated',
                value: { source: 'profile', source_key: 'Email' },
              },
              {
                action_id: 'a4',
                field_fingerprint: args.unresolvedFields[0].field_fingerprint,
                value: { source: 'profile', source_key: 'NOT_ALLOWED' },
              },
            ],
          };
        },
      },
    },
  };
  ctx.globalThis = ctx;

  loadAiFillPlanIntoContext(ctx);

  const unresolvedSnapshot = {
    domain: 'boards.greenhouse.io',
    page_url: 'https://boards.greenhouse.io/example/job',
    snapshot_hash: 'sha256:abc',
    unresolved_fields: [
      {
        field_fingerprint: 'fp:email',
        control: { kind: 'input', tag: 'input', type: 'email', role: 'textbox', name: 'email', id: 'email' },
        descriptor: { label: 'Email', section: 'Personal', required: true, options: [] },
      },
      {
        field_fingerprint: 'fp:sponsor',
        control: { kind: 'select', tag: 'select', role: 'combobox', name: 'sponsorship' },
        descriptor: {
          label: 'Do you require sponsorship?',
          section: 'Application Questions',
          required: true,
          options: ['Yes', 'No'],
        },
      },
    ],
  };

  const profileKeys = ['Email', 'Full Name'];
  const consents = { apiKey: 'k_test', allowAiMapping: true };

  const res = await ctx.__SmartApply.aiFillPlan.generateTier1(unresolvedSnapshot, profileKeys, consents);
  assert.equal(res.ok, true, JSON.stringify(res.error || null));

  // Should call provider exactly once.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].domain, 'boards.greenhouse.io');
  assert.deepEqual(Array.from(calls[0].allowedProfileKeys), profileKeys);
  assert.equal(Array.isArray(calls[0].unresolvedFields), true);

  // Only actionable (non-skip) actions should be returned.
  assert.equal(res.actions.length, 1);
  assert.equal(res.actions[0].field_fingerprint, 'fp:email');
  assert.equal(res.actions[0].value.source, 'profile');
  assert.equal(res.actions[0].value.source_key, 'Email');

  // Returned plan should be valid.
  const v = validateFillPlan(res.plan);
  assert.equal(v.ok, true, JSON.stringify(v.errors, null, 2));

  // Plan should not contain hallucinated fingerprint.
  assert.ok(!res.plan.actions.some((a) => a.field_fingerprint === 'fp:hallucinated'));

  // Plan should keep skip actions but sanitized to pass validator.
  const skip = res.plan.actions.find((a) => a.field_fingerprint === 'fp:sponsor');
  assert.equal(skip.value.source, 'skip');
  assert.ok(!('source_key' in skip.value));
});

test('aiFillPlan.generateTier1: retries once on transient provider error', async () => {
  let n = 0;

  const ctx = {
    console: createConsole(),
    setTimeout,
    clearTimeout,
    Date,
    Math,
    globalThis: null,
    location: { hostname: 'example.com', href: 'https://example.com/apply' },
    __exempliphaiFillPlan: { validate: validateFillPlan },
    __exempliphaiProviders: {
      gemini: {
        mapFieldsToFillPlan: async () => {
          n++;
          if (n === 1) {
            const e = new Error('timeout');
            // @ts-ignore
            e.status = 408;
            throw e;
          }
          return {
            version: '0.1',
            plan_id: 'p',
            created_at: new Date().toISOString(),
            domain: 'example.com',
            page_url: 'https://example.com/apply',
            provider: { name: 'gemini', model: 'test' },
            actions: [{ action_id: 'a', field_fingerprint: 'fp:x', value: { source: 'skip' } }],
          };
        },
      },
    },
  };
  ctx.globalThis = ctx;

  loadAiFillPlanIntoContext(ctx);

  const res = await ctx.__SmartApply.aiFillPlan.generateTier1(
    { domain: 'example.com', page_url: 'https://example.com/apply', unresolved_fields: [{ field_fingerprint: 'fp:x' }] },
    ['Email'],
    { apiKey: 'k', allowAiMapping: true, outerRetries: 1, timeoutMs: 50 }
  );

  assert.equal(n, 2);
  assert.equal(res.ok, true);
});

test('aiFillPlan.generateTier1: respects explicit allowAiMapping=false (does not call provider)', async () => {
  let called = false;
  const ctx = {
    console: createConsole(),
    setTimeout,
    clearTimeout,
    Date,
    Math,
    globalThis: null,
    location: { hostname: 'example.com', href: 'https://example.com/apply' },
    __exempliphaiFillPlan: { validate: validateFillPlan },
    __exempliphaiProviders: {
      gemini: {
        mapFieldsToFillPlan: async () => {
          called = true;
          return { actions: [] };
        },
      },
    },
  };
  ctx.globalThis = ctx;

  loadAiFillPlanIntoContext(ctx);

  const res = await ctx.__SmartApply.aiFillPlan.generateTier1(
    { domain: 'example.com', page_url: 'https://example.com/apply', unresolved_fields: [] },
    ['Email'],
    { apiKey: 'k', allowAiMapping: false }
  );

  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'ai_mapping_disabled');
  assert.equal(called, false);
});
