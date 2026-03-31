"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import {
  applyAttribution,
  getOrCreateReferralCode,
  listMyReferrals,
  redeemPlusWeek,
  type ListMyReferralsResponse,
} from "@/lib/referrals/client";
import schema from "@/config/local_profile_schema.json";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import { AccountNavCards } from "@/components/AccountNavCards";

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountInner />
    </RequireAuth>
  );
}

function AccountInner() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [userDoc, setUserDoc] = useState<Record<string, any> | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const [tab, setTab] = useState<"account" | "referrals">("account");

  useEffect(() => {
    const t = (searchParams?.get("tab") || "").toLowerCase();
    if (t === "referrals") setTab("referrals");
  }, [searchParams]);

  const [refBusy, setRefBusy] = useState(false);
  const [refCode, setRefCode] = useState<string>("");
  const [refStats, setRefStats] = useState<ListMyReferralsResponse | null>(null);

  const effectiveRefCode = useMemo(() => {
    const fromState = String(refCode || "").trim();
    if (fromState) return fromState;
    const fromDoc = String((userDoc as any)?.referral?.code || "").trim();
    return fromDoc;
  }, [refCode, userDoc]);

  const referralLink = useMemo(() => {
    if (!effectiveRefCode) return "";
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/r/${effectiveRefCode}`;
  }, [effectiveRefCode]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!user) return;
        const { db } = getFirebase();
        const snap = await getDoc(doc(db, "users", user.uid));
        const data = (snap.data() as any) || {};
        const dn = data?.account?.displayName;

        if (!alive) return;
        setDisplayName(String(dn || ""));
        setUserDoc(data);

        const onboardingVersion = Number(data?.onboarding?.version || 0);
        const completedAt = data?.onboarding?.completedAt;
        const missingRequired =
          !String(data?.first_name || "").trim() ||
          !String(data?.last_name || "").trim() ||
          !String(data?.email || "").trim();
        const needsOnboarding =
          onboardingVersion !== Number((schema as any).version || 1) ||
          !completedAt ||
          missingRequired;
        if (needsOnboarding) setOnboardingOpen(true);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  // If the user arrived via /r/CODE, the /r index sets ref_attr cookie.
  // Apply it once after sign-in, then clear the cookie.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!user) return;
        if (typeof document === "undefined") return;

        const cookie = document.cookie || "";
        const m = cookie.match(/(?:^|;\s*)ref_attr=([^;]+)/);
        const attrId = m ? decodeURIComponent(m[1]) : "";
        if (!attrId) return;

        await applyAttribution(attrId);
        if (!alive) return;

        document.cookie = `ref_attr=; Max-Age=0; Path=/; SameSite=Lax`;
        setMsg("Referral applied. Thanks for signing up!");
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) return;
      if (tab !== "referrals") return;

      setErr(null);
      setMsg(null);
      setRefBusy(true);

      const existingCode = String((userDoc as any)?.referral?.code || "").trim();

      try {
        // 1) Prefer the callable (creates a code for new users).
        // If it fails, fall back to the code already stored on the user doc.
        let code = "";
        try {
          code = await getOrCreateReferralCode();
        } catch (e) {
          if (!existingCode) throw e;
          code = existingCode;
        }

        if (!alive) return;
        if (code) setRefCode(code);

        // 2) Referral list/stats (best-effort; don't block showing the link).
        try {
          const stats = await listMyReferrals();
          if (!alive) return;
          setRefStats(stats);
        } catch (e: any) {
          if (!alive) return;
          setRefStats(null);
          setErr(String(e?.message || e));
        }
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message || e));
      } finally {
        if (alive) setRefBusy(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [user, tab, userDoc]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (!user) throw new Error("Not signed in");
      const { db } = getFirebase();
      await setDoc(
        doc(db, "users", user.uid),
        {
          account: {
            uid: user.uid,
            phoneNumber: user.phoneNumber || null,
            displayName: displayName.trim() || null,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setMsg("Saved.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { auth } = getFirebase();
      await signOut(auth);
      router.replace("/login");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function completeOnboarding(profilePatch: Record<string, any>) {
    if (!user) throw new Error("Not signed in");
    const { db } = getFirebase();

    await setDoc(
      doc(db, "users", user.uid),
      {
        ...profilePatch,
        onboarding: { version: Number((schema as any).version || 1), completedAt: serverTimestamp() },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  const onboardingInitialProfile = useMemo(() => {
    const base = (userDoc as any) || {};
    const phoneFromAuth = String(user?.phoneNumber || "").trim();
    const existingPhone = String(base?.phone || "").trim();

    return {
      ...base,
      phone: existingPhone || phoneFromAuth || null,
    };
  }, [userDoc, user?.phoneNumber]);

  return (
    <div className="container py-20 md:py-24">
      <OnboardingModal
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        initialProfile={onboardingInitialProfile}
        onComplete={completeOnboarding}
      />

      <div className="mx-auto max-w-2xl">
        <AccountNavCards className="mb-6" />

        <div className="rounded-2xl border bg-card p-6 shadow-sm md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium">
              {String(displayName || "").trim() ||
                String((userDoc as any)?.first_name || "").trim() ||
                String(user?.phoneNumber || "").trim()}
            </span>
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("account")}
              className={`h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "account"
                  ? "bg-gradient-primary text-primary-foreground"
                  : "border bg-card hover:bg-muted"
              }`}
            >
              Account
            </button>
            <button
              type="button"
              onClick={() => setTab("referrals")}
              className={`h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "referrals"
                  ? "bg-gradient-primary text-primary-foreground"
                  : "border bg-card hover:bg-muted"
              }`}
            >
              Referrals
            </button>
          </div>

          <div aria-live="polite" aria-atomic="true">
            {err ? (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
                {err}
              </div>
            ) : null}
            {msg ? (
              <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
                {msg}
              </div>
            ) : null}
          </div>

          {tab === "account" ? (
            <>
              <div className="mt-6 grid gap-3">
                <label className="grid gap-1" htmlFor="account-display-name">
                  <span className="text-sm font-medium">Display Name</span>
                  <input
                    id="account-display-name"
                    className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Jane Doe"
                    disabled={busy}
                  />
                </label>

                <div className="flex flex-wrap gap-3">
                  <button
                    className="bg-gradient-primary h-11 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    onClick={save}
                    disabled={busy}
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                    onClick={logout}
                    disabled={busy}
                    type="button"
                  >
                    Sign out
                  </button>
                </div>
              </div>

              <div className="mt-6 text-xs text-muted-foreground">UID: {user?.uid}</div>
            </>
          ) : (
            <div className="mt-6 grid gap-6">
              <div className="rounded-xl border bg-background/40 p-4">
                <div className="text-sm font-semibold">Your referral link</div>
                <div className="mt-2 grid gap-2">
                  <div className="text-xs text-muted-foreground">
                    Share this link with friends, earn free Plus membership when they join!
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none"
                      value={referralLink || (refBusy ? "Loading…" : "")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
                      disabled={!referralLink}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(referralLink);
                          setMsg("Copied referral link.");
                        } catch {
                          setErr("Could not copy.");
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Code:{" "}
                    <span className="font-mono">
                      {effectiveRefCode || (refBusy ? "…" : "")}
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-background/40 p-4">
                  <div className="text-xs text-muted-foreground">Total referrals</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {refStats?.totalReferrals ?? (refBusy ? "…" : 0)}
                  </div>
                </div>
                <div className="rounded-xl border bg-background/40 p-4">
                  <div className="text-xs text-muted-foreground">Points</div>
                  <div className="mt-1 text-2xl font-semibold">
                    {refStats?.totalPoints ?? (refBusy ? "…" : 0)}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted disabled:opacity-60"
                      disabled={refBusy || Number(refStats?.totalPoints || 0) < 10}
                      onClick={async () => {
                        try {
                          setErr(null);
                          setMsg(null);
                          setRefBusy(true);
                          await redeemPlusWeek();
                          setMsg("Redeemed 10 points for 1 week of Plus.");
                          try {
                            const stats = await listMyReferrals();
                            setRefStats(stats);
                          } catch (_) {}
                        } catch (e: any) {
                          setErr(String(e?.message || e));
                        } finally {
                          setRefBusy(false);
                        }
                      }}
                    >
                      Exchange
                    </button>
                    <div className="mt-2 text-xs text-muted-foreground">
                      10 points → 1 week Plus plan
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border bg-background/40 p-4">
                <div className="text-sm font-semibold">Your referrals</div>
                <div className="mt-3 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-4">Who</th>
                        <th className="py-2 pr-4">When</th>
                        <th className="py-2 pr-0 text-right">Points</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(refStats?.referrals || []).length ? (
                        (refStats?.referrals || []).map((r) => (
                          <tr key={r.referredUid} className="border-t">
                            <td className="py-2 pr-4">{r.who}</td>
                            <td className="py-2 pr-4 text-xs text-muted-foreground">
                              {r.createdAt
                                ? new Date(r.createdAt).toLocaleDateString()
                                : "—"}
                            </td>
                            <td className="py-2 pr-0 text-right font-medium">
                              {r.pointsAwarded}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t">
                          <td className="py-3 text-xs text-muted-foreground" colSpan={3}>
                            {refBusy ? "Loading…" : "No referrals yet."}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
