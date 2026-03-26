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
