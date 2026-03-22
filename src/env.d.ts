/// <reference types="vite/client" />

// Allow Vue popup code to import the shared OpenRouter GPT-5.2 provider implementation
// that also ships as a runtime-imported ESM for content scripts.
// (We keep it as JS for MV3 compatibility; popup TS needs a module shim.)
declare module '*contentScripts/providers/gpt52.js' {
  export const GPT52_DEFAULT_MODEL: string;
  export const OPENROUTER_API_BASE: string;

  export function buildTailorSystemPrompt(): string;
  export function buildTailorUserPrompt(args?: any): string;

  export function buildJobSearchSystemPrompt(): string;
  export function buildJobSearchUserPrompt(args?: any): string;

  export function createGpt52Provider(cfg?: any): any;
  export function tailorResume(args?: any): Promise<any>;
  export function recommendJobs(args?: any): Promise<any>;
}

