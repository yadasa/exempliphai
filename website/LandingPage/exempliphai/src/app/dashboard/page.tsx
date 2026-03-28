"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import { NavCard } from "@/components/nav-card";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import schema from "@/config/local_profile_schema.json";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function ApplicationsChart({
  data,
}: {
  data: Array<{ day: string; total: number }>;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Total applications</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Mock data for now — will connect to real tracking soon.
          </div>
        </div>
      </div>

      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                borderColor: "rgba(255,255,255,0.12)",
                background: "rgba(15,15,15,0.9)",
              }}
              labelStyle={{ color: "rgba(255,255,255,0.8)" }}
              itemStyle={{ color: "white" }}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardInner />
    </RequireAuth>
  );
}

function DashboardInner() {
  const { user } = useAuth();

  const [paidPlan, setPaidPlan] = useState(false);
  const [autofillsTotal, setAutofillsTotal] = useState(0);

  const [userDoc, setUserDoc] = useState<Record<string, any> | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      const data = (snap.data() as any) || {};
      setUserDoc(data);

      setPaidPlan(!!data?.paidPlan);
      setAutofillsTotal(Number(data?.stats?.autofills?.total || 0));

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
    });
  }, [user?.uid]);

  async function completeOnboarding(profilePatch: Record<string, any>) {
    if (!user) throw new Error("Not signed in");
    const { db } = getFirebase();

    await setDoc(
      doc(db, "users", user.uid),
      {
        ...profilePatch,
        onboarding: {
          version: Number((schema as any).version || 1),
          completedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    setUserDoc((prev) => ({ ...(prev || {}), ...profilePatch }));
  }

  const onboardingInitialProfile = useMemo(() => {
    const base = (userDoc || {}) as any;
    const phoneFromAuth = String(user?.phoneNumber || "").trim();
    const existingPhone = String(base?.phone || "").trim();

    return {
      ...base,
      account: {
        ...(base?.account || {}),
        phoneNumber: base?.account?.phoneNumber || phoneFromAuth || null,
      },
      phone: existingPhone || phoneFromAuth || null,
    };
  }, [userDoc, user?.phoneNumber]);

  const totalApps = autofillsTotal;
  const timeSavedHours = (totalApps * 14) / 60;

  const appsSeries: Array<{ day: string; total: number }> = [
    { day: "Mon", total: Math.round(totalApps * 0.1) },
    { day: "Tue", total: Math.round(totalApps * 0.22) },
    { day: "Wed", total: Math.round(totalApps * 0.36) },
    { day: "Thu", total: Math.round(totalApps * 0.44) },
    { day: "Fri", total: Math.round(totalApps * 0.58) },
    { day: "Sat", total: Math.round(totalApps * 0.78) },
    { day: "Sun", total: totalApps },
  ];

  return (
    <div className="container py-14 md:py-16">
      <OnboardingModal
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        initialProfile={onboardingInitialProfile}
        onComplete={completeOnboarding}
      />

      <div className="mx-auto max-w-5xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
          style={{
            background:
              "radial-gradient(900px 520px at 20% 10%, color-mix(in oklab, var(--color-primary) 24%, transparent), transparent 62%), radial-gradient(900px 520px at 80% 15%, color-mix(in oklab, var(--brand-violet) 22%, transparent), transparent 58%)",
          }}
        />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Quick links to your profile and tools.
          </p>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total apps" value={String(totalApps)} />
          <StatCard label="Time saved" value={`~${timeSavedHours.toFixed(1)} hrs`} />
          <StatCard label="Autofills" value={String(autofillsTotal)} />
          <StatCard label="Tailored resumes" value="—" />
        </div>

        <div className="mt-4">
          <ApplicationsChart data={appsSeries} />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NavCard href="/profile" title="Profile" desc="Edit your autofill profile." />
          <NavCard href="/resume-tailoring" title="Resume Tailoring" desc="Coming soon." />
          <NavCard href="/job-search" title="Job Search" desc="Coming soon." />
          <NavCard
            href="/subscription"
            title="Manage Subscription"
            desc={paidPlan ? "Manage your plan and billing." : "Upgrade and manage your plan."}
            gradient
          />
        </div>

        {!paidPlan ? (
          <div className="mt-8 rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Upgrade to Pro</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Early access pricing and priority support.
                </div>
              </div>
              <Link
                href={"/subscription" as any}
                className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View plans
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
