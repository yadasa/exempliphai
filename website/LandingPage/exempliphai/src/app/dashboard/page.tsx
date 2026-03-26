"use client";

import Link from "next/link";
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
import { cn } from "@/lib/utils";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-sm">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function Card({
  href,
  title,
  desc,
  gradient,
}: {
  href: string;
  title: string;
  desc: string;
  gradient?: boolean;
}) {
  return (
    <Link
      href={href as any}
      className={cn(
        "group relative rounded-2xl border bg-card p-5 shadow-sm transition",
        "hover:-translate-y-0.5 hover:bg-muted/30 hover:shadow-md",
        gradient &&
          "border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-violet-500/10 to-transparent",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-semibold tracking-tight">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">{desc}</div>
        </div>
        <div className="text-muted-foreground transition group-hover:text-foreground">
          →
        </div>
      </div>
    </Link>
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
  const totalApps = 42;
  const timeSavedHours = (totalApps * 14) / 60;

  const appsSeries: Array<{ day: string; total: number }> = [
    { day: "Mon", total: 4 },
    { day: "Tue", total: 9 },
    { day: "Wed", total: 15 },
    { day: "Thu", total: 18 },
    { day: "Fri", total: 24 },
    { day: "Sat", total: 33 },
    { day: "Sun", total: 42 },
  ];

  return (
    <RequireAuth>
      <div className="container py-14 md:py-16">
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
              Quick links to your account, profile, and tools.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total apps" value={String(totalApps)} />
            <StatCard
              label="Time saved"
              value={`~${timeSavedHours.toFixed(1)} hrs`}
            />
            <StatCard label="Autofills" value="—" />
            <StatCard label="Tailored resumes" value="—" />
          </div>

          <div className="mt-4">
            <ApplicationsChart data={appsSeries} />
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card href="/account" title="Account" desc="Manage login + view referrals." />
            <Card href="/profile" title="Profile" desc="Edit your autofill profile." />
            <Card
              href="/account?tab=referrals"
              title="Referrals"
              desc="Invite friends and track rewards."
            />
            <Card
              href="/resume-tailoring"
              title="Resume Tailoring"
              desc="Coming soon."
            />
            <Card href="/job-search" title="Job Search" desc="Coming soon." />
            <Card
              href="/upgrade"
              title="Upgrade"
              desc="Unlock paid features and higher limits."
              gradient
            />
          </div>

          <div className="mt-8 rounded-2xl border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Upgrade to Pro</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Early access pricing and priority support.
                </div>
              </div>
              <Link
                href={"/upgrade" as any}
                className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                View plans
              </Link>
            </div>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
