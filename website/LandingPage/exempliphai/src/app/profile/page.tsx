"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";
import { getFirebase } from "@/lib/firebase/client";
import schema from "@/config/local_profile_schema.json";

type SchemaField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "array";
  required?: boolean;
  format?: "email" | "date" | string;
  multiline?: boolean;
  item?: { title?: string; fields: SchemaField[] };
};

type SchemaCategory = {
  id: string;
  title: string;
  fields: SchemaField[];
};

function ensureObj(x: any): Record<string, any> {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function validate(p: Record<string, any>): string[] {
  const errs: string[] = [];
  for (const cat of (schema as any).categories as SchemaCategory[]) {
    for (const f of cat.fields || []) {
      if (f.type === "array") continue;
      if (f.required) {
        const v = p?.[f.key];
        if (v == null || String(v).trim() === "") errs.push(`${f.label} is required`);
      }
      if (f.format === "email") {
        const v = String(p?.[f.key] || "").trim();
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
          errs.push(`${f.label} looks invalid`);
      }
      if (f.format === "date") {
        const v = String(p?.[f.key] || "").trim();
        if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v))
          errs.push(`${f.label} should be YYYY-MM-DD`);
      }
    }
  }
  return errs;
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileInner />
    </RequireAuth>
  );
}

function ProfileInner() {
  const { user } = useAuth();

  const [tab, setTab] = useState<"profile" | "education" | "experience" | "raw">(
    "profile",
  );
  const [profile, setProfile] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState<"load" | "save" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const errs = useMemo(() => validate(profile), [profile]);

  const profileCats = useMemo(
    () =>
      ((schema as any).categories as SchemaCategory[]).filter(
        (c) => c.id !== "education" && c.id !== "experience",
      ),
    [],
  );

  const educationArrayField = useMemo(() => {
    const cat = ((schema as any).categories as SchemaCategory[]).find(
      (c) => c.id === "education",
    );
    return cat?.fields?.find((f) => f.type === "array" && f.key === "education");
  }, []);

  const experienceArrayField = useMemo(() => {
    const cat = ((schema as any).categories as SchemaCategory[]).find(
      (c) => c.id === "experience",
    );
    return cat?.fields?.find((f) => f.type === "array" && f.key === "experience");
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  function getArray(key: string): any[] {
    const cur = (profile as any)?.[key];
    return Array.isArray(cur) ? cur : [];
  }

  function setField(field: SchemaField, raw: any) {
    setProfile((prev) => {
      const next = { ...(prev || {}) } as any;
      let v: any = raw;

      if (field.type === "number") {
        v = raw === "" || raw == null ? null : Number(raw);
        if (v != null && !Number.isFinite(v)) v = null;
      }

      if (field.type === "boolean") {
        if (raw === "") v = null;
        else if (raw === true || raw === false) v = raw;
        else v = String(raw) === "true";
      }

      if (v == null || v === "") delete next[field.key];
      else next[field.key] = v;

      return next;
    });
  }

  function addArrayItem(arrayKey: string, itemFields: SchemaField[]) {
    setProfile((prev) => {
      const next = { ...(prev || {}) } as any;
      const arr = getArray(arrayKey).slice();
      const blank: any = {};
      for (const f of itemFields) blank[f.key] = f.type === "boolean" ? false : null;
      arr.push(blank);
      next[arrayKey] = arr;
      return next;
    });
  }

  function removeArrayItem(arrayKey: string, idx: number) {
    setProfile((prev) => {
      const next = { ...(prev || {}) } as any;
      const arr = getArray(arrayKey).slice();
      arr.splice(idx, 1);
      next[arrayKey] = arr;
      return next;
    });
  }

  function updateArrayItemField(
    arrayKey: string,
    idx: number,
    field: SchemaField,
    raw: any,
  ) {
    setProfile((prev) => {
      const next = { ...(prev || {}) } as any;
      const arr = getArray(arrayKey).slice();
      const it = ensureObj(arr[idx]);

      let v: any = raw;
      if (field.type === "number") {
        v = raw === "" || raw == null ? null : Number(raw);
        if (v != null && !Number.isFinite(v)) v = null;
      }
      if (field.type === "boolean") {
        if (raw === "") v = null;
        else if (raw === true || raw === false) v = raw;
        else v = String(raw) === "true";
      }

      if (v == null || v === "") delete (it as any)[field.key];
      else (it as any)[field.key] = v;

      arr[idx] = it;
      next[arrayKey] = arr;
      return next;
    });
  }

  async function load() {
    setBusy("load");
    setErr(null);
    setMsg(null);

    try {
      if (!user) return;
      const { db } = getFirebase();
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) {
        setProfile({});
        setMsg("No profile found yet in Firestore. Fill it out and Save.");
        return;
      }
      const data = snap.data() as any;
      delete data.updatedAt;
      setProfile(ensureObj(data));
      setMsg("Loaded from Firestore.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    setErr(null);
    setMsg(null);

    try {
      if (!user) throw new Error("Not signed in");
      if (errs.length) throw new Error(errs[0]);

      const { db } = getFirebase();
      await setDoc(
        doc(db, "users", user.uid),
        {
          ...profile,
          account: {
            uid: user.uid,
            phoneNumber: user.phoneNumber || null,
          },
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      setMsg("Saved to Firestore.");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="container py-14 md:py-16">
      <div className="mx-auto max-w-5xl rounded-2xl border bg-card p-6 shadow-sm md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <div className="flex gap-3">
            <Link className="text-sm text-primary underline" href={"/account" as any}>
              Account
            </Link>
            <Link className="text-sm text-primary underline" href="/">
              Home
            </Link>
          </div>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">
          Stored in Firestore at <span className="font-mono">users/{user?.uid}</span>.
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
          {errs.length ? (
            <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              Validation: {errs[0]}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Profile sections" className="flex flex-wrap gap-2">
            <button
              role="tab"
              aria-selected={tab === "profile"}
              className={`h-10 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "profile" ? "bg-muted" : "bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("profile")}
              type="button"
            >
              Profile
            </button>
            <button
              role="tab"
              aria-selected={tab === "education"}
              className={`h-10 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "education" ? "bg-muted" : "bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("education")}
              type="button"
            >
              Education
            </button>
            <button
              role="tab"
              aria-selected={tab === "experience"}
              className={`h-10 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "experience" ? "bg-muted" : "bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("experience")}
              type="button"
            >
              Experience
            </button>
            <button
              role="tab"
              aria-selected={tab === "raw"}
              className={`h-10 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                tab === "raw" ? "bg-muted" : "bg-card hover:bg-muted"
              }`}
              onClick={() => setTab("raw")}
              type="button"
            >
              Raw JSON
            </button>
          </div>

          <div className="flex gap-2">
            <button
              className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onClick={load}
              disabled={busy !== null}
              type="button"
            >
              {busy === "load" ? "Loading…" : "Reload"}
            </button>
            <button
              className="bg-gradient-primary h-10 rounded-md px-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
              onClick={save}
              disabled={busy !== null}
              type="button"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="mt-6">
          {tab === "raw" ? (
            <textarea
              className="min-h-[520px] w-full rounded-lg border bg-background p-3 font-mono text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
              spellCheck={false}
              value={JSON.stringify(profile || {}, null, 2)}
              onChange={(e) => {
                try {
                  setProfile(ensureObj(JSON.parse(e.target.value)));
                  setMsg("JSON applied (not saved yet). ");
                  setErr(null);
                } catch (ex: any) {
                  setErr(String(ex?.message || ex));
                }
              }}
            />
          ) : null}

          {tab === "education" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Education</h2>
                <button
                  className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    addArrayItem(
                      "education",
                      (educationArrayField as any)?.item?.fields || [],
                    )
                  }
                  type="button"
                >
                  Add
                </button>
              </div>

              {getArray("education").length === 0 ? (
                <div className="text-sm text-muted-foreground">No items yet.</div>
              ) : null}

              {getArray("education").map((item, idx) => (
                <div key={idx} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">Education #{idx + 1}</div>
                    <button
                      className="h-9 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => removeArrayItem("education", idx)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {((educationArrayField as any)?.item?.fields || []).map(
                      (f: SchemaField) => (
                        <Field
                          key={f.key}
                          field={f}
                          value={(item as any)?.[f.key]}
                          onChange={(v) =>
                            updateArrayItemField("education", idx, f, v)
                          }
                        />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "experience" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Experience</h2>
                <button
                  className="h-10 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() =>
                    addArrayItem(
                      "experience",
                      (experienceArrayField as any)?.item?.fields || [],
                    )
                  }
                  type="button"
                >
                  Add
                </button>
              </div>

              {getArray("experience").length === 0 ? (
                <div className="text-sm text-muted-foreground">No items yet.</div>
              ) : null}

              {getArray("experience").map((item, idx) => (
                <div key={idx} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      Experience #{idx + 1}
                    </div>
                    <button
                      className="h-9 rounded-md border bg-card px-3 text-sm font-semibold transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => removeArrayItem("experience", idx)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {((experienceArrayField as any)?.item?.fields || []).map(
                      (f: SchemaField) => (
                        <Field
                          key={f.key}
                          field={f}
                          value={(item as any)?.[f.key]}
                          onChange={(v) =>
                            updateArrayItemField("experience", idx, f, v)
                          }
                        />
                      ),
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "profile" ? (
            <div className="grid gap-8">
              {profileCats.map((cat) => (
                <div key={cat.id}>
                  <h2 className="text-lg font-semibold">{cat.title}</h2>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    {cat.fields
                      .filter((f) => f.type !== "array")
                      .map((f) => (
                        <Field
                          key={f.key}
                          field={f}
                          value={(profile as any)?.[f.key]}
                          onChange={(v) => setField(f, v)}
                        />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: any;
  onChange: (v: any) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">
        {field.label}
        {field.required ? " *" : ""}
      </span>

      {field.type === "boolean" ? (
        <select
          className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : field.multiline ? (
        <textarea
          className="min-h-24 rounded-md border bg-background px-3 py-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="h-11 rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.format === "date" ? "YYYY-MM-DD" : ""}
          type={field.type === "number" ? "number" : "text"}
        />
      )}
    </label>
  );
}
