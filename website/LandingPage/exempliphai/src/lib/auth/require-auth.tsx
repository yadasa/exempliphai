"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading, degraded, reason } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!loading && !user && !degraded) {
      const next = `${pathname || "/"}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, user, degraded, router, pathname, searchParams]);

  if (loading) {
    return (
      <div className="container py-20">
        <div className="mx-auto max-w-lg rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      </div>
    );
  }

  if (degraded && !user) {
    return (
      <div className="container py-20">
        <div className="mx-auto max-w-lg space-y-3 rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur">
          <div className="text-base font-semibold">Session could not be restored</div>
          <div className="text-sm text-muted-foreground">
            Auth bootstrap degraded ({reason || "unknown"}). You can try signing in again
            or open the repair page.
          </div>
          <div className="flex gap-3">
            <a className="underline" href="/login/">
              Go to login
            </a>
            <a className="underline" href="/auth-repair.html">
              Open repair page
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container py-20">
        <div className="mx-auto max-w-lg rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur">
          <div className="text-sm text-muted-foreground">Redirecting to login…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
