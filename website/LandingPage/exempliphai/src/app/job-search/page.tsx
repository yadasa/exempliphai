"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import { AccountNavCards } from "@/components/AccountNavCards";
import {
  canonUrlKey,
  jobFieldsDocRef,
  type JobFieldsDoc,
} from "@/lib/exempliphai/firestore";
import {
  filterDirectApplicationLinks,
  type JobLink,
} from "@/lib/exempliphai/jobLinks";

type JobRec = {
  title: string;
  company?: string;
  location?: string;
  salary?: string;
  why_match?: string;
  links?: JobLink[];
};

export default function JobSearchPage() {
  return (
    <RequireAuth>
      <JobSearchInner />
    </RequireAuth>
  );
}

function JobSearchInner() {
  const { user } = useAuth();

  const [jobFields, setJobFields] = useState<JobFieldsDoc | null>(null);
  const [searchDocs, setSearchDocs] = useState<Array<{ id: string; data: any }>>([]);
  const [activeId, setActiveId] = useState<string>("");

  const active = useMemo(() => {
    const found = searchDocs.find((d) => d.id === activeId);
    return found || searchDocs[0] || null;
  }, [searchDocs, activeId]);

  const recs: JobRec[] = useMemo(() => {
    const data = active?.data || {};
    const arr = Array.isArray(data.generatedJobs) ? data.generatedJobs : [];
    return arr
      .filter((r: any) => r && typeof r.title === "string" && r.title.trim())
      .slice(0, 15)
      .map((r: any) => ({
        title: String(r.title).trim(),
        company: r.company ? String(r.company).trim() : "",
        location: r.location ? String(r.location).trim() : "",
        salary: r.salary ? String(r.salary).trim() : "",
        why_match: r.why_match ? String(r.why_match).trim() : "",
        links: filterDirectApplicationLinks(r.links).slice(0, 4),
      }));
  }, [active]);

  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const unsub = onSnapshot(jobFieldsDocRef(db, user.uid), (snap) => {
      if (!snap.exists()) return;
      setJobFields(snap.data() as any);
    });

    return () => {
      unsub();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const q = query(
      collection(db, "users", user.uid, "jobSearches"),
      orderBy("timestamp", "desc"),
      limit(25),
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, data: d.data() as any }));
      setSearchDocs(next);
      if (!activeId && next[0]?.id) setActiveId(next[0].id);
    });

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();

    const q = query(
      collection(db, "users", user.uid, "appliedJobs"),
      orderBy("timestamp", "desc"),
      limit(500),
    );

    const unsub = onSnapshot(q, (snap) => {
      const next = new Set<string>();
      for (const d of snap.docs) {
        const data = d.data() as any;
        const url = String(data?.url || "");
        const k = canonUrlKey(url);
        if (k) next.add(k);
      }
      setAppliedKeys(next);
    });

    return () => unsub();
  }, [user?.uid]);

  return (
    <div className="container py-14 md:py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-70"
        style={{
          background:
            "radial-gradient(900px 520px at 20% 10%, color-mix(in oklab, var(--color-primary) 24%, transparent), transparent 62%), radial-gradient(900px 520px at 80% 15%, color-mix(in oklab, var(--brand-violet) 22%, transparent), transparent 58%)",
        }}
      />

      <div className="mx-auto max-w-5xl">
        <AccountNavCards className="mb-6" />

        <div className="rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Job Search</h1>
            <div className="flex gap-3">
              <Link className="text-sm text-primary underline" href={"/profile" as any}>
                Profile
              </Link>
              <Link className="text-sm text-primary underline" href={"/dashboard" as any}>
                Dashboard
              </Link>
            </div>
          </div>

          <div className="mt-6 rounded-xl border bg-card p-4">
            <div className="text-sm font-semibold">Coming soon to web</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Job Search is already implemented in the Chrome extension.
            </div>
            <div className="mt-2 text-sm text-muted-foreground">
              We’ll bring it to the web dashboard soon.
            </div>
          </div>

          <div className="mt-6 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">History</div>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm outline-none"
                value={active?.id || ""}
                onChange={(e) => setActiveId(e.target.value)}
              >
                {searchDocs.length ? (
                  searchDocs.map((d) => {
                    const ts = (d.data as any)?.timestamp?.toDate?.()?.toISOString?.() || null;
                    const genAt = String((d.data as any)?.generated_at || "");
                    const label = ts
                      ? new Date(ts).toLocaleString()
                      : genAt
                        ? new Date(genAt).toLocaleString()
                        : d.id;
                    return (
                      <option key={d.id} value={d.id}>
                        {label}
                      </option>
                    );
                  })
                ) : (
                  <option value="">No searches yet</option>
                )}
              </select>
            </div>

            {recs.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground">No recommendations yet.</div>
            ) : (
              <div className="mt-4 text-sm text-muted-foreground">
                You have recommendations saved from the extension.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
