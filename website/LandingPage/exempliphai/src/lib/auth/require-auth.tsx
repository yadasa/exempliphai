"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="container py-20">
        <div className="mx-auto max-w-lg rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur">
          <div className="text-sm text-muted-foreground">Loading…</div>
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
