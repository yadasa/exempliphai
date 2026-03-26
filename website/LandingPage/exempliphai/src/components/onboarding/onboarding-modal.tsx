"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import DatePicker from "react-datepicker";
import { format as formatDate, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import schema from "@/config/local_profile_schema.json";

type ThemeProfile = Record<string, any>;

type SchemaField = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "array";
  required?: boolean;
  format?: "email" | "date" | string;
  multiline?: boolean;
  options?: string[];
};

type SchemaCategory = {
  id: string;
  title: string;
  fields: SchemaField[];
};

function ensureObj(x: any): Record<string, any> {
  return x && typeof x === "object" && !Array.isArray(x) ? x : {};
}

function getByPath(obj: any, path: string) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as any)[p];
  }
  return cur;
}

function setByPath(obj: any, path: string, value: any) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = (cur as any)[p];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      (cur as any)[p] = {};
    }
    cur = (cur as any)[p];
  }
  (cur as any)[parts[parts.length - 1]] = value;
}

function isValidEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function validateFields(profile: ThemeProfile, fields: SchemaField[]): string[] {
  const errs: string[] = [];
  for (const f of fields) {
    if (f.type === "array") continue;

    const raw = getByPath(profile, f.key);
    const s = raw == null ? "" : String(raw).trim();

    if (f.required && !s) errs.push(`${f.label} is required`);

    if (f.key === "account.displayName" && s && s.length < 2) {
      errs.push("Display name is too short");
    }

    if (f.format === "email" && s && !isValidEmail(s)) {
      errs.push(`${f.label} looks invalid`);
    }

    if (f.format === "date" && s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      errs.push(`${f.label} should be YYYY-MM-DD`);
    }
  }
  return errs;
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: SchemaField;
  value: any;
  onChange: (val: any) => void;
}) {
  const common =
    "w-full rounded-md border bg-background px-3 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring";

  // Prefer explicit dropdowns when schema provides options.
  if (Array.isArray(field.options) && field.options.length) {
    return (
      <label className="grid gap-1">
        <span className="text-sm font-medium">
          {field.label}
          {field.required ? <span className="text-red-400"> *</span> : null}
        </span>
        <select
          className={cn(common, "h-11")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.type === "boolean") {
    const boolVal = value === true;
    return (
      <label className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <span className="text-sm font-medium">{field.label}</span>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={boolVal}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    );
  }

  const label =
    field.key === "location"
      ? "City, State, ZIP"
      : field.key === "birthday"
        ? "Birthday"
        : field.label;

  if (field.format === "date") {
    const v = String(value ?? "").trim();
    const selected = v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseISO(v) : null;
    return (
      <label className="grid gap-1">
        <span className="text-sm font-medium">
          {label}
          {field.required ? <span className="text-red-400"> *</span> : null}
        </span>
        <DatePicker
          selected={selected}
          onChange={(d: Date | null) => {
            if (!d) onChange("");
            else onChange(formatDate(d, "yyyy-MM-dd"));
          }}
          dateFormat="yyyy-MM-dd"
          showMonthDropdown
          showYearDropdown
          dropdownMode="select"
          maxDate={new Date()}
          placeholderText="YYYY-MM-DD"
          className={cn(common, "h-11")}
        />
      </label>
    );
  }

  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">
        {label}
        {field.required ? <span className="text-red-400"> *</span> : null}
      </span>
      {field.multiline ? (
        <textarea
          className={cn(common, "min-h-24 py-2")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={cn(common, "h-11")}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          inputMode={field.type === "number" ? "numeric" : undefined}
          placeholder={
            field.key === "location" ? "Austin, TX 78701" : undefined
          }
        />
      )}
    </label>
  );
}

export function OnboardingModal({
  open,
  onOpenChange,
  initialProfile,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialProfile: ThemeProfile;
  onComplete: (profilePatch: ThemeProfile) => Promise<void>;
}) {
  const categories = useMemo(() => {
    const cats = ((schema as any).categories as SchemaCategory[]) || [];
    // Onboarding: keep it short, match the extension's core autofill needs.
    // Explicitly skip work authorization questions.
    const ids = ["personal", "location"];
    const picked = cats.filter((c) => ids.includes(c.id));

    const base = picked.length ? picked : cats.slice(0, 2);

    // Step 3: require a display name for the website account UI.
    const accountStep: SchemaCategory = {
      id: "account",
      title: "Account",
      fields: [
        {
          key: "account.displayName",
          label: "Display name",
          type: "string",
          required: true,
        },
      ],
    };

    return [...base, accountStep];
  }, []);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<ThemeProfile>(() => ensureObj(initialProfile));

  const cat = categories[step];
  const stepFields = (cat?.fields || []).filter((f) => f.type !== "array");
  const stepErrs = validateFields(draft, stepFields);

  const progress = categories.length
    ? Math.round(((step + 1) / categories.length) * 100)
    : 0;

  async function next() {
    setErr(null);
    if (stepErrs.length) {
      setErr(stepErrs[0]);
      return;
    }
    setStep((s) => Math.min(s + 1, categories.length - 1));
  }

  async function finish() {
    setErr(null);

    // If the user leaves display name blank, generate a reasonable default.
    const ensured = (() => {
      const next = { ...(draft || {}) } as any;
      const curDn = String(getByPath(next, "account.displayName") || "").trim();
      if (curDn) return next;

      const preferred = String(getByPath(next, "preferred_name") || "").trim();
      const first = String(getByPath(next, "first_name") || "").trim();
      const last = String(getByPath(next, "last_name") || "").trim();
      const gen = (preferred || [first, last].filter(Boolean).join(" ")).trim();
      if (gen) setByPath(next, "account.displayName", gen);
      return next;
    })();

    const allErrs = validateFields(
      ensured,
      categories.flatMap((c) => (c.fields || []).filter((f) => f.type !== "array")),
    );
    if (allErrs.length) {
      setErr(allErrs[0]);
      return;
    }

    setBusy(true);
    try {
      await onComplete(ensured);
      onOpenChange(false);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(92vw,720px)] -translate-x-1/2 -translate-y-1/2",
            "rounded-2xl border bg-card shadow-xl",
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                Finish setting up your profile
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                This helps the extension autofill applications accurately.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">{cat?.title || "Onboarding"}</div>
              <div className="text-xs text-muted-foreground">
                Step {step + 1} of {categories.length}
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-violet-500"
                style={{ width: `${progress}%` }}
              />
            </div>

            {err ? (
              <div className="mt-4 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm">
                {err}
              </div>
            ) : null}

            {cat?.id === "account" ? (
              <div className="mt-5 rounded-xl border bg-background/40 p-4 text-sm">
                <div className="font-semibold">Pick a display name</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  This is what you’ll see on your dashboard and account page.
                </div>
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDraft((prev) => {
                        const next = { ...(prev || {}) } as any;
                        const preferred = String(getByPath(next, "preferred_name") || "").trim();
                        const first = String(getByPath(next, "first_name") || "").trim();
                        const last = String(getByPath(next, "last_name") || "").trim();
                        const gen = (preferred || [first, last].filter(Boolean).join(" ")).trim();
                        if (gen) setByPath(next, "account.displayName", gen);
                        return next;
                      });
                    }}
                    disabled={busy}
                  >
                    Use my name
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {stepFields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={getByPath(draft, f.key)}
                  onChange={(val) =>
                    setDraft((prev) => {
                      const next = { ...(prev || {}) } as any;
                      if (f.type === "number") {
                        const n = val === "" || val == null ? null : Number(val);
                        if (n == null || !Number.isFinite(n)) {
                          // don't write invalid numbers
                          return next;
                        }
                        setByPath(next, f.key, n);
                        return next;
                      }
                      if (f.type === "boolean") {
                        setByPath(next, f.key, !!val);
                        return next;
                      }
                      const s = String(val ?? "").trim();
                      if (!s) {
                        setByPath(next, f.key, null);
                      } else {
                        setByPath(next, f.key, s);
                      }
                      return next;
                    })
                  }
                />
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                You can edit everything later in <span className="font-medium">Profile</span>.
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={busy || step === 0}
                >
                  Back
                </Button>
                {step < categories.length - 1 ? (
                  <Button type="button" onClick={next} disabled={busy}>
                    Next
                  </Button>
                ) : (
                  <Button type="button" onClick={finish} disabled={busy}>
                    {busy ? "Saving…" : "Finish"}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
