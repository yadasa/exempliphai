// Extract a minimized ATS selector/ruleset from Simplify Copilot's remoteConfig.json
// Usage: node scripts/extract-simplify-ats.js ../sC/2.3.5_0/remoteConfig.json src/private_config/config/simplify_ats.json

const fs = require('fs');
const path = require('path');

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('Usage: node extract-simplify-ats.js <remoteConfig.json> <out.json>');
  process.exit(1);
}

const rc = JSON.parse(fs.readFileSync(inPath, 'utf8'));
if (!rc.ATS || typeof rc.ATS !== 'object') {
  throw new Error('remoteConfig.json missing ATS object');
}

// Keep only what exempliphai can use: URL patterns + selectors/paths for finding inputs and submit buttons.
const KEEP_KEYS = new Set([
  'urls',
  'urlsExcluded',
  'embeddedPaths',
  'pathsExcluded',
  'containerPath',
  'containerRequired',
  'inputSelectors',
  'trackedInputSelectors',
  'submitButtonPaths',
  'continueButtonPaths',
  'proxySubmitButtons',
  'submittedSuccessPaths',
  'defaultMethod',
  'defaultTrackMethod',
  'defaultEventOptions',
  'fillInputInterval',
  'fillInputGroupInterval',
  'warningMessage',
  'helpMessageUrls',
  // sourceKeys/cookies are tracking-related; keep optional for future import mapping.
  'sourceKeys',
  'sourceCookies',
  'trackedObjExtractors',
]);

const out = {
  meta: {
    source: 'Simplify Copilot remoteConfig.json (ATS subset)',
    extractedAt: new Date().toISOString(),
    atsCount: Object.keys(rc.ATS).length,
  },
  ATS: {},
};

for (const [atsKey, cfg] of Object.entries(rc.ATS)) {
  if (!cfg || typeof cfg !== 'object') continue;
  const cleaned = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (KEEP_KEYS.has(k)) cleaned[k] = v;
  }
  out.ATS[atsKey] = cleaned;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath, 'ATS keys:', Object.keys(out.ATS).length);
