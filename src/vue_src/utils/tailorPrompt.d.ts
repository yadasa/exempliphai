export type TailorPromptArgs = {
  jobTitle?: string;
  company?: string;
  pageUrl?: string;
  jobDescription?: string;
};

export function buildTailorResumePrompt(args?: TailorPromptArgs): string;
