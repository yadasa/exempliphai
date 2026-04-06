/**
 * URL rules for Job Search recommendations.
 *
 * Goal: prioritize DIRECT application links (company site / ATS).
 * We default-deny aggregators because they often force account creation.
 */

export function normalizeUrl(url) {
  const u = String(url || '').trim();
  if (!u) return '';

  // Unwrap common redirectors (e.g., Google /url?q=...)
  try {
    const parsed = new URL(u);
    const host = (parsed.hostname || '').toLowerCase();
    const path = (parsed.pathname || '').toLowerCase();

    if ((host === 'google.com' || host === 'www.google.com') && path === '/url') {
      const q = parsed.searchParams.get('q') || parsed.searchParams.get('url');
      if (q && /^https?:\/\//i.test(q)) return q;
    }
  } catch {
    // ignore
  }

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

export function isAggregatorHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  const deny = [
    'indeed.com',
    'ziprecruiter.com',
    'glassdoor.com',
    'monster.com',
    'talent.com',
    'jooble.org',
    'simplyhired.com',
    'careerbuilder.com',
  ];
  return deny.some((d) => h === d || h.endsWith(`.${d}`) || h.includes(d));
}

export function looksLikeTrackingOrRedirectUrl(url) {
  const u = normalizeUrl(url);
  if (!u) return false;
  try {
    const parsed = new URL(u);
    const host = (parsed.hostname || '').toLowerCase();
    const path = (parsed.pathname || '').toLowerCase();
    const qs = parsed.search.toLowerCase();

    // Common redirectors / tracking URLs
    if (host.includes('google.com') && path === '/url') return true;
    if (path.includes('/rc/clk')) return true; // Indeed
    if (path.includes('/pagead/')) return true;
    if (qs.includes('utm_') || qs.includes('gclid=') || qs.includes('fbclid=')) return true;
    if (qs.includes('redirect=') || qs.includes('redir=') || qs.includes('url=')) return true;
  } catch {
    return false;
  }
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

  // Default-deny aggregators (account-gated / spammy apply flows)
  if (isAggregatorHost(host)) return false;

  // LinkedIn: allow only actual job posting URLs (still account-gated, but not a search/redirect page)
  if (host === 'linkedin.com' || host.endsWith('.linkedin.com')) {
    if (path.includes('/jobs/view')) return true;
    return false;
  }

  // ATS allow-list
  if (host === 'boards.greenhouse.io' || host.endsWith('.greenhouse.io')) return true;
  if (host === 'jobs.lever.co') return true;
  if (host.endsWith('myworkdayjobs.com') || host.endsWith('workdayjobs.com')) return true;
  if (host === 'jobs.smartrecruiters.com') return true;
  if (host === 'apply.workable.com') return true;
  if (host.endsWith('ashbyhq.com')) return true;
  if (host.endsWith('icims.com')) return true;
  if (host === 'app.bamboohr.com') return true;
  if (host.endsWith('oraclecloud.com') || host.endsWith('taleo.net')) return true;
  if (host.endsWith('successfactors.com') || host.endsWith('successfactors.eu')) return true;
  if (host.endsWith('recruitee.com')) return true;

  // Company careers fallback heuristics
  if (/\/(careers?|jobs?|positions?|opportunities?|apply)\b/.test(path)) return true;

  return false;
}

export function scoreApplicationLink(url) {
  const u = normalizeUrl(url);
  if (!u) return -999;
  let parsed;
  try {
    parsed = new URL(u);
  } catch {
    return -999;
  }

  const host = (parsed.hostname || '').toLowerCase();
  let score = 0;

  if (isAggregatorHost(host)) score -= 10;
  if (looksLikeTrackingOrRedirectUrl(u)) score -= 5;

  // Strong ATS signals
  if (host === 'jobs.lever.co') score += 5;
  if (host.includes('greenhouse.io')) score += 5;
  if (host.includes('ashbyhq.com')) score += 5;

  // Other ATS
  if (host.includes('workdayjobs.com') || host.includes('myworkdayjobs.com')) score += 4;
  if (host.includes('smartrecruiters.com')) score += 4;
  if (host.includes('workable.com')) score += 4;
  if (host.includes('icims.com')) score += 3;
  if (host.includes('bamboohr.com')) score += 3;
  if (host.includes('oraclecloud.com') || host.includes('taleo.net')) score += 3;
  if (host.includes('successfactors')) score += 3;

  // Company site heuristic (not ATS/aggregator/search)
  if (score === 0 && !isSearchEngineUrl(u)) score += 2;

  return score;
}

export function pickBestApplicationLinks(links, max = 2) {
  const arr = Array.isArray(links) ? links : [];

  const normalized = arr
    .map((l) => {
      if (typeof l === 'string') return { label: '', url: normalizeUrl(l) };
      return { label: l?.label ? String(l.label) : '', url: normalizeUrl(l?.url || '') };
    })
    .filter((l) => !!l.url);

  // Hard filter: must be direct-apply URLs.
  const direct = normalized.filter((l) => isDirectApplicationUrl(l.url));

  // Score + pick top N.
  const scored = direct
    .map((l) => ({ ...l, _score: scoreApplicationLink(l.url) }))
    .sort((a, b) => Number(b._score || 0) - Number(a._score || 0));

  return scored.slice(0, Math.max(1, Math.min(4, Number(max || 2)))).map(({ _score, ...rest }) => rest);
}

export function filterDirectApplicationLinks(links) {
  // Back-compat: keep name, but now we pick the best links.
  return pickBestApplicationLinks(links, 2);
}
