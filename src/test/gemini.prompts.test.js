import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTier1MappingSystemPrompt,
  buildTier1MappingUserPayload,
  buildTier1MappingUserPrompt,
  buildTier2NarrativeSystemPrompt,
  buildTier2NarrativeUserPrompt,
  buildJobRecsSystemPrompt,
  buildJobRecsUserPrompt,
} from '../public/contentScripts/providers/gemini.js';

test('Tier 1 system prompt includes required rules', () => {
  const p = buildTier1MappingSystemPrompt();
  assert.match(p, /Return ONLY valid JSON/i);
  assert.match(p, /Do NOT invent new profile keys/i);
  assert.match(p, /Never propose checking consent/i);
});

test('Tier 1 user payload is JSON-serializable and contains required keys', () => {
  const payload = buildTier1MappingUserPayload({
    domain: 'boards.greenhouse.io',
    allowedProfileKeys: ['First Name', 'Email'],
    unresolvedFields: [
      {
        field_fingerprint: 'fp:abc',
        control: { kind: 'input', tag: 'input', type: 'text', role: 'textbox' },
        descriptor: { label: 'First name', required: true, options: [] },
      },
    ],
  });

  assert.equal(payload.task, 'map_unresolved_fields_to_profile_keys');
  assert.equal(payload.domain, 'boards.greenhouse.io');
  assert.deepEqual(payload.allowed_profile_keys, ['First Name', 'Email']);
  assert.equal(payload.policy.never_autofill_consent_checkboxes, true);
  assert.equal(payload.policy.sensitive_requires_review, true);
  assert.equal(payload.response_requirements.output, 'FillPlan');

  // Should be serializable
  const s = JSON.stringify(payload);
  assert.ok(s.includes('unresolved_fields'));
});

test('Tier 1 user prompt is valid JSON', () => {
  const prompt = buildTier1MappingUserPrompt({
    domain: 'example.com',
    allowedProfileKeys: ['Full Name'],
    unresolvedFields: [],
  });
  const obj = JSON.parse(prompt);
  assert.equal(obj.domain, 'example.com');
  assert.deepEqual(obj.allowed_profile_keys, ['Full Name']);
});

test('Tier 2 system prompt asks for answer-only first-person', () => {
  const p = buildTier2NarrativeSystemPrompt();
  assert.match(p, /first person/i);
  assert.match(p, /Return only the answer text/i);
});

test('Tier 2 user prompt includes constraints and context blocks', () => {
  const prompt = buildTier2NarrativeUserPrompt({
    questionText: 'Why do you want this role?',
    maxWords: 120,
    resumeDetailsMin: '{"skills":["JS"]}',
    profileSubset: 'Name: Jane Doe',
    siteGuidance: 'Keep under 200 words.',
    synonymHint: 'Prefer not to say',
  });

  assert.match(prompt, /Question: Why do you want this role\?/);
  assert.match(prompt, /Target length: 120 words/);
  assert.match(prompt, /Resume details \(structured\):/);
  assert.match(prompt, /Optional profile facts:/);
  assert.match(prompt, /Site guidance:/);
  assert.match(prompt, /Synonym hint:/);
});

test('Job recs prompts include JSON-only requirement and desired location', () => {
  const sys = buildJobRecsSystemPrompt();
  assert.match(sys, /Return ONLY valid JSON/i);

  const user = buildJobRecsUserPrompt({
    profile: { Email: 'x@example.com' },
    resumeDetails: { skills: ['JS'] },
    desiredLocation: 'Remote',
  });

  assert.match(user, /10-15 job recommendations/i);
  assert.match(user, /Desired location: Remote/i);
  assert.match(user, /"recommendations"/);
});
