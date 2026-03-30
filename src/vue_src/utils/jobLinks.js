/**
 * URL rules for Job Search recommendations.
 *
 * Goal: allow only DIRECT job posting / application links.
 * Explicitly reject search-engine result pages.
 */

export function normalizeUrl(url) {
  const u = String(url || '').trim();
  return u;
}

export function isSearchEngineUrl(url) {
  const u = normalizeUrl(url);
  if (!u) return false;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }

  const host = (parsed.hostname || '').toLowerCase();
  const path = (parsed.pathname || '').toLowerCase();

  // Search engines
  if (
    host === 'google.com' ||
    host === 'www.google.com' ||
    host === 'bing.com' ||
    host === 'www.bing.com' ||
    host === 'duckduckgo.com' ||
    host === 'www.duckduckgo.com' ||
    host === 'search.yahoo.com'
  ) {
    return true;
  }

  // Common search paths on non-search hosts
  if (path === '/search' || path.startsWith('/search/')) return true;

  return false;
}

export function isDirectApplicationUrl(url) {
  const u = normalizeUrl(url);
  if (!u) return false;

  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  if (isSearchEngineUrl(u)) return false;

  const host = (parsed.hostname || '').toLowerCase();
  const path = (parsed.pathname || '').toLowerCase();

  // Explicit allow-list for common job boards / ATS postings.
  if (host.endsWith('linkedin.com')) {
    // Prefer job-posting URLs (not general searches).
    if (path.includes('/jobs/view')) return true;
    return false;
  }

  if (host === 'boards.greenhouse.io' || host.endsWith('.greenhouse.io')) return true;
  if (host === 'jobs.lever.co') return true;
  if (host.endsWith('myworkdayjobs.com') || host.endsWith('workdayjobs.com')) return true;
  if (host === 'jobs.smartrecruiters.com') return true;
  if (host === 'apply.workable.com') return true;
  if (host.endsWith('ashbyhq.com')) return true;
  if (host.endsWith('icims.com')) return true;
  if (host === 'app.bamboohr.com') return true;

  // Fallback: accept obvious company career posting URLs.
  // (Still rejects search engines above.)
  if (/\/(job|jobs|careers)\b/.test(path)) return true;

  return false;
}

export function filterDirectApplicationLinks(links) {
  const arr = Array.isArray(links) ? links : [];

  return arr
    .map((l) => {
      // Allow either {label,url} objects OR plain string URLs.
      if (typeof l === 'string') {
        return { label: '', url: normalizeUrl(l) };
      }
      return {
        label: l?.label ? String(l.label) : '',
        url: normalizeUrl(l?.url || ''),
      };
    })
    .filter((l) => isDirectApplicationUrl(l.url));
}
