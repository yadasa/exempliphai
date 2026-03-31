export type TailorPromptArgs = {
  jobTitle?: string;
  company?: string;
  pageUrl?: string;
  jobDescription?: string;
  jobDescriptionCharCount?: number;
  keywords?: {
    job_keywords?: string[];
    must_haves?: string[];
    nice_to_haves?: string[];
  };
  changeBudget?: {
    max_total_bullet_edits?: number;
    max_edits_per_role?: number;
  };
};

export type TailorKeywordsPromptArgs = {
  jobTitle?: string;
  company?: string;
  pageUrl?: string;
  jobDescription?: string;
  jobDescriptionCharCount?: number;
};

export function buildTailorKeywordsPrompt(args?: TailorKeywordsPromptArgs): string;
export function buildTailorResumePrompt(args?: TailorPromptArgs): string;
