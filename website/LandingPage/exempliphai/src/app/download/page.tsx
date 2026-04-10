import Link from "next/link";

export default function DownloadPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Install the ExempliPhai Extension (Unpacked)</h1>
        <p className="mt-3 text-muted-foreground">
          These steps let you install the extension from the <code className="rounded bg-muted px-1.5 py-0.5">dist</code>{" "}
          folder in Chrome.
        </p>
      </header>

      <section className="space-y-8">
        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">1) Download the build</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>
              Download the extension build as a ZIP.
              <div className="mt-2 rounded-lg bg-muted p-3 text-sm">
                You should end up with a folder named <strong>dist</strong> (not a file).
              </div>
            </li>
            <li>Unzip it somewhere you can keep it (for example: Desktop or Documents).</li>
            <li>
              Confirm the folder contains a <code className="rounded bg-muted px-1.5 py-0.5">manifest.json</code> file.
            </li>
          </ol>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">2) Enable Developer Mode</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>
              Open Chrome and go to:{" "}
              <a className="underline" href="chrome://extensions" rel="noreferrer">
                chrome://extensions
              </a>
            </li>
            <li>Toggle <strong>Developer mode</strong> on (top right).</li>
          </ol>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">3) Load the unpacked extension</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-6">
            <li>Click <strong>Load unpacked</strong>.</li>
            <li>Select the <strong>dist</strong> folder you unzipped (the one containing <code className="rounded bg-muted px-1.5 py-0.5">manifest.json</code>).</li>
            <li>The extension should appear in your extensions list immediately.</li>
          </ol>
        </div>

        <div className="rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Troubleshooting</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6">
            <li>
              If you see an error about <strong>manifest</strong>, make sure you selected the folder that contains
              <code className="mx-1 rounded bg-muted px-1.5 py-0.5">manifest.json</code>.
            </li>
            <li>
              If the extension disappears after restarting Chrome, ensure the <strong>dist</strong> folder hasn’t been moved or deleted.
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
  );
}

