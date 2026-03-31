"use client";

import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import BackgroundStars from "@/assets/stars.png";
import Link from "next/link";
import { doc, onSnapshot } from "firebase/firestore";
import { ActionButton } from "@/components/action-button";
import { landingContent } from "@/config/landing-content";
import { getFirebase } from "@/lib/firebase/client";

export function HeroSection() {
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

  return (
    <motion.section
      id="hero"
      animate={{ backgroundPositionX: 1200 }}
      transition={{
        duration: 120,
        repeat: Number.POSITIVE_INFINITY,
        ease: "linear",
      }}
      className="relative flex min-h-[560px] items-center overflow-hidden py-20 md:min-h-[820px] md:py-28"
      style={{
        backgroundImage: `url(${BackgroundStars})`,
        backgroundPositionY,
      }}
      ref={sectionRef}
    >
      {/* Blue/purple glow blurs (agency-style) */}
      <div className="pointer-events-none absolute -top-40 -left-40 size-[520px] rounded-full bg-gradient-to-br from-blue-500/35 to-purple-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-56 -right-56 size-[680px] rounded-full bg-gradient-to-tr from-purple-500/30 to-blue-500/20 blur-3xl" />

      {/* Soft overlay that adapts to theme */}
      <div className="absolute inset-0 bg-[radial-gradient(70%_70%_at_center_center,rgba(59,130,246,0.28)_0%,rgba(124,58,237,0.18)_42%,transparent_72%)] dark:bg-[radial-gradient(70%_70%_at_center_center,rgba(124,58,237,0.32)_0%,rgba(15,23,42,0.55)_58%,transparent_78%)]" />

      {/* Decorative "planet" */}
      <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 size-56 rounded-full border border-foreground/15 bg-[radial-gradient(50%_50%_at_22%_20%,white,rgba(147,197,253,0.85)_35%,rgba(124,58,237,0.55)_70%)] shadow-[0_0_60px_rgba(59,130,246,0.25)] md:size-96 dark:bg-[radial-gradient(50%_50%_at_22%_20%,white,rgba(167,139,250,0.7)_35%,rgba(15,23,42,0.9)_72%)] dark:shadow-[0_0_70px_rgba(124,58,237,0.35)]" />

      {/* Rings */}
      <motion.div
        animate={{ rotate: "1turn" }}
        transition={{ duration: 60, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 size-[320px] rounded-full border border-foreground/20 opacity-25 md:size-[580px]"
      >
        <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-0 size-2 rounded-full bg-foreground/70" />
        <div className="-translate-x-1/2 -translate-y-1/2 absolute top-0 left-1/2 size-2 rounded-full bg-foreground/70" />
        <div className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-full inline-flex size-5 items-center justify-center rounded-full border border-foreground/40">
          <div className="size-2 rounded-full bg-foreground/70" />
        </div>
      </motion.div>
      <motion.div
        animate={{ rotate: "-1turn" }}
        transition={{ duration: 60, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 size-[420px] rounded-full border border-foreground/15 border-dashed md:size-[780px]"
      />

      {/* Content */}
      <div className="container relative">
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-full border bg-background/60 px-4 py-2 text-xs text-foreground/80 backdrop-blur">
            <span className="inline-flex size-1.5 rounded-full bg-primary" />
            {landingContent.hero.eyebrow}
          </div>
        </div>

        <h1 className="mt-6 px-2 text-center font-semibold text-4xl leading-tight tracking-tighter sm:text-5xl md:text-[88px] md:leading-[0.95]">
          {landingContent.hero.headline.line1}
          <span className="block bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-purple-400">
            {landingContent.hero.headline.emphasis}
          </span>
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground tracking-tight md:text-xl">
          {heroStatText}
        </p>

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
