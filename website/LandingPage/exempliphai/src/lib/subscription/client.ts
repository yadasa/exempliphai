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
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(String((json as any)?.error || `http_${res.status}`));
  }

  return json as any;
}

export async function createPlusSubscriptionCheckout(): Promise<{ url: string }> {
  const json = await authedFetchJson("/api/subscription/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { url: String((json as any)?.url || "") };
}
