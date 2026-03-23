import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSearchEngineUrl,
  isDirectApplicationUrl,
  filterDirectApplicationLinks,
} from '../vue_src/utils/jobLinks.js';

test('jobLinks: rejects search engine URLs', () => {
  assert.equal(isSearchEngineUrl('https://www.google.com/search?q=foo'), true);
  assert.equal(isDirectApplicationUrl('https://www.google.com/search?q=foo'), false);
  assert.equal(isDirectApplicationUrl('https://www.bing.com/search?q=foo'), false);
  assert.equal(isDirectApplicationUrl('https://duckduckgo.com/?q=foo'), false);
});

test('jobLinks: allows common direct application URLs', () => {
  assert.equal(isDirectApplicationUrl('https://www.linkedin.com/jobs/view/1234567890/'), true);
  assert.equal(isDirectApplicationUrl('https://boards.greenhouse.io/acme/jobs/123'), true);
  assert.equal(isDirectApplicationUrl('https://jobs.lever.co/acme/abcdef'), true);
  assert.equal(isDirectApplicationUrl('https://acme.myworkdayjobs.com/en-US/Careers/job/123'), true);
  assert.equal(isDirectApplicationUrl('https://jobs.smartrecruiters.com/Acme/12345'), true);
  assert.equal(isDirectApplicationUrl('https://apply.workable.com/acme/j/ABCDE/'), true);
  assert.equal(isDirectApplicationUrl('https://jobs.ashbyhq.com/acme/123'), true);
  assert.equal(isDirectApplicationUrl('https://careers.example.com/jobs/12345'), true);
});

test('jobLinks: rejects non-posting LinkedIn URLs', () => {
  assert.equal(isDirectApplicationUrl('https://www.linkedin.com/jobs/search/?keywords=engineer'), false);
});

test('jobLinks: filters out non-direct links from arrays', () => {
  const links = filterDirectApplicationLinks([
    { label: 'Search', url: 'https://www.google.com/search?q=acme%20engineer' },
    { label: 'LinkedIn', url: 'https://www.linkedin.com/jobs/view/1234567890/' },
    { label: 'Bad', url: 'notaurl' },
  ]);

  assert.equal(links.length, 1);
  assert.equal(links[0].label, 'LinkedIn');
  assert.equal(links[0].url, 'https://www.linkedin.com/jobs/view/1234567890/');
});
