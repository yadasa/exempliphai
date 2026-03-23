import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTailorResumePrompt } from '../vue_src/utils/tailorPrompt.js';

test('tailorPrompt includes surgical + length constraints', () => {
  const p = buildTailorResumePrompt({
    jobTitle: 'Senior Data Scientist',
    company: 'Acme',
    pageUrl: 'https://boards.greenhouse.io/acme/jobs/123',
    jobDescription: 'We need Python, SQL, ML, and experimentation.',
  });

  assert.match(p, /Surgically tailor/i);
  assert.match(p, /Do NOT invent/i);
  assert.match(p, /HARD LIMIT: <= 600 words/i);
  assert.match(p, /target 400–600 words|target 400-600 words/i);
  assert.match(p, /Return ONLY valid JSON/i);
  assert.match(p, /"tailored_resume_text"/);
});

test('tailorPrompt clips very long job descriptions', () => {
  const long = 'x'.repeat(20000);
  const p = buildTailorResumePrompt({ jobDescription: long });
  // Should not include the full 20k characters.
  assert.ok(p.length < long.length);
});
