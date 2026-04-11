"use client";

import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  type ValueAnimationTransition,
} from "motion/react";
import type { ComponentPropsWithoutRef } from "react";
import { useEffect, useRef, useState } from "react";
import ProductImage from "@/assets/product-image.png";
import { landingContent } from "@/config/landing-content";

const tabs = landingContent.featureTabs.items;

type FeatureTabProps = (typeof tabs)[number] &
  ComponentPropsWithoutRef<"div"> & { selected: boolean };

const FeatureTab = (props: FeatureTabProps) => {
  const tabRef = useRef<HTMLDivElement>(null);
  const xPercentage = useMotionValue(0);
  const yPercentage = useMotionValue(0);

  const maskImage = useMotionTemplate`radial-gradient(80px 80px at ${xPercentage}% ${yPercentage}%, black, transparent)`;

  useEffect(() => {
    if (!tabRef.current || !props.selected) return;

    xPercentage.set(0);
    yPercentage.set(0);
    const { height, width } = tabRef.current.getBoundingClientRect();

    const circumference = height * 2 + width * 2;
    const times = [
      0,
      width / circumference,
      (width + height) / circumference,
      (width * 2 + height) / circumference,
      1,
    ];

    const options: ValueAnimationTransition = {
      times,
      duration: 5,
      repeat: Number.POSITIVE_INFINITY,
      repeatType: "loop",
      ease: "linear",
    };

    animate(xPercentage, [0, 100, 100, 0, 0], options);
    animate(yPercentage, [0, 0, 100, 100, 0], options);
  }, [props.selected, xPercentage, yPercentage]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: <div> required for animation hit-target
    <div
      className="relative flex cursor-pointer items-center gap-3 rounded-xl border border-muted p-3 hover:bg-muted/30"
      ref={tabRef}
      onClick={props.onClick}
    >
      {props.selected && (
        <motion.div
          style={{ maskImage }}
          className="-m-px absolute inset-0 rounded-xl border border-[#A369FF]"
        />
      )}
      <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-muted sm:size-12">
        <props.icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-snug">{props.title}</div>
        <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
          {props.description}
        </div>
      </div>
      {props.isNew && (
        <div className="ml-auto shrink-0 rounded-full bg-primary px-2 py-0.5 font-semibold text-primary-foreground text-xs">
          New
        </div>
      )}
    </div>
  );
};

export function Features() {
  const [selectedTab, setSelectedTab] = useState(0);
  const [demoReady, setDemoReady] = useState(false);

  const backgroundPositionX = useMotionValue<number>(tabs[0].backgroundPositionX);
  const backgroundPositionY = useMotionValue<number>(tabs[0].backgroundPositionY);
  const backgroundSizeX = useMotionValue<number>(tabs[0].backgroundSizeX);

  const backgroundPosition = useMotionTemplate`${backgroundPositionX}% ${backgroundPositionY}%`;
  const backgroundSize = useMotionTemplate`${backgroundSizeX}% auto`;

  const handleSelectTab = (index: number) => {
    setSelectedTab(index);

    const animateOptions: ValueAnimationTransition = {
      duration: 2,
      ease: "easeInOut",
    };

    animate(
      backgroundSizeX,
      [backgroundSizeX.get(), 100, tabs[index].backgroundSizeX],
      animateOptions,
    );
    animate(
      backgroundPositionX,
      [backgroundPositionX.get(), tabs[index].backgroundPositionX],
      animateOptions,
    );
    animate(
      backgroundPositionY,
      [backgroundPositionY.get(), tabs[index].backgroundPositionY],
      animateOptions,
    );
  };

  return (
    <section id="features" className="py-20 md:py-24">
      <div className="container">
        <h2 className="text-center font-medium text-5xl tracking-tighter md:text-6xl">
          {landingContent.featureTabs.title}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground tracking-tight md:text-xl">
          {landingContent.featureTabs.subtitle}
        </p>

        <div className="mt-10 grid gap-3 lg:grid-cols-3">
          {tabs.map((tab, index) => (
            <FeatureTab
              {...tab}
              key={tab.title}
              onClick={() => handleSelectTab(index)}
              selected={selectedTab === index}
            />
          ))}
        </div>

        <motion.div id="demo" className="mt-3 rounded-xl border border-muted p-2.5 scroll-mt-28">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-muted bg-black">
            {!demoReady ? (
              <button
                type="button"
                onClick={() => setDemoReady(true)}
                className="absolute inset-0 grid place-items-center bg-center"
                style={{
                  backgroundPosition: backgroundPosition.get(),
                  // Fit vertically; crop horizontally as needed.
                  backgroundSize: 'auto 100%',
                  backgroundImage: `url(${ProductImage})`,
                }}
                aria-label="Play demo video"
              >
                <span className="flex items-center gap-3 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur">
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-[#a78bfa] text-white">
                    ▶
                  </span>
                  Play demo
                </span>
              </button>
            ) : (
              <video
                className="h-full w-full"
                controls
                preload="metadata"
                playsInline
                poster={typeof ProductImage === 'string' ? ProductImage : (ProductImage as any)?.src}
              >
                <source src="/videos/demo.webm" type="video/webm" />
                <source src="/videos/demo.mp4" type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            )}
          </div>
        </motion.div>

        <div className="mx-auto mt-5 max-w-3xl rounded-xl border border-muted bg-card p-4 text-sm text-muted-foreground">
          Tip: Start with <span className="font-medium text-foreground">10 roles</span> in List mode. Tailor, apply, then follow up from the tracker tomorrow.
        </div>
      </div>
    </section>
  );
}
