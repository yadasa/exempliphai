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
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  addHours,
  format,
  startOfDay,
  startOfHour,
  startOfWeek,
  subDays,
  subWeeks,
} from "date-fns";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import { uiText } from "@/lib/utils";
import { NavCard } from "@/components/nav-card";
import { OnboardingModal } from "@/components/onboarding/onboarding-modal";
import schema from "@/config/local_profile_schema.json";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="text-xs text-muted-foreground">{uiText(label)}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

// Note: Referrals/Emails now use NavCard in the main grid.

type AppsPoint = { day: string; total: number };

type AppsRange = "today" | "yesterday" | "3d" | "7d" | "30d" | "90d" | "365d";

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

function buildAppsSeries(dates: Date[], range: AppsRange): AppsPoint[] {
  const now = new Date();

  // Ultra-short views: hourly buckets.
  if (range === "today" || range === "yesterday") {
    const start = range === "today" ? startOfDay(now) : startOfDay(subDays(now, 1));
    const end = addHours(start, 24);

    const counts = new Map<string, number>();
    for (const d of dates) {
      const hr = startOfHour(d);
      if (hr < start || hr >= end) continue;
      const key = format(hr, "yyyy-MM-dd-HH");
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const out: AppsPoint[] = [];
    for (let i = 0; i < 24; i++) {
      const hr = addHours(start, i);
      const key = format(hr, "yyyy-MM-dd-HH");
      out.push({ day: format(hr, "ha"), total: counts.get(key) || 0 });
    }

    return out;
  }

  // For long ranges, switch to weekly buckets for readability.
  if (range === "365d") {
    const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
    const start = subWeeks(thisWeek, 51);

    const counts = new Map<string, number>();
    for (const d of dates) {
      const wk = startOfWeek(d, { weekStartsOn: 1 });
      if (wk < start || wk > thisWeek) continue;
      const key = format(wk, "yyyy-MM-dd");
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    const out: AppsPoint[] = [];
    for (let i = 0; i < 52; i++) {
      const wk = subWeeks(thisWeek, 51 - i);
      const key = format(wk, "yyyy-MM-dd");
      out.push({ day: format(wk, "MMM d"), total: counts.get(key) || 0 });
    }

    return out;
  }

  const rangeDays =
    range === "3d"
      ? 3
      : range === "7d"
        ? 7
        : range === "30d"
          ? 30
          : range === "90d"
            ? 90
            : 7;

  const end = startOfDay(now);
  const start = subDays(end, rangeDays - 1);

  const counts = new Map<string, number>();
  for (const d of dates) {
    const day = startOfDay(d);
    if (day < start || day > end) continue;
    const key = format(day, "yyyy-MM-dd");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const out: AppsPoint[] = [];
  for (let i = 0; i < rangeDays; i++) {
    const day = subDays(end, rangeDays - 1 - i);
    const key = format(day, "yyyy-MM-dd");
    out.push({ day: format(day, "MMM d"), total: counts.get(key) || 0 });
  }

  return out;
}

function getAppsRangeBounds(range: AppsRange) {
  const now = new Date();
  const startToday = startOfDay(now);

  if (range === "today") {
    return { since: startToday, until: null as Date | null };
  }

  if (range === "yesterday") {
    return { since: subDays(startToday, 1), until: startToday };
  }

  const rangeDays =
    range === "3d"
      ? 3
      : range === "7d"
        ? 7
        : range === "30d"
          ? 30
          : range === "90d"
            ? 90
            : 365;

  if (rangeDays === 365) {
    const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
    return { since: subWeeks(thisWeek, 51), until: null as Date | null };
  }

  return { since: subDays(startToday, rangeDays - 1), until: null as Date | null };
}

function ApplicationsChart({
  data,
  range,
  onRangeChange,
  loading,
}: {
  data: AppsPoint[];
  range: AppsRange;
  onRangeChange: (d: AppsRange) => void;
  loading: boolean;
}) {
  const rangeTotal = useMemo(
    () => data.reduce((sum, p) => sum + Number(p.total || 0), 0),
    [data],
  );

  const rangeDescription = useMemo(() => {
    if (range === "today") return "Today";
    if (range === "yesterday") return "Yesterday";
    if (range === "3d") return "Last 3 days";
    if (range === "7d") return "Last 7 days";
    if (range === "30d") return "Last 30 days";
    if (range === "90d") return "Last 90 days";
    return "Last 52 weeks";
  }, [range]);

  const xInterval = useMemo(() => {
    if (range === "today" || range === "yesterday") return 2;
    if (range === "3d") return 0;
    if (range === "7d") return 0;
    if (range === "30d") return 4;
    if (range === "90d") return 12;
    return 3; // weekly (365d)
  }, [range]);

  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{uiText("Total Applications")}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {loading ? uiText("Loading…") : uiText(`${rangeDescription} · ${rangeTotal} total`)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="apps-range">
            {uiText("Date range")}
          </label>
          <select
            id="apps-range"
            value={range}
            onChange={(e) => onRangeChange(e.target.value as AppsRange)}
            className="h-9 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted"
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="3d">3d</option>
            <option value="7d">7d</option>
            <option value="30d">30d</option>
            <option value="90d">90d</option>
            <option value="365d">365d</option>
          </select>
        </div>
      </div>

      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            margin={{ top: 8, right: 12, bottom: 0, left: -10 }}
          >
            {/*
              Note: some browsers (notably Safari) still have spotty support for modern
              CSS colors (e.g. oklch()) inside SVG paint servers (gradients).
              Our theme tokens are oklch(), so we use sRGB stops here to ensure
              the line/area are always visible.
            */}
            <defs>
              <linearGradient id="appsLineGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#7c3aed" />
                <stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
              <linearGradient id="appsAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.9} />
                <stop offset="60%" stopColor="#2563eb" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0.18} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              interval={xInterval}
              minTickGap={14}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              // Add a little vertical breathing room so a flat (all-zero) series
              // still renders visibly instead of hugging the chart edge.
              padding={{ top: 12, bottom: 12 }}
              domain={[0, "dataMax + 1"]}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                borderColor: "rgba(255,255,255,0.12)",
                background: "rgba(15,15,15,0.9)",
              }}
              labelStyle={{ color: "rgba(255,255,255,0.8)" }}
              itemStyle={{ color: "white" }}
            />

            <Area
              type="monotone"
              dataKey="total"
              stroke="none"
              fill="url(#appsAreaGradient)"
              fillOpacity={1}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="total"
              stroke="url(#appsLineGradient)"
              strokeWidth={2.75}
              connectNulls
              dot={false}
              activeDot={{
                r: 4.25,
                fill: "#fff",
                stroke: "#2563eb",
                strokeWidth: 2.5,
              }}
              isAnimationActive={false}
            />
          </ComposedChart>
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
  const [appsRange, setAppsRange] = useState<AppsRange>("3d");
  const [appsRangeAutoPicked, setAppsRangeAutoPicked] = useState(false);
  const [appsRangeUserSelected, setAppsRangeUserSelected] = useState(false);
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

  // Auto-pick the shortest non-zero range (default).
  useEffect(() => {
    if (!user) return;
    if (appsRangeAutoPicked || appsRangeUserSelected) return;

    let cancelled = false;
    const { db } = getFirebase();

    (async () => {
      try {
        const candidates: AppsRange[] = [
          "today",
          "yesterday",
          "3d",
          "7d",
          "30d",
          "90d",
          "365d",
        ];

        for (const candidate of candidates) {
          const { since, until } = getAppsRangeBounds(candidate);

          const constraints = [where("timestamp", ">=", Timestamp.fromDate(since))];
          if (until) {
            constraints.push(where("timestamp", "<", Timestamp.fromDate(until)));
          }

          const q = query(
            collection(db, "users", user.uid, "autofills"),
            ...constraints,
          );

          const snap = await getCountFromServer(q);
          const count = Number(snap.data().count || 0);
          if (count > 0) {
            if (!cancelled && !appsRangeUserSelected) setAppsRange(candidate);
            break;
          }
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setAppsRangeAutoPicked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.uid, appsRangeAutoPicked, appsRangeUserSelected]);

  // Autofills → applications graph (live)
  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const { since, until } = getAppsRangeBounds(appsRange);

    const constraints = [
      where("timestamp", ">=", Timestamp.fromDate(since)),
      ...(until ? [where("timestamp", "<", Timestamp.fromDate(until))] : []),
      orderBy("timestamp", "asc"),
    ];

    const q = query(
      collection(db, "users", user.uid, "autofills"),
      ...constraints,
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
  }, [user?.uid, appsRange]);

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
    () => buildAppsSeries(autofillDates, appsRange),
    [autofillDates, appsRange],
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
          <h1 className="text-2xl font-semibold tracking-tight">
            <Link className="text-primary underline" href={"/account" as any}>
              {uiText("Account")}
            </Link>
          </h1>
          <p className="text-sm text-muted-foreground">
            {uiText("Quick links to your profile and tools.")}
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
            range={appsRange}
            onRangeChange={(next) => {
              setAppsRange(next);
              setAppsRangeUserSelected(true);
            }}
            loading={appsLoading}
          />
        </div>

        {/* Referrals + Emails moved into main nav grid */}

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <NavCard href="/profile" title="Profile" desc="Edit your autofill profile." />
          <NavCard
            href="/resume-tailoring"
            title="Resume Tailoring"
            desc="Coming soon."
          />
          <NavCard href="/job-search" title="Job Search" desc="Coming soon." />
          <NavCard
            href="/referrals"
            title="Referrals"
            desc="Share your referral link and earn points."
          />
          <NavCard href="/emails" title="Emails" desc="Coming soon." />
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
                <div className="text-sm font-semibold">{uiText("Upgrade to Pro")}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {uiText("Early access pricing and priority support.")}
                </div>
              </div>
              <Link
                href={"/subscription" as any}
                className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {uiText("View plans")}
              </Link>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
