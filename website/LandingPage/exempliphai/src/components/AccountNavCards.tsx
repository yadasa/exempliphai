"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  desc: string;
};

const ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    desc: "Back to your overview.",
  },
  {
    href: "/profile",
    label: "Profile",
    desc: "Edit your autofill profile.",
  },
  {
    href: "/resume-tailoring",
    label: "Resume Tailoring",
    desc: "Coming soon to web.",
  },
  {
    href: "/job-search",
    label: "Job Search",
    desc: "Coming soon to web.",
  },
  {
    href: "/emails",
    label: "Emails",
    desc: "Coming soon.",
  },
  {
    href: "/subscription",
    label: "Manage Subscription",
    desc: "Upgrade and manage your plan.",
  },
];

function normalizePath(p: string): string {
  const s = String(p || "/");
  const trimmed = s.length > 1 ? s.replace(/\/+$/g, "") : s;
  return trimmed || "/";
}

export function AccountNavCards({
  className,
  items,
  autoScrollOnHover = true,
}: {
  className?: string;
  items?: NavItem[];
  autoScrollOnHover?: boolean;
}) {
  const pathname = usePathname();
  const cur = normalizePath(pathname || "/");

  const list = useMemo(
    () => (items || ITEMS).filter((it) => normalizePath(it.href) !== cur),
    [items, cur],
  );

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [hoverDir, setHoverDir] = useState<-1 | 0 | 1>(0);

  useEffect(() => {
    if (!autoScrollOnHover) return;
    if (!hoverDir) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    const step = () => {
      const el = scrollerRef.current;
      if (el) {
        el.scrollLeft += hoverDir * 10; // px/frame
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [hoverDir, autoScrollOnHover]);

  if (!list.length) return null;

  return (
    <nav aria-label="Account navigation" className={className}>
      <div className="relative">
        {/* hover zones for desktop */}
        {autoScrollOnHover ? (
          <>
            <div
              className="pointer-events-auto absolute inset-y-0 left-0 z-10 hidden w-10 md:block"
              onMouseEnter={() => setHoverDir(-1)}
              onMouseLeave={() => setHoverDir(0)}
            />
            <div
              className="pointer-events-auto absolute inset-y-0 right-0 z-10 hidden w-10 md:block"
              onMouseEnter={() => setHoverDir(1)}
              onMouseLeave={() => setHoverDir(0)}
            />
          </>
        ) : null}

        <div
          ref={scrollerRef}
          className={cn(
            "flex gap-3 overflow-x-auto overflow-y-visible pt-2 pb-1 scrollbar-none",
            // don’t clip cards
            "[scrollbar-gutter:stable]",
          )}
        >
          {list.map((it) => (
            <Link
              key={it.href}
              href={it.href as any}
              className={cn(
                "group flex min-w-[220px] items-start justify-between gap-4 rounded-xl border bg-card/80 px-4 py-3 shadow-sm backdrop-blur transition",
                "hover:-translate-y-0.5 hover:bg-muted/30 hover:shadow-md",
              )}
            >
              <div>
                <div className="text-sm font-semibold tracking-tight">{it.label}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{it.desc}</div>
              </div>
              <div className="pt-0.5 text-muted-foreground transition group-hover:text-foreground">
                →
              </div>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
