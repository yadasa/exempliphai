"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AccountNavCards } from "@/components/AccountNavCards";
import { doc, onSnapshot } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import { createPlusSubscriptionCheckout } from "@/lib/subscription/client";

const FREE_PLAN_FEATURES = [
  "Autofill applications",
  "Tailor resumes for each job",
  "Track applied-to jobs",
] as const;

const PLUS_PLAN_FEATURES = [
  "Job Search recommendations (AI-curated matches)",
  "Resume tailoring (auto-tailor + tailored downloads)",
  "List mode batch apply (CSV queue)",
  "AI-assisted autofill (field mapping)",
  "Auto-submit after autofill",
  "400 tokens per week",
] as const;

// (Upgrade link is now created server-side via /api/subscription/checkout)


export default function SubscriptionPage() {
  return (
    <RequireAuth>
      <SubscriptionInner />
    </RequireAuth>
  );
}

function SubscriptionInner() {
  const { user } = useAuth();
  const sp = useSearchParams();
  const [paidPlan, setPaidPlan] = useState(false);
  const [banner, setBanner] = useState<null | { kind: "success" | "error"; text: string }>(null);
  const [upgradeBusy, setUpgradeBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      const data = (snap.data() as any) || {};
      const untilMs = data?.paidPlanUntil?.toMillis?.() ? Number(data.paidPlanUntil.toMillis()) : 0;
      const active = !!data?.paidPlan || (!!untilMs && Date.now() < untilMs);
      setPaidPlan(active);
    });
  }, [user?.uid]);

  // Short-lived success/cancel banner when returning from Stripe.
  useEffect(() => {
    const success = sp?.get("success") === "1";
    const canceled = sp?.get("canceled") === "1";

    if (success) setBanner({ kind: "success", text: "Payment complete" });
    else if (canceled) setBanner({ kind: "error", text: "Payment failed" });
    else setBanner(null);

    if (!success && !canceled) return;
    const t = window.setTimeout(() => setBanner(null), 7000);
    return () => window.clearTimeout(t);
  }, [sp]);

  const startUpgrade = async () => {
    if (upgradeBusy) return;
    setUpgradeBusy(true);
    try {
      const { url } = await createPlusSubscriptionCheckout();
      if (!url) throw new Error("missing_checkout_url");
      window.location.href = url;
    } catch (_) {
      setBanner({ kind: "error", text: "Payment failed" });
      window.setTimeout(() => setBanner(null), 7000);
    } finally {
      setUpgradeBusy(false);
    }
  };

  return (
    <div className="container py-14 md:py-16">
      <style jsx>{`
        .sub-upgrade-btn {
          background-image: linear-gradient(90deg, #3b82f6, #8b5cf6);
          color: white;
          box-shadow: 0 0 18px rgba(99, 102, 241, 0.35);
          animation: subGlow 2.2s ease-in-out infinite, subHue 5.5s linear infinite;
        }
        @keyframes subGlow {
          0%, 100% { box-shadow: 0 0 14px rgba(99, 102, 241, 0.28), 0 0 0 rgba(0,0,0,0); transform: translateY(0); }
          50% { box-shadow: 0 0 26px rgba(139, 92, 246, 0.55), 0 0 42px rgba(59, 130, 246, 0.35); transform: translateY(-1px); }
        }
        @keyframes subHue {
          0% { filter: hue-rotate(0deg) saturate(1.05); }
          50% { filter: hue-rotate(18deg) saturate(1.15); }
          100% { filter: hue-rotate(0deg) saturate(1.05); }
        }
      `}</style>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
        style={{
          background:
            "radial-gradient(900px 520px at 30% 15%, color-mix(in oklab, var(--color-primary) 26%, transparent), transparent 60%), radial-gradient(900px 520px at 80% 25%, color-mix(in oklab, var(--brand-violet) 24%, transparent), transparent 58%)",
        }}
      />

      <div className="mx-auto max-w-3xl">
        <AccountNavCards className="mb-6" />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Subscription</h1>
          <Link className="text-sm text-primary underline" href={"/dashboard" as any}>
            Back to dashboard
          </Link>
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold">Manage Subscription</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {paidPlan
              ? "Your account is currently on a paid plan."
              : "You're currently on the free plan."}
          </div>

          {banner ? (
            <div
              className={
                "mt-4 rounded-xl border p-3 text-sm font-medium " +
                (banner.kind === "success"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                  : "border-red-300 bg-red-50 text-red-900")
              }
              role="status"
            >
              {banner.text}
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
            Billing management is available via Stripe Checkout.
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="text-sm font-semibold">Free Plan</div>

            <div className="mt-3 text-4xl font-semibold tracking-tight">
              $0 <sub className="text-sm font-normal text-muted-foreground">/wk</sub>
            </div>

            <div className="mt-4">
              <button
                type="button"
                disabled={!paidPlan}
                className={
                  paidPlan
                    ? "w-full inline-flex h-11 items-center justify-center rounded-md border bg-background/70 px-4 text-sm font-semibold text-foreground/80 shadow-sm transition hover:bg-background/90 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    : "w-full inline-flex h-11 items-center justify-center rounded-md border bg-muted px-4 text-sm font-semibold text-muted-foreground cursor-not-allowed"
                }
              >
                {paidPlan ? "Downgrade" : "Current plan"}
              </button>
            </div>

            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {FREE_PLAN_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">Plus Plan</div>
            </div>

            <div className="mt-3 text-4xl font-semibold tracking-tight">
              $6<sup className="text-2xl">78</sup>{" "}
              <sub className="text-sm font-normal text-muted-foreground">/wk</sub>
            </div>

            <div className="mt-4">
              <button
                type="button"
                disabled={paidPlan || upgradeBusy}
                onClick={() => void startUpgrade()}
                className={
                  paidPlan || upgradeBusy
                    ? "w-full inline-flex h-11 items-center justify-center rounded-md border bg-muted px-4 text-sm font-semibold text-muted-foreground cursor-not-allowed"
                    : "w-full inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sub-upgrade-btn"
                }
              >
                {paidPlan ? "Current plan" : upgradeBusy ? "Loading…" : "Upgrade"}
              </button>
            </div>

            <div className="mt-4 text-sm text-muted-foreground">the price of a cup of coffee</div>
            <div className="mt-1 text-sm text-muted-foreground">All the features in free plan, plus</div>

            <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {PLUS_PLAN_FEATURES.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>

            <div className="mt-4 text-sm text-muted-foreground">
              {paidPlan
                ? "You have access to these Plus-only features."
                : "These features are marked Plus-only in the extension."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
