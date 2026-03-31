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

export async function getTokenBalance(): Promise<{ tokens: number; low: boolean }> {
  const json = await authedFetchJson("/api/billing/balance");
  return {
    tokens: Number(json?.tokens || 0) || 0,
    low: !!json?.low,
  };
}

export async function createTokenCheckout(usd: 1 | 5 | 10 | 25 | 50): Promise<{ url: string }> {
  const json = await authedFetchJson("/api/tokens/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ usd }),
  });
  return { url: String(json?.url || "") };
}
