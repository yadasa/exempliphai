"use client";

import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from "firebase/auth";
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
import { signInWithVerificationIdAndCode } from "@/lib/firebase/phone-auth";
import { uiText } from "@/lib/utils";

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
  role: string;
  quote: string;
  avatarDataUrl?: string | null;
};

type SubmitStage = "idle" | "phone" | "code" | "saving";

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
  const [role, setRole] = useState("");
  const [quote, setQuote] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);

  const [submitOpen, setSubmitOpen] = useState(false);

  const [pending, setPending] = useState<TestimonialSubmission | null>(null);
  const [stage, setStage] = useState<SubmitStage>("idle");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [confirmationResult, setConfirmationResult] =
    useState<ConfirmationResult | null>(null);

  const recaptchaContainerRef = useRef<HTMLDivElement | null>(null);
  const recaptchaVerifierRef = useRef<RecaptchaVerifier | null>(null);

  const phoneInputRef = useRef<HTMLInputElement | null>(null);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

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
    setTestimonials(shuffled);

    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaVerifierRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (stage === "phone") phoneInputRef.current?.focus();
    if (stage === "code") codeInputRef.current?.focus();
  }, [stage]);

  const marqueeItems = useMemo(
    () => [...testimonials, ...testimonials],
    [testimonials],
  );

  const canSubmit = name.trim().length > 0 && role.trim().length > 0 && quote.trim().length > 0;

  const onPickPhoto = async (file: File | null) => {
    if (!file) {
      setAvatarDataUrl(null);
      return;
    }
    const dataUrl = await resizeImageFileToPngDataUrl(file, 88);
    setAvatarDataUrl(dataUrl);
  };

  const resetVerificationFlow = () => {
    setPending(null);
    setStage("idle");
    setPhoneNumber("");
    setVerificationCode("");
    setConfirmationResult(null);

    try {
      recaptchaVerifierRef.current?.clear();
    } catch {
      // ignore
    }
    recaptchaVerifierRef.current = null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || busy || stage !== "idle") return;

    // Phase 1: capture the testimonial content and prompt for phone verification.
    setPending({
      name: name.trim(),
      role: role.trim(),
      quote: quote.trim(),
      avatarDataUrl,
    });
    setStage("phone");
  };

  const sendVerificationCode = async () => {
    if (busy) return;
    if (!pending) return;

    const phone = phoneNumber.trim();
    if (!phone) {
      showToast(uiText("Enter your phone number"));
      return;
    }

    const fb = getFirebase();
    if (!fb.configured) {
      showToast(uiText("Firebase not configured"));
      return;
    }

    setBusy(true);
    try {
      if (!recaptchaContainerRef.current) {
        throw new Error("Missing reCAPTCHA container");
      }

      // Always recreate to avoid stale widget state between retries.
      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaVerifierRef.current = new RecaptchaVerifier(
        fb.auth,
        recaptchaContainerRef.current,
        { size: "invisible" },
      );

      await recaptchaVerifierRef.current.render();

      const result = await signInWithPhoneNumber(
        fb.auth,
        phone,
        recaptchaVerifierRef.current,
      );
      setConfirmationResult(result);
      setStage("code");
      showToast(uiText("Verification code sent"));
    } catch (err) {
      console.error("sendVerificationCode failed", err);
      showToast(uiText("Couldn’t send code (try again)"));

      try {
        recaptchaVerifierRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaVerifierRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  const verifyCodeAndSubmit = async () => {
    if (busy) return;
    if (!pending || !confirmationResult) return;

    const code = verificationCode.trim();
    if (!code) {
      showToast(uiText("Enter the verification code"));
      return;
    }

    const fb = getFirebase();
    if (!fb.configured) {
      showToast(uiText("Firebase not configured"));
      return;
    }

    setBusy(true);
    setStage("saving");
    try {
      const userCred = await signInWithVerificationIdAndCode(
        fb.auth,
        confirmationResult.verificationId,
        code,
      );

      await addDoc(collection(fb.db, "testimonials"), {
        name: pending.name,
        role: pending.role,
        quote: pending.quote,
        avatarDataUrl: pending.avatarDataUrl || null,
        source: "landing",
        createdAt: serverTimestamp(),
        uid: userCred.user.uid,
      });

      // Only display after Firestore succeeds (no local preview).
      setTestimonials((cur) => [
        ...cur,
        {
          quote: formatQuote(pending.quote),
          name: pending.name,
          role: pending.role || "Submitted testimonial",
          avatarImg: pending.avatarDataUrl || AVATARS[cur.length % AVATARS.length],
        },
      ]);

      setName("");
      setRole("");
      setQuote("");
      setAvatarDataUrl(null);
      resetVerificationFlow();
      setSubmitOpen(false);
      showToast(uiText("Submitted!"));
    } catch (err) {
      console.error("verifyCodeAndSubmit failed", err);
      showToast(uiText("Couldn’t verify or submit (try again)"));
      setStage("code");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="testimonials" className="py-20 md:py-24">
      <div className="container">
        <h2 className="text-center font-medium text-5xl tracking-tighter md:text-6xl">
          {uiText(landingContent.testimonials.title)}
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-center text-lg text-muted-foreground tracking-tight md:text-xl">
          {uiText(landingContent.testimonials.subtitle)}
        </p>

        <div className="mask-[linear-gradient(to_right,transparent,black_20%,black_80%,transparent)] mt-10 flex overflow-hidden">
          <motion.div
            initial={{ x: "0" }}
            animate={{ x: "-50%" }}
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
                className="max-w-xs flex-none rounded-xl border border-muted bg-gradient-to-bl from-blue-600/20 to-background p-6 md:max-w-md md:p-10 dark:to-black"
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
          {!submitOpen ? (
            <button
              type="button"
              onClick={() => setSubmitOpen(true)}
              className="w-full text-center text-sm font-semibold text-primary underline"
            >
              {uiText("Submit a testimonial")}
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id="submit-testimonial" className="text-lg font-semibold tracking-tight">
                    {uiText("Submit a testimonial")}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {uiText(
                      "Share what helped you apply faster. (We may lightly edit for length.)",
                    )}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSubmitOpen(false)}
                  className="text-xs text-muted-foreground underline"
                >
                  {uiText("Close")}
                </button>
              </div>

              <form className="mt-6 grid gap-4" onSubmit={submit}>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-sm font-medium">{uiText("Name")}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={uiText("Your name")}
                  disabled={stage !== "idle"}
                  className="h-11 w-full rounded-md border border-muted bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">{uiText("Your role")}</span>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={uiText("e.g., Sales Engineer")}
                  disabled={stage !== "idle"}
                  className="h-11 w-full rounded-md border border-muted bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-sm font-medium">{uiText("Photo (optional)")}</span>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept="image/*"
                    disabled={stage !== "idle"}
                    onChange={(e) =>
                      onPickPhoto(e.target.files?.[0] || null).catch(() => {
                        showToast(uiText("Couldn’t read image"));
                      })
                    }
                    className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border file:border-muted file:bg-background file:px-3 file:py-2 file:text-sm file:font-medium disabled:opacity-70"
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
                <span className="text-xs text-muted-foreground">{uiText("Resized to 88×88.")}</span>
              </label>
            </div>

            <label className="grid gap-1">
              <span className="text-sm font-medium">{uiText("Testimonial")}</span>
              <textarea
                value={quote}
                onChange={(e) => setQuote(e.target.value)}
                placeholder={uiText("What changed for you after using exempliphai?")}
                disabled={stage !== "idle"}
                className="min-h-[120px] w-full resize-y rounded-md border border-muted bg-background p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
              />
            </label>

            {stage !== "idle" ? (
              <div className="rounded-xl border border-muted bg-background p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold tracking-tight">
                      {uiText("Verify your phone to submit")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {uiText(
                        "This helps us reduce spam. We’ll only post your testimonial after verification.",
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={resetVerificationFlow}
                    disabled={busy}
                    className="text-xs text-muted-foreground underline disabled:opacity-60"
                  >
                    {uiText("Cancel")}
                  </button>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <label className="grid gap-1 md:col-span-2">
                    <span className="text-xs font-medium">{uiText("Phone number")}</span>
                    <input
                      ref={phoneInputRef}
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder={uiText("+1 555 555 5555")}
                      disabled={busy || stage === "saving" || stage === "code"}
                      className="h-11 w-full rounded-md border border-muted bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {uiText("Include country code (+1, +44, etc.).")}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => sendVerificationCode().catch(() => {})}
                    disabled={busy || stage === "saving" || stage === "code"}
                    className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy && stage === "phone" ? uiText("Sending…") : uiText("Send code")}
                  </button>
                </div>

                {stage === "code" || stage === "saving" ? (
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <label className="grid gap-1 md:col-span-2">
                      <span className="text-xs font-medium">{uiText("Verification code")}</span>
                      <input
                        ref={codeInputRef}
                        value={verificationCode}
                        onChange={(e) => setVerificationCode(e.target.value)}
                        placeholder={uiText("123456")}
                        inputMode="numeric"
                        disabled={busy || stage === "saving"}
                        className="h-11 w-full rounded-md border border-muted bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                      />
                      <span className="text-[11px] text-muted-foreground">
                        {uiText("Enter the code we texted you.")}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => verifyCodeAndSubmit().catch(() => {})}
                      disabled={busy || stage === "saving"}
                      className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {stage === "saving" ? uiText("Submitting…") : uiText("Verify & submit")}
                    </button>
                  </div>
                ) : null}

                {/* Required for Firebase phone auth */}
                <div ref={recaptchaContainerRef} className="h-0 overflow-hidden" />
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {uiText(
                  "By submitting, you agree we can display your testimonial on this site.",
                )}
              </p>
              <button
                type="submit"
                disabled={!canSubmit || busy || stage !== "idle"}
                className="bg-gradient-primary inline-flex h-11 items-center justify-center rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uiText("Submit")}
              </button>
            </div>
          </form>
            </>
          )}
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
