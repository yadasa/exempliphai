export default function UpgradePage() {
  return (
    <div className="container py-14 md:py-16">
      <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-6 shadow-sm md:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] opacity-70"
          style={{
            background:
              "radial-gradient(900px 520px at 30% 15%, color-mix(in oklab, var(--color-primary) 26%, transparent), transparent 60%), radial-gradient(900px 520px at 80% 25%, color-mix(in oklab, var(--brand-violet) 24%, transparent), transparent 58%)",
          }}
        />

        <h1 className="text-2xl font-semibold tracking-tight">Upgrade</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Paid plans are coming soon. This is a placeholder.
        </p>

        <div className="mt-6 rounded-xl border bg-muted/20 p-4">
          <div className="text-sm font-semibold">What will be included</div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Higher usage limits</li>
            <li>Priority support</li>
            <li>Advanced job search + tailoring workflows</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
