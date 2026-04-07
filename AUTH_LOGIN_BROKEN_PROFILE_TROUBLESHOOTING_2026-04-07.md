# exempliph.ai Login/Auth Hang in One Chrome Profile — Troubleshooting Record (2026-04-07)

This document is intended to hand off to another AI / engineer. It captures:

1) The **observed issues** (what fails, what works)
2) The **relevant commits** (Apr 6 onward) and what they changed
3) **Everything we tried** and what we learned from each step

---

## 1) Observed issues (symptoms)

### 1.1 Primary symptom
In a specific ("broken") Chrome profile:

- The website login flow (`/login/`) is unreliable/slow.
- The UI often gets stuck on **"Verifying…"** (or hits our custom timeout message), and/or after refresh is stuck on **"Loading…"** (RequireAuth loading state).
- Even after a successful phone verification, revisiting `/login/` **does not redirect** to `/dashboard/` (i.e., the site treats the user as signed out).

In Incognito mode and/or a clean/new Chrome profile:

- Phone login is **instant**.
- After logging in, visiting `/login/` **immediately redirects** to `/dashboard/` (session rehydrates correctly).

### 1.2 Network evidence: verify succeeds, app still behaves signed-out
From the broken profile, the Verify request returns **200 OK** with an **`idToken`**:

- Endpoint: `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?...`
- Response includes: `idToken`, `refreshToken`, `localId`, `expiresIn`, etc.

This indicates:

- Firebase Auth is accepting the code and issuing credentials.
- The failure is **after** the credential is issued: either navigation/UI state gets stuck, and/or **auth persistence / session rehydration fails** in the broken profile.

### 1.3 Additional symptom (important)
Later in the session, in the broken profile:

- Even the **“Send code”** step can take an unusually long time.
- Incognito/clean profile sends quickly.

That suggests the broken profile is experiencing a broader issue impacting the Firebase Auth flow (storage/persistence, network interception, corruption, etc.), not just client routing.

---

## 2) Related commits (Apr 6 → Apr 7) and what changed

This list focuses on commits that plausibly affect website auth, extension ↔ website auth bridge, and login UX.

### 2.1 Extension sign-out bridge (Apr 6)

#### `2f8c48f` — Extension: hide Plus-only pills for paid users; sign out website+extension
Key change:
- Added a website sign-out action handled by the extension content script:
  - `src/public/contentScripts/siteAuthBridge.js`
  - New message action: `EXEMPLIPHAI_SITE_SIGN_OUT`

Original behavior (as implemented in this commit):
- On `EXEMPLIPHAI_SITE_SIGN_OUT`, it attempted to sign the website out by *directly deleting site persistence*, including:
  - Removing Firebase auth keys from localStorage/sessionStorage
  - Deleting IndexedDB database: `firebaseLocalStorageDb`

Rationale at the time:
- Prevent the extension from immediately re-authing by reading the website session.

Risk:
- Deleting Firebase Auth’s IndexedDB persistence while the Firebase SDK is running can wedge Firebase Auth initialization/persistence in that profile.

#### `2630bc9` — Extension: require sign-in for feature tabs; clear storage when signed out
Key change:
- Added aggressive clearing of extension storage when signed out:
  - `clearSignedOutStorage()` in `src/vue_src/sw/firebaseSync.ts`

This commit does not directly modify website Firebase persistence, but it increases "signed-out cleanup" behavior and changes auth gating.

### 2.2 Website UI fix (Apr 7)

#### `c368065` — Fix hero headline clipping by increasing line-height
Unrelated to auth.

### 2.3 Website login UX hardening (Apr 7)

#### `14e7e30` — Prevent login verify from hanging forever (add timeout + validate code)
File: `website/LandingPage/exempliphai/src/app/login/page.tsx`
Changes:
- Validates code is 6 digits before confirm.
- Wraps `confirmation.confirm(code)` in a 20s timeout to prevent infinite "Verifying…".

This is UX hardening only; does not address the underlying persistence issue.

#### `499c7b3` — Login: hard-navigate to /dashboard/ after successful phone verify
File: `website/LandingPage/exempliphai/src/app/login/page.tsx`
Changes:
- After successful verify, uses `window.location.assign("/dashboard/")` to bypass Next router transitions.

Goal:
- Avoid hangs caused by client-side navigation on static-export/trailingSlash deployments.

### 2.4 Fix: stop deleting Firebase IndexedDB; sign out cleanly (Apr 7)

#### `3ffa8b5` — Fix website login break after extension sign-out (clean signOut via postMessage, no IndexedDB delete)
Files:
- `src/public/contentScripts/siteAuthBridge.js`
- `website/LandingPage/exempliphai/src/lib/auth/auth-context.tsx`

Changes:
- **Removed** IndexedDB deletion (`indexedDB.deleteDatabase('firebaseLocalStorageDb')`) from the extension sign-out path.
- Replaced with a clean sign-out request to the site via `window.postMessage(...)`.
- Website `AuthProvider` listens for that postMessage and calls `auth.signOut()`.

Goal:
- Prevent Firebase persistence corruption/wedging.

### 2.5 Extension: sign-out button should do nothing if already signed out (Apr 7)

#### `5dc48c3` — Extension: avoid running sign-out logic when already signed out
File: `src/vue_src/components/AccountSyncCard.vue`
Change:
- If `isAuthed` is false, return early from sign-out.

Goal:
- Avoid unnecessary/destructive sign-out logic when no extension auth is present.

### 2.6 Website: attempt to reduce slow loading by fast-pathing currentUser (Apr 7)

