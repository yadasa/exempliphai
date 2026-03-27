/**
 * URL rules for Job Search recommendations.
 * Ported from the Chrome extension.
 */

export type JobLink = { label?: string; url: string };

export function normalizeUrl(url: string) {
  return String(url || "").trim();
}

export function isSearchEngineUrl(url: string) {
  const u = normalizeUrl(url);
  if (!u) return false;

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }

  const host = (parsed.hostname || "").toLowerCase();
  const path = (parsed.pathname || "").toLowerCase();

  if (
    host === "google.com" ||
    host === "www.google.com" ||
    host === "bing.com" ||
    host === "www.bing.com" ||
    host === "duckduckgo.com" ||
    host === "www.duckduckgo.com" ||
    host === "search.yahoo.com"
  ) {
    return true;
  }

  if (path === "/search" || path.startsWith("/search/")) return true;

  return false;
}

export function isDirectApplicationUrl(url: string) {
  const u = normalizeUrl(url);
  if (!u) return false;

  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (isSearchEngineUrl(u)) return false;

  const host = (parsed.hostname || "").toLowerCase();
  const path = (parsed.pathname || "").toLowerCase();

  if (host.endsWith("linkedin.com")) {
    return path.includes("/jobs/view");
  }

  if (host === "boards.greenhouse.io" || host.endsWith(".greenhouse.io")) return true;
  if (host === "jobs.lever.co") return true;
  if (host.endsWith("myworkdayjobs.com") || host.endsWith("workdayjobs.com")) return true;
  if (host === "jobs.smartrecruiters.com") return true;
  if (host === "apply.workable.com") return true;
  if (host.endsWith("ashbyhq.com")) return true;
  if (host.endsWith("icims.com")) return true;
  if (host === "app.bamboohr.com") return true;

  if (/\/(job|jobs|careers)\b/.test(path)) return true;

  return false;
}

export function filterDirectApplicationLinks(links: unknown): JobLink[] {
  const arr = Array.isArray(links) ? links : [];
  return arr
    .map((l: any) => ({
      label: l?.label ? String(l.label) : "",
      url: normalizeUrl(l?.url || ""),
    }))
    .filter((l: JobLink) => isDirectApplicationUrl(l.url));
}
