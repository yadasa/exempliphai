"use client";

import { ChevronDown } from "lucide-react";
import { landingContent } from "@/config/landing-content";

export function FAQ() {
  return (
    <section id="faq" className="py-20 md:py-24">
      <div className="container">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <div className="text-sm font-medium text-foreground/70">
              {landingContent.faq.title}
            </div>
            <h2 className="mt-3 font-medium text-5xl tracking-tighter md:text-6xl">
              FAQ
            </h2>
            <p className="mt-5 text-lg text-muted-foreground tracking-tight md:text-xl">
              {landingContent.faq.subtitle}
            </p>
          </div>

          <div className="mt-10 grid gap-3">
            {landingContent.faq.items.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl border border-muted bg-card p-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <span className="font-medium text-base md:text-lg">
                    {item.q}
                  </span>
                  <ChevronDown className="size-5 text-muted-foreground transition group-open:rotate-180" />
                </summary>
                <div className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  {item.a}
                </div>
              </details>
            ))}
          </div>

          <div className="mt-10 rounded-xl border border-muted bg-muted/20 p-5 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Privacy note:</span> ExempliPhai is built to minimize data exposure. We anonymize wherever possible and do not sell personal data.
          </div>
        </div>
      </div>
    </section>
  );
}
