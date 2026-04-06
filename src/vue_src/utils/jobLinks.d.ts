export type JobLink = { label?: string; url?: string };
export type CleanJobLink = { label: string; url: string };

export function normalizeUrl(url: string): string;
export function isSearchEngineUrl(url: string): boolean;
export function isAggregatorHost(hostname: string): boolean;
export function looksLikeTrackingOrRedirectUrl(url: string): boolean;
export function isDirectApplicationUrl(url: string): boolean;
export function scoreApplicationLink(url: string): number;
export function pickBestApplicationLinks(links: unknown, max?: number): CleanJobLink[];
export function filterDirectApplicationLinks(links: unknown): CleanJobLink[];
