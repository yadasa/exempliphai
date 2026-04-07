"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;

    const onChange = () => setReduced(Boolean(mq.matches));
    onChange();

    // Safari < 14
    // eslint-disable-next-line deprecation/deprecation
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => {
      // eslint-disable-next-line deprecation/deprecation
      mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange);
    };
  }, []);

  return reduced;
}

import BackgroundStars from "@/assets/stars.png";
import Link from "next/link";
import { doc, onSnapshot } from "firebase/firestore";
import { ActionButton } from "@/components/action-button";
import { landingContent } from "@/config/landing-content";
import { getFirebase } from "@/lib/firebase/client";
import { uiText } from "@/lib/utils";

export function HeroSection() {
  const reducedMotion = usePrefersReducedMotion();

  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });

  const backgroundPositionY = useTransform(scrollYProgress, [0, 1], [-300, 300]);

  const [aggregate, setAggregate] = useState<{ autofillsTotal: number; customAnswersTotal: number } | null>(null);

  useEffect(() => {
    const { db, configured } = getFirebase();
    if (!configured || !db) return;

    const ref = doc(db, "publicStats", "aggregate");
    return onSnapshot(ref, (snap) => {
      const d = (snap.data() as any) || {};
      const a = Number(d.autofillsTotal || 0);
      const c = Number(d.customAnswersTotal || 0);
      setAggregate({
        autofillsTotal: Number.isFinite(a) ? a : 0,
        customAnswersTotal: Number.isFinite(c) ? c : 0,
      });
    });
  }, []);

  const heroStatText = useMemo(() => {
    const A = Number(aggregate?.autofillsTotal || 0);
    const C = Number(aggregate?.customAnswersTotal || 0);
    const hours = ((6.7 * A) + (2 * C)) / 60;
    const hoursText = Number.isFinite(hours) ? hours.toFixed(1) : "0.0";
    return `${A.toLocaleString()} applications autofilled. ${hoursText} hours saved`;
  }, [aggregate]);

  const heroPillText = useMemo(() => {
    // Avoid showing 0/0 while the public aggregate doc hasn't been created/backfilled yet.
    if (!aggregate) return uiText(landingContent.hero.eyebrow);
    return heroStatText;
  }, [aggregate, heroStatText]);

  return (
    <motion.section
      id="hero"
      animate={
        reducedMotion
          ? undefined
          : {
              backgroundPositionX: 1200,
            }
      }
      transition={
        reducedMotion
          ? undefined
          : {
              duration: 120,
              repeat: Number.POSITIVE_INFINITY,
              ease: "linear",
            }
      }
      className="relative flex min-h-[560px] items-center overflow-hidden py-20 md:min-h-[820px] md:py-28"
      style={{
        backgroundImage: `url(${BackgroundStars})`,
        backgroundPositionY,
      }}
      ref={sectionRef}
    >
      {/* Subtle moving gradient blobs (replaces planet/rings) */}
      <div
        className="pointer-events-none hero-blob hero-blob-1 absolute -top-56 -left-56 size-[720px] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(59,130,246,0.35)_0%,rgba(124,58,237,0.18)_45%,transparent_70%)] blur-3xl"
      />
      <div
        className="pointer-events-none hero-blob hero-blob-2 absolute left-1/2 top-1/2 size-[820px] rounded-full bg-[radial-gradient(circle_at_55%_45%,rgba(168,85,247,0.22)_0%,rgba(59,130,246,0.14)_42%,transparent_72%)] blur-3xl"
        style={{ marginLeft: -410, marginTop: -410 }}
      />
      <div
        className="pointer-events-none hero-blob hero-blob-3 absolute -bottom-72 -right-64 size-[760px] rounded-full bg-[radial-gradient(circle_at_50%_50%,rgba(59,130,246,0.20)_0%,rgba(236,72,153,0.10)_40%,transparent_70%)] blur-3xl"
      />

      {/* Soft overlay that adapts to theme */}
      <div className="absolute inset-0 bg-[radial-gradient(70%_70%_at_center_center,rgba(59,130,246,0.22)_0%,rgba(124,58,237,0.12)_42%,transparent_72%)] dark:bg-[radial-gradient(70%_70%_at_center_center,rgba(124,58,237,0.22)_0%,rgba(15,23,42,0.60)_58%,transparent_78%)]" />

      {/* Fade into the neighboring section background (transparent in the middle). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-background to-transparent md:h-44" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-background to-transparent md:h-44" />

      {/* Content */}
      <div className="container relative">
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-2 text-xs text-foreground/80 backdrop-blur">
            <span className="inline-flex size-1.5 rounded-full bg-primary" />
            {heroPillText}
          </div>
        </div>

        <h1 className="mt-6 px-2 pb-4 text-center font-semibold text-4xl leading-tight tracking-tighter sm:text-5xl md:text-[88px] md:leading-[1.02]">
          {landingContent.hero.headline.line1}
          <span className="block bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-purple-400">
            {landingContent.hero.headline.emphasis}
          </span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground tracking-tight md:text-xl">
          {landingContent.hero.subheadline}
        </p>

        <div className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-foreground/80">
          {landingContent.hero.stats.map((s) => (
            <div key={s.label} className="inline-flex items-center gap-2">
              <span className="font-semibold text-foreground">{s.value}</span>
              <span className="text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href={landingContent.hero.ctas.primary.href}>
            <ActionButton label={landingContent.hero.ctas.primary.label} />
          </Link>
          <Link
            href={landingContent.hero.ctas.secondary.href}
            className="text-sm text-foreground/80 underline-offset-4 hover:underline"
          >
            {landingContent.hero.ctas.secondary.label}
          </Link>
        </div>

        <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-muted-foreground">
          {landingContent.hero.privacyNote}
        </p>
      </div>
    </motion.section>
  );
}
