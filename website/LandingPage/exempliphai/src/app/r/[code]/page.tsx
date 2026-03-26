import { cookies } from "next/headers";
import { redirect } from "next/navigation";

function isEmu() {
  return String(process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS || "false").toLowerCase() === "true";
}

function getFunctionsBaseUrl(): string {
  const region = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION || "us-central1";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "";

  if (isEmu()) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_HOST || "localhost";
    const port = process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_PORT || "5001";
    // Emulator format: http://localhost:5001/<projectId>/<region>/<functionName>
    return `http://${host}:${port}/${projectId}/${region}`;
  }

  // Deployed format: https://<region>-<projectId>.cloudfunctions.net/<functionName>
  // But firebase v2 uses https://<functionName>-<hash>-<region>.a.run.app in some setups.
  // To keep this simple, allow overriding via env.
  const override = process.env.NEXT_PUBLIC_REFERRAL_FUNCTIONS_BASE_URL;
  if (override) return String(override).replace(/\/+$/, "");

  if (!projectId) return "";
  return `https://${region}-${projectId}.cloudfunctions.net`;
}

export default async function ReferralRedirectPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const cleaned = String(code || "").trim().toUpperCase();

  // Always set the raw code (fallback), but prefer attributionId.
  (await cookies()).set("ref_code", cleaned, {
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    sameSite: "lax",
  });

  const base = getFunctionsBaseUrl();
  if (base) {
    try {
      const url = `${base}/createAttribution?code=${encodeURIComponent(cleaned)}`;
      const resp = await fetch(url, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await resp.json().catch(() => null)) as any;
      if (resp.ok && data?.attributionId) {
        (await cookies()).set("ref_attr", String(data.attributionId), {
          path: "/",
          maxAge: 60 * 60 * 24 * 30,
          sameSite: "lax",
        });
      }
    } catch {
      // ignore
    }
  }

  redirect("/login");
}
