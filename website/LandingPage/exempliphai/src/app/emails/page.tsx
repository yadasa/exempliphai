"use client";

import Link from "next/link";
import { AccountNavCards } from "@/components/AccountNavCards";
import { RequireAuth } from "@/lib/auth/require-auth";
import { uiText } from "@/lib/utils";

export default function EmailsPage() {
  return (
    <RequireAuth>
      <div className="container py-14 md:py-16">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
          style={{
            background:
              "radial-gradient(900px 520px at 20% 10%, color-mix(in oklab, var(--color-primary) 24%, transparent), transparent 62%), radial-gradient(900px 520px at 80% 15%, color-mix(in oklab, var(--brand-violet) 22%, transparent), transparent 58%)",
          }}
        />

        <div className="mx-auto max-w-3xl">
          <AccountNavCards className="mb-6" />

          <div className="rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{uiText("Emails")}</h1>
              <Link className="text-sm text-primary underline" href={"/dashboard" as any}>
                {uiText("Dashboard")}
              </Link>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">{uiText("Coming soon.")}</p>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}
