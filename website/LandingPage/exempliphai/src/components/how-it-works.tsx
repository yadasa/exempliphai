"use client";

import { landingContent } from "@/config/landing-content";

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 md:py-24">
      <div className="container">
        <h2 className="text-center font-medium text-5xl tracking-tighter md:text-6xl">
          {landingContent.howItWorks.title}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground tracking-tight md:text-xl">
          {landingContent.howItWorks.subtitle}
        </p>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {landingContent.howItWorks.steps.map((s) => (
            <div
              key={s.title}
              className="relative overflow-hidden rounded-xl border bg-card p-6"
            >
              <div className="pointer-events-none absolute -top-24 -right-24 size-56 rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 blur-3xl" />
              <div className="relative">
                <div className="inline-flex size-11 items-center justify-center rounded-lg border bg-background">
                  <s.icon className="size-5 text-primary" />
                </div>
                <h3 className="mt-4 font-semibold text-xl tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {s.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
