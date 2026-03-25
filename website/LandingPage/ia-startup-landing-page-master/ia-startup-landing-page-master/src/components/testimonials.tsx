"use client";

import { motion } from "motion/react";
import Image, { type StaticImageData } from "next/image";
import Avatar1 from "@/assets/avatars/avatar-1.png";
import Avatar2 from "@/assets/avatars/avatar-2.png";
import Avatar3 from "@/assets/avatars/avatar-3.png";
import Avatar4 from "@/assets/avatars/avatar-4.png";

const TESTIMONIALS = [
  {
    text: "“This product has completely transformed how I manage my projects and deadlines”",
    name: "Sophia Perez",
    position: "Director, Quantum",
    avatarImg: Avatar1,
  },
  {
    text: "“These AI tools have completely revolutionized our SEO entire strategy overnight”",
    name: "Tom Cucherosset",
    position: "Founder, InkGames",
    avatarImg: Avatar2,
  },
  {
    text: "“The user interface is so intuitive and easy to use, it has saved us countless hours”",
    name: "Sophia Perez",
    position: "Product Owner, Innovate",
    avatarImg: Avatar3,
  },
  {
    text: "“Our team's productivity has increased significantly since we started using this tool”",
    name: "Alec Witthen",
    position: "CTO, Tech Solutions",
    avatarImg: Avatar4,
  },
] satisfies Array<{
  text: string;
  name: string;
  position: string;
  avatarImg: StaticImageData;
}>;

export function Testimonials() {
  return (
    <section className="py-20 md:py-24">
      <div className="container">
        <h2 className="text-center font-medium text-5xl tracking-tighter md:text-6xl">
          Beyond Expectations.
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-white/70 tracking-tight md:text-xl">
          Our revolutionary AI SEO tools have transformed our clients&apos;
          strategies.
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
            {[...TESTIMONIALS, ...TESTIMONIALS].map((testimonial, index) => (
              <div
                key={index}
                className="max-w-xs flex-none rounded-xl border border-muted bg-[linear-gradient(to_bottom_left,rgb(140,69,255,0.3),black)] p-6 md:max-w-md md:p-10"
              >
                <p className="text-lg tracking-tight md:text-2xl">
                  {testimonial.text}
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="relative before:absolute before:inset-0 before:z-10 before:rounded-lg before:border before:border-white/30 before:content-[''] after:absolute after:inset-0 after:rounded-lg after:bg-[rgb(140,69,244)] after:mix-blend-soft-light after:content-['']">
                    <Image
                      src={testimonial.avatarImg}
                      alt={testimonial.name}
                      className="size-11 rounded-lg grayscale"
                    />
                  </div>
                  <div>
                    <p>{testimonial.name}</p>
                    <p className="text-sm text-white/50">
                      {testimonial.position}
                    </p>
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
