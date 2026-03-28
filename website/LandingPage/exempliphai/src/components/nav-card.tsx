import Link from "next/link";
import { cn } from "@/lib/utils";

export function NavCard({
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
        <div className="text-muted-foreground transition group-hover:text-foreground">→</div>
      </div>
    </Link>
  );
}
