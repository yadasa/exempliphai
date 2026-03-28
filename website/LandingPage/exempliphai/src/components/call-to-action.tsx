"use client";

import {
  motion,
  useMotionTemplate,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef } from "react";
import BackgroundGrid from "@/assets/grid-lines.png";
import BackgroundStars from "@/assets/stars.png";
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { useRelativeMousePosition } from "@/hooks/use-relative-mouse-position";

export function CallToAction() {
  const sectionRef = useRef<HTMLElement>(null);
  const borderedDivRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start end", "end start"],
  });
  const backgroundPositionY = useTransform(
    scrollYProgress,
    [0, 1],
    [-300, 300],
  );

  const [mouseX, mouseY] = useRelativeMousePosition(borderedDivRef);
  const maskImage = useMotionTemplate`radial-gradient(50% 50% at ${mouseX}px ${mouseY}px, black, transparent)`;

  return (
    <section id="waitlist" className="py-20 md:py-24" ref={sectionRef}>
      <div className="container">
        <motion.div
          animate={{ backgroundPositionX: 1200 }}
          transition={{
            duration: 120,
            repeat: Number.POSITIVE_INFINITY,
            ease: "linear",
          }}
          className="group relative overflow-hidden rounded-xl border border-muted px-6 py-24"
          style={{
            backgroundImage: `url(${BackgroundStars})`,
            backgroundPositionY,
          }}
        >
          <div
            className="mask-[radial-gradient(50%_50%_at_50%_35%,black,transparent)] absolute inset-0 bg-[rgb(37,99,235)] bg-blend-overlay transition duration-700 group-hover:opacity-0"
            style={{ backgroundImage: `url(${BackgroundGrid})` }}
          />
          <motion.div
            className="absolute inset-0 bg-[rgb(124,58,237)] opacity-0 bg-blend-overlay transition duration-700 group-hover:opacity-100"
            style={{
              backgroundImage: `url(${BackgroundGrid})`,
              maskImage: maskImage,
            }}
            ref={borderedDivRef}
          />
          <div className="relative">
            <h2 className="text-center font-medium text-5xl tracking-tighter">
              Install. Apply. Get replies.
            </h2>
            <p className="mt-5 px-4 text-center text-lg text-muted-foreground tracking-tight md:text-xl">
              Turn job search into a daily 20 minute sprint. exempliphai finds matches, tailors, autofills, and helps you apply at scale.
            </p>
            <div className="mt-8 flex justify-center">
              <Link href="/login">
                <ActionButton label="Install free" />
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
