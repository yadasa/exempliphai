export type JobLink = { label?: string; url?: string };
export type CleanJobLink = { label: string; url: string };

export function normalizeUrl(url: string): string;
export function isSearchEngineUrl(url: string): boolean;
export function isDirectApplicationUrl(url: string): boolean;
export function filterDirectApplicationLinks(links: unknown): CleanJobLink[];
