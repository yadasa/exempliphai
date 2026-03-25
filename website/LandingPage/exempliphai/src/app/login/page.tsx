"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { getFirebase } from "@/lib/firebase/client";
import { useAuth } from "@/lib/auth/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace("/account" as any);
  }, [loading, user, router]);

  async function sendCode() {
    setErr(null);
    setMsg(null);
    setBusy("send");

    try {
      const { auth } = getFirebase();

      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, "recaptcha-container", {
          size: "invisible",
        });
      }

      const confirmation = await signInWithPhoneNumber(
        auth,
        phone.trim(),
        recaptchaRef.current,
      );
      confirmationRef.current = confirmation;
      setMsg("SMS sent. Enter the code to verify.");
    } catch (e: any) {
      try {
        recaptchaRef.current?.clear();
      } catch {
        // ignore
      }
      recaptchaRef.current = null;
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function verifyCode() {
    setErr(null);
    setMsg(null);
    setBusy("verify");

    try {
      if (!confirmationRef.current) throw new Error("Send the SMS code first.");
      await confirmationRef.current.confirm(code.trim());
      setMsg("Signed in.");
      setCode("");
      router.replace("/account" as any);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{
          background:
            "radial-gradient(1000px 600px at 20% 10%, color-mix(in oklab, var(--color-primary) 22%, transparent), transparent 60%), radial-gradient(900px 500px at 80% 20%, color-mix(in oklab, var(--brand-violet) 18%, transparent), transparent 55%)",
        }}
      />

      <div className="container py-20 md:py-24">
        <div className="mx-auto max-w-lg rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur md:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with your phone number (SMS verification).
        </p>

        <div aria-live="polite" aria-atomic="true">
          {err ? (
            <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
              {err}
            </div>
          ) : null}
          {msg ? (
            <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              {msg}
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3">
          <label className="grid gap-1" htmlFor="login-phone">
            <span className="text-sm font-medium">Phone (E.164)</span>
            <input
              id="login-phone"
              className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="+15551234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              disabled={busy !== null}
            />
          </label>

          <button
            className="bg-gradient-primary h-11 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            onClick={sendCode}
            disabled={!phone.trim() || busy !== null}
          >
            {busy === "send" ? "Sending…" : "Send code"}
          </button>

          <label className="grid gap-1" htmlFor="login-code">
            <span className="text-sm font-medium">SMS code</span>
            <input
              id="login-code"
              className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              disabled={busy !== null}
            />
          </label>

          <button
            className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            onClick={verifyCode}
            disabled={!code.trim() || busy !== null}
          >
            {busy === "verify" ? "Verifying…" : "Verify"}
          </button>
        </div>

        {/* invisible reCAPTCHA container */}
        <div id="recaptcha-container" />

        <div className="mt-6 flex items-center justify-between gap-3">
          <Link className="text-sm text-primary underline-offset-4 hover:underline" href="/">
            Back to home
          </Link>
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            href={"/account" as any}
          >
            Account
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
}
