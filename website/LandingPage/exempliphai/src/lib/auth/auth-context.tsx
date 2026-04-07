"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { ensureAuthPersistence } from "@/lib/auth/persistence";
import { getFirebase } from "@/lib/firebase/client";

type AuthState = {
  user: User | null;
  loading: boolean;
  degraded: boolean;
  reason: string | null;
};

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  degraded: false,
  reason: null,
});

const SHADOW_KEY = "EXEMPLIPHAI_FIREBASE_AUTH_SHADOW";

async function writeShadowAuth(u: User | null) {
  try {
    if (!u) {
      localStorage.removeItem(SHADOW_KEY);
      window.dispatchEvent(new Event("exempliphai-auth-changed"));
      return;
    }

    const idToken = await u.getIdToken();

    // Firebase Auth User has an internal stsTokenManager; it's not part of the public User type.
    const stm = (u as User & {
      stsTokenManager?: {
        refreshToken?: string;
        expirationTime?: number;
      };
    })?.stsTokenManager;

    localStorage.setItem(
      SHADOW_KEY,
      JSON.stringify({
        uid: u.uid,
        email: u.email || "",
        providerData: (u.providerData || []).map((p) => ({
          providerId: p.providerId,
        })),
        stsTokenManager: {
          accessToken: idToken,
          refreshToken: String(stm?.refreshToken || ""),
          expirationTime: Number(stm?.expirationTime || 0),
        },
        updatedAtMs: Date.now(),
      }),
    );

    window.dispatchEvent(new Event("exempliphai-auth-changed"));
  } catch (err) {
    console.warn("[auth] failed to write shadow record", err);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [degraded, setDegraded] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    let timeoutId: number | null = null;
    let firstEventSeen = false;

    const { auth } = getFirebase();

    if (!auth) {
      setUser(null);
      setLoading(false);
      setDegraded(false);
      setReason("auth_not_configured");
      return;
    }

    // Fast-path: if Firebase already has a currentUser (e.g. immediately after phone verify),
    // don't wait on the async persistence/rehydration path to render authenticated pages.
    try {
      const cu = auth.currentUser;
      if (cu) {
        setUser(cu);
        setLoading(false);
      }
    } catch {
      // ignore
    }

    const finish = (
      nextUser: User | null,
      next: { degraded: boolean; reason: string | null },
    ) => {
      if (cancelled) return;
      setUser(nextUser);
      setLoading(false);
      setDegraded(next.degraded);
      setReason(next.reason);
    };

    (async () => {
      // Ensure persistence is configured before we rely on rehydration.
      await ensureAuthPersistence();

      // If the first auth event doesn't arrive promptly, stop blocking the UI.
      timeoutId = window.setTimeout(() => {
        if (firstEventSeen || cancelled) return;
        finish(auth.currentUser ?? null, {
          degraded: true,
          reason: "auth_bootstrap_timeout",
        });
      }, 4500);

      unsub = onAuthStateChanged(auth, (u) => {
        firstEventSeen = true;
        if (timeoutId != null) window.clearTimeout(timeoutId);
        finish(u, { degraded: false, reason: null });
        void writeShadowAuth(u);
      });
    })().catch((err) => {
      console.warn("[auth] bootstrap failed", err);
      finish(auth.currentUser ?? null, {
        degraded: true,
        reason: "auth_bootstrap_exception",
      });
    });

    // Allow the extension content script to request a clean Firebase sign-out
    // without brute-force deleting IndexedDB (which can wedge the Auth SDK).
    // Use an explicit ack so the extension can wait for completion.
    const onMessage = (evt: MessageEvent) => {
      try {
        const d: any = evt?.data;
        if (!d || d.source !== "exempliphai-extension") return;
        if (d.action !== "EXEMPLIPHAI_SITE_SIGN_OUT") return;

        auth
          .signOut()
          .then(() => {
            window.postMessage(
              {
                source: "exempliphai-site",
                action: "EXEMPLIPHAI_SITE_SIGN_OUT_DONE",
                ok: true,
              },
              "*",
            );
          })
          .catch((err) => {
            console.warn("[auth] signOut from extension failed", err);
            window.postMessage(
              {
                source: "exempliphai-site",
                action: "EXEMPLIPHAI_SITE_SIGN_OUT_DONE",
                ok: false,
                error: String(err?.message || err),
              },
              "*",
            );
          });
      } catch {
        // ignore
      }
    };

    window.addEventListener("message", onMessage);

    return () => {
      cancelled = true;
      if (timeoutId != null) window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
      if (unsub) unsub();
    };
  }, []);

  const value = useMemo(
    () => ({ user, loading, degraded, reason }),
    [user, loading, degraded, reason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
