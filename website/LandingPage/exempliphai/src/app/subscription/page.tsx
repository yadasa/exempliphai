"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountNavCards } from "@/components/AccountNavCards";
import { doc, onSnapshot } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";

const PLUS_ONLY_FEATURES = [
  "Job Search recommendations (AI-curated matches)",
  "Resume tailoring (auto-tailor + tailored downloads)",
  "List mode batch apply (CSV queue)",
  "AI-assisted autofill (field mapping)",
  "Auto-submit after autofill",
] as const;

export default function SubscriptionPage() {
  return (
    <RequireAuth>
      <SubscriptionInner />
    </RequireAuth>
  );
}

function SubscriptionInner() {
  const { user } = useAuth();
  const [paidPlan, setPaidPlan] = useState(false);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      const data = (snap.data() as any) || {};
      setPaidPlan(!!data?.paidPlan);
    });
  }, [user?.uid]);

  return (
    <div className="container py-14 md:py-16">
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

          <div className="mt-5 rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
            Billing management is coming soon.
          </div>
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Plus plan features</div>
            <div className="text-xs text-muted-foreground">Coming soon</div>
          </div>

          <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {PLUS_ONLY_FEATURES.map((f) => (
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
  );
}
