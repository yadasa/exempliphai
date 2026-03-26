# Exempliphai Cloud Functions

Referral v2 functions live in `index.js`.

## Local emulators

From repo root:

```bash
# Install deps
cd exempliphai/functions
npm i

# Back to repo root
cd ../..

# Start emulators (requires Java for Firestore emulator)
firebase emulators:start --only auth,firestore,functions --project openclaw-test
```

## Deploy

### Option A: deploy from `exempliphai/` (recommended on Windows)

This repo includes a `exempliphai/firebase.json` with:

- `functions.source = "functions"`
- Firestore rules + indexes in `exempliphai/firestore.rules` and `exempliphai/firestore.indexes.json`

```bash
cd exempliphai

# If firebase-tools isn't installed globally, use npx:
npx firebase deploy --only functions,firestore:rules,firestore:indexes --project <your-project-id>
```

### Option B: deploy from workspace repo root

The workspace root `firebase.json` points Functions source at `exempliphai/functions`.

```bash
# From workspace repo root
firebase deploy --only functions,firestore:rules,firestore:indexes --project <your-project-id>
```

### Windows PowerShell note (common failure)

If your `firebase.json` contains a Functions `predeploy` hook like:

```json
"predeploy": ["npm --prefix %RESOURCE_DIR% run lint"]
```

That works in **cmd.exe** but **not** in PowerShell.
Fix by either removing the hook or changing it to a cross-platform form (recommended):

```json
"predeploy": ["npm --prefix \"$RESOURCE_DIR\" run lint"]
```

Or in PowerShell specifically:

```powershell
npm --prefix $env:RESOURCE_DIR run lint
```

## Endpoints

- Callable:
  - `getOrCreateReferralCode`
  - `applyAttribution`
  - `listMyReferrals`
- HTTPS:
  - `createAttribution?code=XXXX`

Emulator base URL format:

`http://localhost:5001/<projectId>/us-central1/<functionName>`

Example:

`http://localhost:5001/openclaw-test/us-central1/createAttribution?code=ABCD1234`

## Website (Next.js) Firebase env vars (login / SMS)

The website login page uses Firebase Phone Auth (reCAPTCHA + `signInWithPhoneNumber`).

If the `NEXT_PUBLIC_FIREBASE_*` env vars are missing in the Next.js deployment/build,
Firebase will not initialize and login will show a friendly error instead of crashing.

Required:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Optional (emulators):

- `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true`
- `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL` (default `http://localhost:9099`)
- `NEXT_PUBLIC_FIREBASE_FIRESTORE_EMULATOR_HOST` / `_PORT`
- `NEXT_PUBLIC_FIREBASE_FUNCTIONS_EMULATOR_HOST` / `_PORT`
