"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RequireAuth } from "@/lib/auth/require-auth";
import { uiText } from "@/lib/utils";
import { createTokenCheckout, getTokenBalance } from "@/lib/tokens/client";

const PACKS = [
  { usd: 1 as const, tokens: 250 },
  { usd: 5 as const, tokens: 1500 },
  { usd: 10 as const, tokens: 3330 },
  { usd: 25 as const, tokens: 8890 },
  { usd: 50 as const, tokens: 19000 },
];

export default function TokensPage() {
  return (
    <RequireAuth>
      <TokensInner />
    </RequireAuth>
  );
}

function TokensInner() {
  const [tokens, setTokens] = useState<number | null>(null);
  const [low, setLow] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyUsd, setBusyUsd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const packs = useMemo(() => PACKS, []);

  const refresh = async () => {
    // Avoid UI flicker: don't blank the number during background refreshes.
    const firstLoad = tokens === null;
    if (firstLoad) setLoading(true);
    else setRefreshing(true);

    setError(null);
    try {
      const b = await getTokenBalance();
      setTokens(b.tokens);
      setLow(b.low);
    } catch (e: any) {
      setError(String(e?.message || e));
      // Keep the last known balance on refresh errors.
      if (firstLoad) {
        setTokens(null);
        setLow(false);
      }
    } finally {
      if (firstLoad) setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
    // Refresh when returning from Stripe.
    const id = window.setInterval(() => void refresh(), 6000);
    return () => window.clearInterval(id);
  }, []);

  const buy = async (usd: 1 | 5 | 10 | 25 | 50) => {
    setBusyUsd(usd);
    setError(null);
    try {
      const { url } = await createTokenCheckout(usd);
      if (!url) throw new Error("missing_checkout_url");
      window.location.href = url;
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyUsd(null);
    }
  };

  return (
    <div className="container py-14 md:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{uiText("Tokens")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {uiText("Tokens are used for AI actions and search. Top up anytime.")}
            </p>
          </div>
          <Link href="/dashboard" className="text-sm text-primary underline">
            {uiText("Back to dashboard")}
          </Link>
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold">{uiText("Current balance")}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight">
            {loading ? "…" : tokens === null ? "—" : tokens.toLocaleString()}
            {refreshing ? <span className="ml-2 text-xs font-normal text-muted-foreground">updating…</span> : null}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {low ? uiText("Low balance") : uiText("Available")}
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border bg-background/40 p-4 text-sm text-muted-foreground">
              {uiText("Error:")} {error}
            </div>
          ) : null}
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold">{uiText("Buy tokens")}</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {uiText("Checkout is handled by Stripe.")}
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {packs.map((p) => (
              <button
                key={p.usd}
                type="button"
                onClick={() => void buy(p.usd)}
                disabled={busyUsd !== null}
                className="group rounded-xl border bg-background/40 p-4 text-left transition hover:bg-muted/30 disabled:opacity-60"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold">${p.usd}</div>
                  <div className="text-sm text-muted-foreground">{uiText("→")}</div>
                </div>
                <div className="mt-1 text-lg font-semibold tracking-tight">
                  {p.tokens.toLocaleString()} {uiText("tokens")}
                </div>
              </button>
            ))}
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            {uiText("Purchases are added to your wallet after Stripe confirms payment.")}
          </p>
        </div>
      </div>
    </div>
  );
}