#### `6fedafb` — Auth: fast-path currentUser to avoid slow post-login loading
File: `website/LandingPage/exempliphai/src/lib/auth/auth-context.tsx`
Change:
- On mount, if `auth.currentUser` exists, immediately set `user` and set `loading=false`.

Goal:
- Avoid being blocked waiting for `onAuthStateChanged` in slow/buggy profiles.

### 2.7 Website login: attempt to force persistence + token write (Apr 7)

#### `395d8c3` — Login: await Firebase auth persistence + force token write after phone verify
File: `website/LandingPage/exempliphai/src/app/login/page.tsx`
Changes:
- Imports `setPersistence` + `browserLocalPersistence`.
- On Send code: `await setPersistence(auth, browserLocalPersistence)` best-effort.
- On Verify: best-effort setPersistence; after confirm, forces `auth.currentUser?.getIdToken(true)`.

Goal:
- Ensure persistence is initialized before auth flow and force persistence write after verify.

Outcome:
- Did not fix the broken-profile behavior.

---

## 3) Everything tried so far (chronological)

### 3.1 Initial report
- Website login: after entering 6-digit code and clicking Verify, UI stuck on "Verifying…" forever.

### 3.2 First mitigation
- Added timeout and stricter code validation (`14e7e30`).

### 3.3 Found critical clue: verify network request succeeds
- The Verify request returns `idToken`/`refreshToken` (200 OK).
- Therefore Firebase accepts the code and issues credentials.

### 3.4 Hypothesis: stuck due to navigation (static export / trailing slash)
- Added `window.location.assign("/dashboard/")` after verify (`499c7b3`).

Result:
- Did not fix in the failing scenario.

### 3.5 Found strong correlation with extension sign-out button
- User report: after clicking **Sign out** in the extension, the website login bug started immediately.

### 3.6 Fix extension sign-out implementation
- Identified that extension sign-out was deleting Firebase IndexedDB: `firebaseLocalStorageDb`.
- Implemented clean sign-out via postMessage + `auth.signOut()` and removed IndexedDB deletion (`3ffa8b5`).

### 3.7 New failure mode
- After extension sign-in/out changes, user reported:
  - Clicking Sign in in extension, completing site login → extension becomes signed in, but website still stuck.

### 3.8 Incognito vs normal profile
- Incognito mode (with extension enabled) works fine.

This indicated the issue might be corrupted state in the normal profile.

### 3.9 Attempted profile/site cleanup
User attempted (normal profile):
- Disabled extensions.
- Verified 3rd-party cookies setting was off.
- Cleared site data.

Result:
- Still broken.

### 3.10 Clean Chrome profile test
- Fresh Chrome profile works fine.

Conclusion:
- The issue is profile-specific.

### 3.11 Extension fix: do not run sign-out logic if not signed in
- Implemented early return in extension sign-out (`5dc48c3`).

### 3.12 Further evidence: verify returns idToken in broken profile, but UI stuck on Loading
- In broken profile, Verify returns 200 OK with idToken.
- After refresh or visiting `/login`, app often shows **"Loading…"** for a long time.

Interpretation:
- Auth persistence/rehydration is failing or extremely slow.

### 3.13 Website attempted mitigations
- `6fedafb`: If `auth.currentUser` exists, set auth state immediately.
- `395d8c3`: Await persistence set-up in login flow + force token write.

Result:
- Still "forever" loading in the broken profile.

### 3.14 Latest status (as of 2026-04-07 09:50 EDT)
- Broken profile:
  - Sending code can be very slow.
  - Verify returns 200 OK idToken, but UI remains stuck / slow.
  - Visiting `/login` after login does not redirect (session not rehydrated).
- Incognito and clean profile:
  - Instant.

---

## 4) High-confidence conclusions

1) Firebase verify is successful (idToken returned). The failure is **client-side persistence/rehydration/UI state**.
2) The issue is **Chrome-profile-specific**.
3) The extension sign-out implementation (Apr 6) likely triggered/created the bad state by deleting Firebase IndexedDB during runtime.
4) Even after removing that behavior, the affected profile appears to remain in a degraded state.

---

## 5) Open questions / next troubleshooting directions

To diagnose at the browser level in the broken profile, gather:

- DevTools Console errors/warnings related to:
  - IndexedDB (`firebaseLocalStorageDb`)
  - Quota/IO errors
  - Storage access
  - `SecurityError`, `UnknownError`, `QuotaExceededError`, etc.

- DevTools Application → IndexedDB:
  - Does `firebaseLocalStorageDb` exist after login?
  - Are entries written?

- Compare in broken profile vs clean profile:
  - `localStorage` keys beginning with `firebase:`
  - Whether Firebase persistence is actually localStorage vs IndexedDB

Potential remediations:
- Add a user-visible "Auth is stuck" panel after N seconds with:
  - a controlled `auth.signOut()` + reload
  - a link to `chrome://settings/siteData?searchSubpage=exempliph.ai`
  - guidance for clearing site storage

---

## 6) Appendix: commands used to audit commits

- Full list since Apr 6:
  - `git log --since="2026-04-06 00:00" --oneline`

- Website login/auth touched since Apr 6:
  - `git log --since="2026-04-06 00:00" --oneline -- website/LandingPage/exempliphai/src/app/login website/LandingPage/exempliphai/src/lib/auth website/LandingPage/exempliphai/next.config.js`

- Find the site sign-out bridge references:
  - `grep -RIn "EXEMPLIPHAI_SITE_SIGN_OUT" src | head`

