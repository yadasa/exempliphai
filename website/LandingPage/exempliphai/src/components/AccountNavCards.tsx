"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    desc: "Tailor your resume for a job.",
  },
  {
    href: "/job-search",
    label: "Job Search",
    desc: "AI-curated job matches.",
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
  const trimmed = s.length > 1 ? s.replace(/\/+$/, "") : s;
  return trimmed || "/";
}

export function AccountNavCards({
  className,
  items,
}: {
  className?: string;
  items?: NavItem[];
}) {
  const pathname = usePathname();
  const cur = normalizePath(pathname || "/");

  const list = (items || ITEMS).filter((it) => normalizePath(it.href) !== cur);
  if (!list.length) return null;

  return (
    <nav aria-label="Account navigation" className={className}>
      <div className="flex gap-3 overflow-x-auto pb-1">
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
    </nav>
  );
}
