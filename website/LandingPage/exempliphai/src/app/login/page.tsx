"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  type ConfirmationResult,
} from "firebase/auth";
import { useAuth } from "@/lib/auth/auth-context";
import { ensureAuthPersistence } from "@/lib/auth/persistence";
import { getFirebase } from "@/lib/firebase/client";

function normalizeUsPhoneToE164(input: string): string {
  const digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  throw new Error("Enter a 10-digit phone number");
}

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"send" | "verify">("send");

  const [busy, setBusy] = useState<"send" | "verify" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<RecaptchaVerifier | null>(null);
  const sentDigitsRef = useRef<string>("");

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard" as any);
  }, [loading, user, router]);

  const phoneDigits = useMemo(() => phone.replace(/\D/g, ""), [phone]);
  const canSend = phoneDigits.length === 10;

  // If the user edits the phone after sending a code, force a resend.
  useEffect(() => {
    if (stage !== "verify") return;
    if (!sentDigitsRef.current) return;
    if (phoneDigits === sentDigitsRef.current) return;

    confirmationRef.current = null;
    setCode("");
    setStage("send");
    setMsg(null);
  }, [phoneDigits, stage]);

  async function sendCode() {
    setErr(null);
    setMsg(null);

    if (!canSend) return;

    setBusy("send");

    try {
      const fb = getFirebase();
      const auth = fb.auth;

      if (!auth) {
        throw new Error(
          "Firebase auth is not configured. Set NEXT_PUBLIC_FIREBASE_* env vars and redeploy.",
        );
      }

      // Ensure persistence is set before initiating phone auth.
      await ensureAuthPersistence();

      if (!recaptchaRef.current) {
        recaptchaRef.current = new RecaptchaVerifier(auth, "recaptcha-container", {
          size: "invisible",
        });
      }

      const normalizedPhone = normalizeUsPhoneToE164(phone);

      const confirmation = await signInWithPhoneNumber(
        auth,
        normalizedPhone,
        recaptchaRef.current,
      );

      confirmationRef.current = confirmation;
      sentDigitsRef.current = phoneDigits;
      setStage("verify");
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

      const trimmed = code.trim();
      if (!/^\d{6}$/.test(trimmed)) {
        throw new Error("Enter the 6-digit code.");
      }

      // Ensure persistence is set before confirming.
      await ensureAuthPersistence();

      // Firebase phone auth can occasionally hang (network / extensions / adblock / reCAPTCHA edge cases).
      // Add a timeout so the UI never gets stuck on "Verifying…" forever.
      const confirmPromise = confirmationRef.current.confirm(trimmed);
      await Promise.race([
        confirmPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Verification timed out. Please try again.")), 20000),
        ),
      ]);

      // Force token materialization + local persistence write.
      try {
        const fb = getFirebase();
        await fb?.auth?.currentUser?.getIdToken(true);
      } catch {
        // best-effort
      }

      setMsg("Signed in.");
      setCode("");

      // On static-export deployments (trailingSlash), Next router transitions can occasionally hang.
      // Use a hard navigation after successful auth.
      if (typeof window !== "undefined") {
        window.location.assign("/dashboard/");
        return;
      }

      router.replace("/dashboard" as any);
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
          <div className="flex flex-col items-center text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border bg-card">
              <Image
                src="/icons/logo-main.png"
                alt="exempliphai logo"
                width={34}
                height={34}
                priority
              />
            </div>
            <div className="mt-3 text-2xl font-black tracking-tight">exempliphai</div>
          </div>

          <p className="mt-2 text-center text-sm text-muted-foreground">
            Sign in with your phone number.
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
              <span className="text-sm font-medium">Phone</span>
              <input
                id="login-phone"
                className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="(555) 123-4567"
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
              disabled={!canSend || busy !== null}
              type="button"
            >
              {busy === "send" ? "Sending…" : "Send code"}
            </button>

            {stage === "verify" ? (
              <>
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
                  type="button"
                >
                  {busy === "verify" ? "Verifying…" : "Verify"}
                </button>
              </>
            ) : null}
          </div>

          {/* invisible reCAPTCHA container */}
          <div id="recaptcha-container" />

          <div className="mt-6 flex items-center justify-center">
            <Link
              className="text-sm text-primary underline-offset-4 hover:underline"
              href="/"
            >
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
