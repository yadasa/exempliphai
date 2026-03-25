"use client";

import { motion } from "motion/react";
import Image from "next/image";
import Avatar1 from "@/assets/avatars/avatar-1.png";
import Avatar2 from "@/assets/avatars/avatar-2.png";
import Avatar3 from "@/assets/avatars/avatar-3.png";
import Avatar4 from "@/assets/avatars/avatar-4.png";
import { landingContent } from "@/config/landing-content";

const AVATARS = [Avatar1, Avatar2, Avatar3, Avatar4] as const;

type Avatar = (typeof AVATARS)[number];

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  avatarImg: Avatar;
};

const TESTIMONIALS: Testimonial[] = landingContent.testimonials.items.map(
  (t, index) => ({
    quote: t.quote,
    name: t.name,
    role: t.role,
    avatarImg: AVATARS[index % AVATARS.length],
  }),
);

export function Testimonials() {
  return (
    <section id="testimonials" className="py-20 md:py-24">
      <div className="container">
        <h2 className="text-center font-medium text-5xl tracking-tighter md:text-6xl">
          {landingContent.testimonials.title}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground tracking-tight md:text-xl">
          {landingContent.testimonials.subtitle}
        </p>

        <div className="mask-[linear-gradient(to_right,transparent,black_20%,black_80%,transparent)] mt-10 flex overflow-hidden">
          <motion.div
            initial={{ x: "-50%" }}
            animate={{ x: "0" }}
            transition={{
              repeat: Number.POSITIVE_INFINITY,
              duration: 50,
              ease: "linear",
            }}
            className="flex flex-none gap-5"
          >
            {[...TESTIMONIALS, ...TESTIMONIALS].map((t, index) => (
              <div
                key={index}
                className="max-w-xs flex-none rounded-xl border border-muted bg-[linear-gradient(to_bottom_left,rgb(37,99,235,0.20),black)] p-6 md:max-w-md md:p-10"
              >
                <p className="text-lg tracking-tight md:text-2xl">{t.quote}</p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="relative before:absolute before:inset-0 before:z-10 before:rounded-lg before:border before:border-white/30 before:content-[''] after:absolute after:inset-0 after:rounded-lg after:bg-[rgb(124,58,237)] after:mix-blend-soft-light after:content-['']">
                    <Image
                      src={t.avatarImg}
                      alt={t.name}
                      className="size-11 rounded-lg grayscale"
                    />
                  </div>
                  <div>
                    <p>{t.name}</p>
                    <p className="text-sm text-muted-foreground">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
