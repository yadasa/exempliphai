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

Run deploys from the **repo root** (the directory that contains the top-level `firebase.json`).
That `firebase.json` points Functions source at `exempliphai/functions`.

```bash
# From repo root
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
