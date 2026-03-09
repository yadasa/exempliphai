import test from 'node:test';
import assert from 'node:assert/strict';

import { validateFillPlan, assertValidFillPlan } from '../public/contentScripts/fillPlanValidator.js';

test('FillPlan validator: accepts a minimal valid plan', () => {
  const plan = {
    version: '0.1',
    plan_id: 'plan_123',
    created_at: new Date().toISOString(),
    domain: 'boards.greenhouse.io',
    page_url: 'https://boards.greenhouse.io/example',
    provider: { name: 'gemini', model: 'gemini-3-flash-preview' },
    snapshot_hash: 'sha256:deadbeef',
    actions: [
      {
        action_id: 'a1',
        field_fingerprint: 'fp:id:email',
        control: { kind: 'input', tag: 'input', type: 'email', role: 'textbox', id: 'email' },
        descriptor: { label: 'Email', required: true, visible: true },
        value: { source: 'profile', source_key: 'Email' },
        apply: { mode: 'set_value', allow_overwrite: false },
        confidence: 0.9,
      },
    ],
  };

  const res = validateFillPlan(plan);
  assert.equal(res.ok, true, JSON.stringify(res.errors, null, 2));
  assert.doesNotThrow(() => assertValidFillPlan(plan));
});

test('FillPlan validator: rejects invalid value.source', () => {
  const plan = {
    version: '0.1',
    plan_id: 'plan_123',
    created_at: new Date().toISOString(),
    domain: 'boards.greenhouse.io',
    page_url: 'https://boards.greenhouse.io/example',
    actions: [
      {
        action_id: 'a1',
        field_fingerprint: 'fp:id:email',
        value: { source: 'random', source_key: 'Email' },
      },
    ],
  };

  const res = validateFillPlan(plan);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.path.endsWith('.value.source')));
  assert.throws(() => assertValidFillPlan(plan));
});

test('FillPlan validator: source=skip must not include source_key/literal/derived', () => {
  const plan = {
    version: '0.1',
    plan_id: 'plan_123',
    created_at: new Date().toISOString(),
    domain: 'boards.greenhouse.io',
    page_url: 'https://boards.greenhouse.io/example',
    actions: [
      {
        action_id: 'a1',
        field_fingerprint: 'fp:id:any',
        value: { source: 'skip', source_key: 'Email' },
      },
    ],
  };

  const res = validateFillPlan(plan);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.path.includes('value.source_key')));
});
