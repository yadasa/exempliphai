import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildJobSearchSystemPrompt,
  buildJobSearchUserPrompt,
  createGpt52Provider,
} from '../public/contentScripts/providers/gpt52.js';

test('gpt52: job search system prompt enforces JSON + privacy + schema', () => {
  const s = buildJobSearchSystemPrompt();
  assert.ok(s.includes('Return ONLY valid JSON'));
  assert.ok(s.toLowerCase().includes('privacy'));
  assert.ok(s.includes('search_link'));
  assert.ok(s.includes('JSON array'));
});

test('gpt52: job search user prompt includes requested schema shape', () => {
  const p = buildJobSearchUserPrompt({
    resumeData: { skills: ['React', 'TypeScript'] },
    countMin: 10,
    countMax: 15,
  });
  assert.ok(p.includes('10–15') || p.includes('10-15'));
  assert.ok(p.includes('search_link'));
  assert.ok(p.includes('Return ONLY a JSON array'));
});

test('gpt52: provider instance exposes recommendJobs', () => {
  const provider = createGpt52Provider({ apiKey: 'sk-or-test', model: 'openai/gpt-5.2' });
  assert.equal(typeof provider.recommendJobs, 'function');
  assert.equal(typeof provider.tailorResume, 'function');
});
