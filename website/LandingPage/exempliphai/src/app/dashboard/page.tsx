"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from "firebase/firestore";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format, startOfDay, startOfWeek, subDays, subWeeks } from "date-fns";
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

function ComingSoonCard({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm opacity-60">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-1 text-sm text-muted-foreground">Coming soon.</div>
    </div>
  );
}

type AppsPoint = { day: string; total: number };

type Bucket = "daily" | "weekly";

function toDateMaybe(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;

  // Firestore Timestamp
  if (typeof v?.toDate === "function") {
    try {
      return v.toDate();
    } catch {
      return null;
    }
  }

  // Plain timestamp-like
  if (typeof v?.seconds === "number") {
    const ms = v.seconds * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  return null;
}

function buildAppsSeries(dates: Date[], bucket: Bucket): AppsPoint[] {
  const now = new Date();

  if (bucket === "weekly") {
    const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
    const start = subWeeks(thisWeek, 11);

    const counts = new Map<string, number>();
    for (const d of dates) {
      const wk = startOfWeek(d, { weekStartsOn: 1 });
      if (wk < start || wk > thisWeek) continue;
      const key = format(wk, "yyyy-MM-dd");
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const out: AppsPoint[] = [];
    for (let i = 0; i < 12; i++) {
      const wk = subWeeks(thisWeek, 11 - i);
      const key = format(wk, "yyyy-MM-dd");
      out.push({ day: format(wk, "MMM d"), total: counts.get(key) || 0 });
    }

    return out;
  }

  // daily (last 30 days)
  const end = startOfDay(now);
  const start = subDays(end, 29);

  const counts = new Map<string, number>();
  for (const d of dates) {
    const day = startOfDay(d);
    if (day < start || day > end) continue;
    const key = format(day, "yyyy-MM-dd");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const out: AppsPoint[] = [];
  for (let i = 0; i < 30; i++) {
    const day = subDays(end, 29 - i);
    const key = format(day, "yyyy-MM-dd");
    out.push({ day: format(day, "MMM d"), total: counts.get(key) || 0 });
  }

  return out;
}

function ApplicationsChart({
  data,
  bucket,
  onBucketChange,
  loading,
}: {
  data: AppsPoint[];
  bucket: Bucket;
  onBucketChange: (b: Bucket) => void;
  loading: boolean;
}) {
  const rangeTotal = useMemo(
    () => data.reduce((sum, p) => sum + Number(p.total || 0), 0),
    [data],
  );

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Total Applications</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {loading
              ? "Loading…"
              : bucket === "daily"
                ? `Last 30 days · ${rangeTotal} total`
                : `Last 12 weeks · ${rangeTotal} total`}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onBucketChange("daily")}
            className={`h-9 rounded-md border px-3 text-sm font-semibold transition hover:bg-muted ${
              bucket === "daily" ? "bg-muted" : "bg-card"
            }`}
          >
            Daily
          </button>
          <button
            type="button"
            onClick={() => onBucketChange("weekly")}
            className={`h-9 rounded-md border px-3 text-sm font-semibold transition hover:bg-muted ${
              bucket === "weekly" ? "bg-muted" : "bg-card"
            }`}
          >
            Weekly
          </button>
        </div>
      </div>

      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              interval={bucket === "daily" ? 4 : 0}
            />
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
  const [customAnswersTotal, setCustomAnswersTotal] = useState<number | null>(null);

  const [userDoc, setUserDoc] = useState<Record<string, any> | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const [autofillDates, setAutofillDates] = useState<Date[]>([]);
  const [appsBucket, setAppsBucket] = useState<Bucket>("daily");
  const [appsLoading, setAppsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    return onSnapshot(doc(db, "users", user.uid), (snap) => {
      const data = (snap.data() as any) || {};
      setUserDoc(data);

      setPaidPlan(!!data?.paidPlan);
      setAutofillsTotal(Number(data?.stats?.autofills?.total || 0));

      const fromStats = data?.stats?.customAnswersGenerated?.total;
      if (typeof fromStats === "number" && Number.isFinite(fromStats)) {
        setCustomAnswersTotal(fromStats);
      }

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

  // Custom Answers count (fallback to collection count when stats are missing)
  useEffect(() => {
    if (!user) return;

    const fromStats = userDoc?.stats?.customAnswersGenerated?.total;
    if (typeof fromStats === "number" && Number.isFinite(fromStats)) {
      setCustomAnswersTotal(fromStats);
      return;
    }

    let cancelled = false;
    const { db } = getFirebase();

    (async () => {
      try {
        const ref = collection(db, "users", user.uid, "customAnswers");
        const snap = await getCountFromServer(ref);
        if (!cancelled) setCustomAnswersTotal(Number(snap.data().count || 0));
      } catch {
        if (!cancelled) setCustomAnswersTotal(0);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, userDoc?.stats?.customAnswersGenerated?.total]);

  // Autofills → applications graph (live)
  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const since = subDays(new Date(), 365);
    const q = query(
      collection(db, "users", user.uid, "autofills"),
      where("timestamp", ">=", Timestamp.fromDate(since)),
      orderBy("timestamp", "asc"),
    );

    setAppsLoading(true);
    return onSnapshot(
      q,
      (snap) => {
        const dates: Date[] = [];
        for (const d of snap.docs) {
          const data = d.data();
          const ts =
            data?.timestamp ??
            data?.createdAt ??
            data?.created_at ??
            data?.time ??
            null;
          const asDate = toDateMaybe(ts);
          if (asDate) dates.push(asDate);
        }
        setAutofillDates(dates);
        setAppsLoading(false);
      },
      () => {
        setAutofillDates([]);
        setAppsLoading(false);
      },
    );
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

  const timeSavedHours = (autofillsTotal * 14) / 60;

  const appsSeries = useMemo(
    () => buildAppsSeries(autofillDates, appsBucket),
    [autofillDates, appsBucket],
  );

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

        <div className="mt-6 flex flex-wrap gap-4">
          <div className="min-w-[180px] flex-1">
            <StatCard
              label="Time saved"
              value={`~${timeSavedHours.toFixed(1)} hrs`}
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <StatCard label="Autofills" value={String(autofillsTotal)} />
          </div>
          <div className="min-w-[180px] flex-1">
            <StatCard
              label="Custom Answers"
              value={customAnswersTotal === null ? "—" : String(customAnswersTotal)}
            />
          </div>
        </div>

        <div className="mt-4">
          <ApplicationsChart
            data={appsSeries}
            bucket={appsBucket}
            onBucketChange={setAppsBucket}
            loading={appsLoading}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <ComingSoonCard title="Referrals" />
          <ComingSoonCard title="Emails" />
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NavCard href="/profile" title="Profile" desc="Edit your autofill profile." />
          <NavCard
            href="/resume-tailoring"
            title="Resume Tailoring"
            desc="Coming soon."
          />
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
