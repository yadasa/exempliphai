"use client";

import { httpsCallable } from "firebase/functions";
import { getFirebase } from "@/lib/firebase/client";

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
  const { functions } = getFirebase();
  const fn = httpsCallable(functions, "getOrCreateReferralCode");
  const res = await fn({});
  return String((res.data as any)?.code || "");
}

export async function listMyReferrals(): Promise<ListMyReferralsResponse> {
  const { functions } = getFirebase();
  const fn = httpsCallable(functions, "listMyReferrals");
  const res = await fn({});
  return (res.data || {}) as any;
}

export async function applyAttribution(attributionId: string): Promise<any> {
  const { functions } = getFirebase();
  const fn = httpsCallable(functions, "applyAttribution");
  const res = await fn({ attributionId });
  return res.data;
}
