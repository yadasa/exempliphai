"use client";

import { httpsCallable } from "firebase/functions";

import { getFirebase } from "@/lib/firebase/client";

async function requireSignedIn() {
  const { auth, functions } = getFirebase();
  const user = auth?.currentUser;
  if (!user) throw new Error("Not signed in");
  return { user, functions };
}

async function callCallable<TOut = any, TIn = any>(name: string, data?: TIn): Promise<TOut> {
  const { functions } = await requireSignedIn();
  const fn = httpsCallable(functions, name);
  const res = await fn(data || ({} as any));
  return (res?.data || {}) as TOut;
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
  const out = await callCallable<{ code?: string }>("getOrCreateReferralCode");
  return String(out?.code || "");
}

export async function listMyReferrals(): Promise<ListMyReferralsResponse> {
  const out = await callCallable<ListMyReferralsResponse>("listMyReferrals");
  return (out || {}) as any;
}

export async function applyAttribution(attributionId: string): Promise<any> {
  const out = await callCallable<any, { attributionId: string }>("applyAttribution", {
    attributionId: String(attributionId || ""),
  });
  return out;
}
