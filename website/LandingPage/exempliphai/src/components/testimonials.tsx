"use client";

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { motion } from "motion/react";
import Image, { type StaticImageData } from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import Avatar1 from "@/assets/avatars/avatar-1.png";
import Avatar2 from "@/assets/avatars/avatar-2.png";
import Avatar3 from "@/assets/avatars/avatar-3.png";
import Avatar4 from "@/assets/avatars/avatar-4.png";
import Avatar5 from "@/assets/avatars/avatar-5.png";
import Avatar6 from "@/assets/avatars/avatar-6.png";
import Avatar7 from "@/assets/avatars/avatar-7.png";
import Avatar8 from "@/assets/avatars/avatar-8.png";
import Avatar9 from "@/assets/avatars/avatar-9.png";
import Avatar10 from "@/assets/avatars/avatar-10.png";
import { landingContent } from "@/config/landing-content";
import { getFirebase } from "@/lib/firebase/client";

const AVATARS = [
  Avatar1,
  Avatar2,
  Avatar3,
  Avatar4,
  Avatar5,
  Avatar6,
  Avatar7,
  Avatar8,
  Avatar9,
  Avatar10,
] as const;

type AvatarImg = StaticImageData | string;

type Testimonial = {
  quote: string;
  name: string;
  role: string;
  avatarImg: AvatarImg;
};

type TestimonialSubmission = {
  name: string;
  quote: string;
  avatarDataUrl?: string | null;
  createdAt?: string;
};

const LOCAL_TESTIMONIALS_KEY = "exempliphai:testimonials:submissions:v1";

function loadLocalSubmissions(): TestimonialSubmission[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_TESTIMONIALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((t) => ({
        name: String(t?.name || "").trim(),
        quote: String(t?.quote || "").trim(),
        avatarDataUrl: typeof t?.avatarDataUrl === "string" ? t.avatarDataUrl : null,
        createdAt: typeof t?.createdAt === "string" ? t.createdAt : undefined,
      }))
      .filter((t) => t.name && t.quote);
  } catch {
    return [];
  }
}

function saveLocalSubmissions(list: TestimonialSubmission[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LOCAL_TESTIMONIALS_KEY,
      JSON.stringify(list.slice(-50)),
    );
  } catch {
    // ignore
  }
}

