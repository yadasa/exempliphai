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
import { getFirebase } from "@/lib/firebase/client";

type AuthState = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { auth } = getFirebase();

    // If Firebase isn't configured, avoid crashing the app.
    if (!auth) {
      setUser(null);
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);

      // Extension bridge reliability: write a shadow auth record into localStorage.
      // The extension contentScript (siteAuthBridge.js) can read this immediately
      // even when Firebase Auth persistence uses IndexedDB.
      (async () => {
        try {
          const KEY = "EXEMPLIPHAI_FIREBASE_AUTH_SHADOW";
          if (!u) {
            localStorage.removeItem(KEY);
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

          const payload = {
            uid: u.uid,
            email: u.email || "",
            providerData: (u.providerData || []).map((p) => ({ providerId: p.providerId })),
            stsTokenManager: {
              accessToken: idToken,
              refreshToken: String(stm?.refreshToken || ""),
              expirationTime: Number(stm?.expirationTime || 0),
            },
            updatedAtMs: Date.now(),
          };

          localStorage.setItem(KEY, JSON.stringify(payload));
          window.dispatchEvent(new Event("exempliphai-auth-changed"));
        } catch (_) {
          // best-effort only
        }
      })();
    });

    // Allow the extension content script to request a clean Firebase sign-out
    // without brute-force deleting IndexedDB (which can wedge the Auth SDK).
    const onMessage = (evt: MessageEvent) => {
      try {
        const d: any = evt?.data;
        if (!d || d.source !== "exempliphai-extension") return;
        if (d.action !== "EXEMPLIPHAI_SITE_SIGN_OUT") return;
        auth.signOut().catch(() => {});
      } catch {
        // ignore
      }
    };

    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      unsub();
    };
  }, []);

  const value = useMemo(() => ({ user, loading }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
