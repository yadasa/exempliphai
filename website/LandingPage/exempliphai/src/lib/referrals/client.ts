"use client";

import { getFirebase } from "@/lib/firebase/client";

async function authedFetchJson(path: string, init?: RequestInit) {
  const { auth } = getFirebase();
  const user = auth?.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();

  const res = await fetch(path, {
    ...(init || {}),
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(String(json?.error || `http_${res.status}`));
  }

  return json;
}

export type ListMyReferralsResponse = {
  totalReferrals: number;
  totalPoints: number;
  referrals: Array<{
    referredUid: string;
    createdAt: string | null;
    pointsAwarded: number;
    who: string;
  }>;
};

export async function getOrCreateReferralCode(): Promise<string> {
  const json = await authedFetchJson("/api/referrals/code");
  return String(json?.code || "");
}

export async function listMyReferrals(): Promise<ListMyReferralsResponse> {
  const json = await authedFetchJson("/api/referrals/list");
  return (json || {}) as any;
}

export async function applyAttribution(attributionId: string): Promise<any> {
  const json = await authedFetchJson("/api/referrals/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attributionId }),
  });
  return json;
}
