import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { UI_TEXT_FORCE_LOWERCASE } from "@/config/ui";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Apply the global UI-text style rules.
 *
 * Keep this intentionally dumb (no locale tricks) so it is predictable.
 */
export function uiText(s: string): string {
  const v = String(s ?? "");
  return UI_TEXT_FORCE_LOWERCASE ? v.toLowerCase() : v;
}
