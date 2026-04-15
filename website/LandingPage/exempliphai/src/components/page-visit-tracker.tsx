"use client";

import { useEffect } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { getFirebase } from "@/lib/firebase/client";

const VISIT_KEY = "exempliphai_landing_visit_logged_v1";

export function PageVisitTracker() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Avoid counting reload loops during local dev or soft navigations.
    try {
      if (window.sessionStorage.getItem(VISIT_KEY) === "1") return;
      window.sessionStorage.setItem(VISIT_KEY, "1");
    } catch {
      // If storage is blocked, proceed without dedupe.
    }

    const { db, configured } = getFirebase();
    if (!configured) return;

    // Firestore rules allow CREATE only (no reads).
    // A backend trigger increments the global counter.
    void addDoc(collection(db, "global", "metrics", "pageVisits"), {
      createdAt: serverTimestamp(),
      path: window.location.pathname,
      ref: document.referrer || null,
    }).catch((err) => {
      // Keep the landing page resilient, but log for debugging.
      console.warn("[metrics] failed to log page visit", err);
    });
  }, []);

  return null;
}