async function resizeImageFileToPngDataUrl(file: File, sizePx = 88) {
  const blobUrl = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    img.decoding = "async";

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = blobUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    // Cover-crop the image to a square.
    const scale = Math.max(sizePx / img.width, sizePx / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const x = (sizePx - w) / 2;
    const y = (sizePx - h) / 2;

    ctx.clearRect(0, 0, sizePx, sizePx);
    ctx.drawImage(img, x, y, w, h);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

const SEED_TESTIMONIALS: Testimonial[] = landingContent.testimonials.items.map(
  (t, index) => ({
    quote: t.quote,
    name: t.name,
    role: t.role,
    avatarImg: AVATARS[index % AVATARS.length],
  }),
);

function formatQuote(s: string) {
  const q = String(s || "").trim();
  if (!q) return "";
  // Avoid double-wrapping when the seed data already includes quotes.
  if (q.startsWith("“") && q.endsWith("”")) return q;
  if (q.startsWith('"') && q.endsWith('"')) return `“${q.slice(1, -1)}”`;
  return `“${q}”`;
}

export function Testimonials() {
  const [testimonials, setTestimonials] = useState<Testimonial[]>(SEED_TESTIMONIALS);

  const [name, setName] = useState("");
  const [quote, setQuote] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    const shuffled = [...SEED_TESTIMONIALS].sort(() => Math.random() - 0.5);

    const local = loadLocalSubmissions();
    const localMapped: Testimonial[] = local.map((t, index) => ({
      quote: formatQuote(t.quote),
      name: t.name,
      role: "Submitted testimonial",
      avatarImg: t.avatarDataUrl || AVATARS[(shuffled.length + index) % AVATARS.length],
    }));

    setTestimonials([...shuffled, ...localMapped]);

    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const marqueeItems = useMemo(
    () => [...testimonials, ...testimonials],
    [testimonials],
  );

  const canSubmit = name.trim().length > 0 && quote.trim().length > 0;

  const onPickPhoto = async (file: File | null) => {
    if (!file) {
      setAvatarDataUrl(null);
      return;
    }
    const dataUrl = await resizeImageFileToPngDataUrl(file, 88);
    setAvatarDataUrl(dataUrl);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy) return;

    setBusy(true);
    try {
      const submission: TestimonialSubmission = {
        name: name.trim(),
        quote: quote.trim(),
        avatarDataUrl,
        createdAt: new Date().toISOString(),
      };

      // 1) Try Firestore (optional, may fail due to rules or missing config)
      try {
        const fb = getFirebase();
        if (fb.configured) {
          await addDoc(collection(fb.db, "testimonials"), {
            name: submission.name,
            quote: submission.quote,
            avatarDataUrl: submission.avatarDataUrl || null,
            source: "landing",
            createdAt: serverTimestamp(),
          });
        }
      } catch {
        // fall back to local
      }

      // 2) Always store locally as a backup.
      const existing = loadLocalSubmissions();
      saveLocalSubmissions([...existing, submission]);

      // 3) Optimistically add to the marquee.
      setTestimonials((cur) => [
        ...cur,
        {
          quote: formatQuote(submission.quote),
          name: submission.name,
          role: "Submitted testimonial",
          avatarImg: submission.avatarDataUrl || AVATARS[cur.length % AVATARS.length],
        },
      ]);

      setName("");
      setQuote("");
      setAvatarDataUrl(null);
      showToast("Submitted!");
    } catch (err) {
      console.error("testimonial submit failed", err);
      showToast("Couldn’t submit (try again)");
    } finally {
      setBusy(false);
    }
  };

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
            {marqueeItems.map((t, index) => (
              <div
                key={`${t.name}-${t.role}-${index}`}
                className="max-w-xs flex-none rounded-xl border border-muted bg-[linear-gradient(to_bottom_left,rgb(37,99,235,0.20),black)] p-6 md:max-w-md md:p-10"
              >
                <p className="text-lg tracking-tight md:text-2xl">{t.quote}</p>
                <div className="mt-5 flex items-center gap-3">
                  <div className="relative before:absolute before:inset-0 before:z-10 before:rounded-lg before:border before:border-white/30 before:content-[''] after:absolute after:inset-0 after:rounded-lg after:bg-[rgb(124,58,237)] after:mix-blend-soft-light after:content-['']">
                    {typeof t.avatarImg === "string" ? (
                      // User submission: data URL
                      <img
                        src={t.avatarImg}
                        alt={t.name}
                        className="size-11 rounded-lg grayscale"
                        width={44}
                        height={44}
                      />
                    ) : (
                      <Image
                        src={t.avatarImg}
                        alt={t.name}
                        className="size-11 rounded-lg grayscale"
                      />
                    )}
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

        <div className="mx-auto mt-10 max-w-3xl rounded-2xl border border-muted bg-card p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3
                id="submit-testimonial"
                className="text-lg font-semibold tracking-tight"
              >
                Submit a testimonial
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Share what helped you apply faster. (We may lightly edit for
                length.)
              </p>
            </div>
            <a
              href="#submit-testimonial"
              className="text-sm text-primary underline"
            >
              Jump to form
            </a>
          </div>

          <form className="mt-6 grid gap-4" onSubmit={submit}>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-medium">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="h-11 w-full rounded-md border border-muted bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">Photo (optional)</span>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      onPickPhoto(e.target.files?.[0] || null).catch(() => {
                        showToast("Couldn’t read image");
                      })
                    }
                    className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border file:border-muted file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium"
                  />
                  {avatarDataUrl ? (
                    <img
                      src={avatarDataUrl}
                      alt="Uploaded avatar preview"
                      className="size-11 rounded-lg border border-muted"
                      width={44}
                      height={44}
                    />
                  ) : null}
                </div>
                <span className="text-xs text-muted-foreground">
                  Resized to 88×88.
                </span>
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-sm font-medium">Testimonial</span>
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder="What changed for you after using exempliphai?"
                className="min-h-[120px] w-full resize-y rounded-md border border-muted bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                By submitting, you agree we can display your testimonial on this
                site.
              </p>
              <button
                type="submit"
                disabled={!canSubmit || busy}
                className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        </div>

        {toast ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-muted bg-background/90 px-4 py-2 text-sm shadow-lg backdrop-blur"
          >
            {toast}
          </motion.div>
        ) : null}
      </div>
    </section>
  );
}
