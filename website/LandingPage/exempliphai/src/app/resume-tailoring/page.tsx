"use client";

import Link from "next/link";
import { RequireAuth } from "@/lib/auth/require-auth";
import { AccountNavCards } from "@/components/AccountNavCards";

export default function ResumeTailoringPage() {
  return (
    <RequireAuth>
      <ResumeTailoringInner />
    </RequireAuth>
  );
}

function ResumeTailoringInner() {
  return (
    <div className="container py-14 md:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
        style={{
          background:
            "radial-gradient(900px 520px at 20% 10%, color-mix(in oklab, var(--color-primary) 24%, transparent), transparent 62%), radial-gradient(900px 520px at 80% 15%, color-mix(in oklab, var(--brand-violet) 22%, transparent), transparent 58%)",
        }}
      />

      <div className="mx-auto max-w-5xl">
        <AccountNavCards className="mb-6" />

        <div className="rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Resume Tailoring</h1>
            <div className="flex gap-3">
              <Link className="text-sm text-primary underline" href={"/profile" as any}>
                Profile
              </Link>
              <Link className="text-sm text-primary underline" href={"/dashboard" as any}>
                Dashboard
              </Link>
            </div>
          </div>

          <div className="mt-6 rounded-xl border bg-card p-4">
            <div className="text-sm font-semibold">Coming soon to web</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Resume Tailoring is already implemented in the Chrome extension.
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              We’ll bring it to the web dashboard soon.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
