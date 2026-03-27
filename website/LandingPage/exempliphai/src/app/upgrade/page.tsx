export default function UpgradePage() {
  return (
    <div className="container py-14 md:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
        style={{
          background:
            "radial-gradient(900px 520px at 30% 15%, color-mix(in oklab, var(--color-primary) 26%, transparent), transparent 60%), radial-gradient(900px 520px at 80% 25%, color-mix(in oklab, var(--brand-violet) 24%, transparent), transparent 58%)",
        }}
      />

      <div className="mx-auto max-w-5xl">
        <h1 className="text-2xl font-semibold tracking-tight">Upgrade</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Compare plans. (Checkout flow coming soon.)
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <PlanCard
            title="Free"
            price="$0"
            items={[
              "Autofill",
              "Track",
              "1 job search/week",
              "1 resume tailor/week",
              "Email forwarding",
            ]}
          />

          <PlanCard
            title="Plus"
            price="$"
            highlight
            items={[
              "All Free +",
              "3 job searches/week",
              "Auto apply/tailor/submit",
              "Email filtering (custom exempliphai@ email: forwards non-rejections; responses from it)",
              "5× more likely solid interview",
            ]}
          />
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
          Want access sooner? Reach out and we’ll get you into early access.
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  title,
  price,
  items,
  highlight,
}: {
  title: string;
  price: string;
  items: string[];
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border bg-card p-6 shadow-sm " +
        (highlight
          ? "border-blue-500/30 bg-gradient-to-br from-blue-500/10 via-violet-500/10 to-transparent"
          : "")
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold tracking-tight">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">{price}</div>
        </div>
        {highlight ? (
          <div className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-semibold">
            Recommended
          </div>
        ) : null}
      </div>

      <ul className="mt-5 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
        {items.map((it) => (
          <li key={it}>{it}</li>
        ))}
      </ul>

      <button
        type="button"
        disabled
        className={
          "mt-6 h-11 w-full rounded-md px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 " +
          (highlight
            ? "bg-gradient-primary text-primary-foreground shadow-sm"
            : "border bg-card hover:bg-muted")
        }
      >
        Coming soon
      </button>
    </div>
  );
}
