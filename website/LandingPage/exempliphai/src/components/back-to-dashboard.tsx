"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function BackToDashboard({ className }: { className?: string }) {
  const pathname = usePathname() || "";

  const hide = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
  if (hide) return null;

  return (
    <div className={cn("fixed left-4 top-20 z-[60]", className)}>
      <Link
        href={"/dashboard" as any}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1.5 text-sm font-semibold text-foreground/80 backdrop-blur",
          "shadow-sm transition hover:bg-background/90 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
        aria-label="Back to Dashboard"
      >
        <span aria-hidden="true">←</span>
        <span>Dashboard</span>
      </Link>
    </div>
  );
}
