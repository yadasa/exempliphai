// gemini_v1beta_smoketest.mjs
//
// Usage:
//   GEMINI_API_KEY="..." node scripts/gemini_v1beta_smoketest.mjs
//
// What it does:
// 1) Lists available v1beta models (best-effort)
// 2) Calls :generateContent on the two "stable" targets used by ExempliphAI
//    - gemini-1.5-flash-latest (quick)
//    - gemini-pro             (deep)
//
// NOTE: Do not commit real API keys. This script reads from env.

const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
if (!API_KEY) {
  console.error('Missing GEMINI_API_KEY env var.');
  console.error('Example: GEMINI_API_KEY="YOUR_KEY" node scripts/gemini_v1beta_smoketest.mjs');
  process.exit(1);
}

const keyPrefix = API_KEY.slice(0, 6);
console.log(`Using GEMINI_API_KEY prefix: ${keyPrefix}…`);

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = { _raw: text };
  }
  return { ok: res.ok, status: res.status, json };
}

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(API_KEY)}`;
  const { ok, status, json } = await fetchJson(url);
  if (!ok || json?.error) {
    console.warn('List models failed:', status, json?.error?.message || json);
    return;
  }

  const models = Array.isArray(json?.models) ? json.models : [];
  console.log(`v1beta models returned: ${models.length}`);
  console.log(
    models
      .map((m) => m?.name)
      .filter(Boolean)
      .slice(0, 50)
      .join('\n')
  );
}

async function generateContent(model, promptText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: promptText }],
      },
    ],
    generationConfig: {
      temperature: 0.0,
    },
  };

  const { ok, status, json } = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!ok || json?.error) {
    throw new Error(`generateContent failed for ${model}: HTTP ${status}: ${json?.error?.message || JSON.stringify(json)}`);
  }

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  const usage = json?.usageMetadata;
  return { text, usage, raw: json };
}

await listModels();

for (const model of ['gemini-1.5-flash-latest', 'gemini-pro']) {
  try {
    const r = await generateContent(model, 'Reply with exactly: OK');
    console.log(`\nModel smoke test OK: ${model}`);
    console.log('Text:', JSON.stringify(r.text || ''));
    if (r.usage) console.log('usageMetadata:', r.usage);
  } catch (e) {
    console.error(`\nModel smoke test FAILED: ${model}`);
    console.error(String(e?.message || e));
  }
}
