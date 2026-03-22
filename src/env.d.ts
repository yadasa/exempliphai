/// <reference types="vite/client" />

// Allow Vue popup code to import the shared Gemini provider implementation
// that also ships as a runtime-imported ESM for content scripts.
// (We keep it as JS for MV3 compatibility; popup TS needs a module shim.)
declare module '*contentScripts/providers/gemini.js' {
  export const GEMINI_DEFAULT_MODEL: string;
  export const GEMINI_API_BASE: string;

  export function buildTier1MappingSystemPrompt(): string;
  export function buildTier1MappingUserPrompt(args?: any): string;

  export function buildTier2NarrativeSystemPrompt(): string;
  export function buildTier2NarrativeUserPrompt(args?: any): string;

  export function buildTailorSystemPrompt(): string;
  export function buildTailorUserPrompt(args?: any): string;
  export function tailorResume(args?: any): Promise<any>;

  export function buildJobSearchSystemPrompt(): string;
  export function buildJobSearchUserPrompt(args?: any): string;
  export function recommendJobs(args?: any): Promise<any>;

  export function createGeminiProvider(cfg?: any): any;
  export function mapFieldsToFillPlan(args?: any): Promise<any>;
  export function generateNarrativeAnswer(args?: any): Promise<string>;
}
