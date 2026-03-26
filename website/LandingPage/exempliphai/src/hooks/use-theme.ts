"use client";

import { useEffect, useState } from "react";

export type ThemeMode = "light" | "dark";

function getInitialTheme(): ThemeMode {
  // Default to dark.
  // NOTE: this runs client-side; layout.tsx also sets an early theme class.
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") return saved;
  return "dark";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("theme", theme);
  }, [theme]);

  return {
    theme,
    setTheme,
    toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}
