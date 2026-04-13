"use client";

import Link from "next/link";
import Image from "next/image";

import { RequireAuth } from "@/lib/auth/require-auth";

import ins1 from "@/assets/ins-1.jpg";
import ins2 from "@/assets/ins-2.jpg";
import ins3 from "@/assets/ins-3.jpg";
import ins4 from "@/assets/ins-4.jpg";

export default function DownloadPage() {
  return (
    <RequireAuth>
      <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <div className="mb-6 rounded-xl border border-amber-200/60 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
        <strong>Note:</strong> The app is still pending Google Play Store approval, but the steps below let you get early access.
      </div>
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Install the ExempliPhai Extension (Unpacked)</h1>
        <p className="mt-3 text-muted-foreground">
          These steps help you add the extension to Chrome in about a minute.
        </p>
      </header>

      <section className="space-y-8">
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">1) Download the build</h2>

          <a
            className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-[#a78bfa] px-4 py-3 text-sm font-extrabold text-white shadow-[0_18px_35px_rgba(167,139,250,0.28)] transition hover:brightness-[1.02]"
            href="https://exempliph.ai/downloads/exempliph.ai.zip"
            target="_blank"
            rel="noreferrer"
          >
            Download here
          </a>

          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>
              Download the extension build as a ZIP.
              <div className="mt-2 rounded-lg bg-muted p-3 text-sm">
                After unzipping, you should have a folder named <strong>exempliph.ai</strong>.
              </div>
            </li>
            <li>Unzip it somewhere you can keep it (for example: Desktop or Documents).</li>
          </ol>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">2) Enable Developer Mode</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>
              Open Chrome and go to:{" "}
              <a className="underline" href="chrome://extensions" target="_self" rel="noreferrer">
                chrome://extensions
              </a>
            </li>
            <li>Toggle <strong>Developer mode</strong> on (top right).</li>
          </ol>

          <div className="mt-4 overflow-hidden rounded-xl border bg-muted">
            <Image src={ins1} alt="Enable Developer mode in Chrome extensions" className="h-auto w-full" priority />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">3) Load the unpacked extension</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>Click <strong>Load unpacked</strong>.</li>
            <li>Select the <strong>exempliph.ai</strong> folder you just unzipped.</li>
            <li>The extension should appear in your extensions list immediately.</li>
          </ol>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="overflow-hidden rounded-xl border bg-muted">
              <Image src={ins2} alt="Load unpacked button" className="h-auto w-full" />
            </div>
            <div className="overflow-hidden rounded-xl border bg-muted">
              <Image src={ins3} alt="Select the exempliph.ai folder" className="h-auto w-full" />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">4) Pin it (recommended)</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>Click the puzzle-piece icon (Extensions) in the top right of Chrome.</li>
            <li>Find <strong>ExempliPhai</strong> and click the pin icon.</li>
          </ol>

          <div className="mt-4 overflow-hidden rounded-xl border bg-muted">
            <Image src={ins4} alt="Pin the ExempliPhai extension" className="h-auto w-full" />
          </div>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">5) Log in to start</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>
              Go to{" "}
              <a className="underline" href="https://exempliph.ai" target="_blank" rel="noreferrer">
                exempliph.ai
              </a>
              {" "}and log in.
            </li>
            <li>Once you’re logged in, the extension will be ready to use.</li>
          </ol>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Troubleshooting</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6">
            <li>
              If the extension disappears after restarting Chrome, make sure the <strong>exempliph.ai</strong> folder hasn’t been moved or deleted.
            </li>
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Link className="underline" href="/">
            Back to home
          </Link>
        </div>
      </section>
      </main>
    </RequireAuth>
  );
}
