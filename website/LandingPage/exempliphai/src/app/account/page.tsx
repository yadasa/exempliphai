"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signOut } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";

export default function AccountPage() {
  return (
    <RequireAuth>
      <AccountInner />
    </RequireAuth>
  );
}

function AccountInner() {
  const { user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!user) return;
        const { db } = getFirebase();
        const snap = await getDoc(doc(db, "users", user.uid));
        const dn = (snap.data() as any)?.account?.displayName;
        if (alive) setDisplayName(String(dn || ""));
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [user]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (!user) throw new Error("Not signed in");
      const { db } = getFirebase();
      await setDoc(
        doc(db, "users", user.uid),
        {
          account: {
            uid: user.uid,
            phoneNumber: user.phoneNumber || null,
            displayName: displayName.trim() || null,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setMsg("Saved.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const { auth } = getFirebase();
      await signOut(auth);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container py-20 md:py-24">
      <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-6 shadow-sm md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
          <div className="flex gap-3">
            <Link className="text-sm text-primary underline" href={"/profile" as any}>
              Edit profile
            </Link>
            <Link className="text-sm text-primary underline" href="/">
              Home
            </Link>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as <span className="font-medium">{user?.phoneNumber}</span>
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
          <label className="grid gap-1" htmlFor="account-display-name">
            <span className="text-sm font-medium">Display name</span>
            <input
              id="account-display-name"
              className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Jane Doe"
              disabled={busy}
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <button
              className="bg-gradient-primary h-11 rounded-md px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onClick={save}
              disabled={busy}
            >
              Save
            </button>
            <button
              className="h-11 rounded-md border bg-card px-4 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onClick={logout}
              disabled={busy}
            >
              Sign out
            </button>
          </div>
        </div>

        <div className="mt-6 text-xs text-muted-foreground">
          UID: {user?.uid}
        </div>
      </div>
    </div>
  );
}
