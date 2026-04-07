# exempliph.ai Login/Auth Hang in One Chrome Profile — Troubleshooting Record (2026-04-07)

Audience: engineer / AI assistant taking over debugging.

Goal: capture **what is broken**, **what is proven working**, **the exact evidence**, **the commits and code paths touched**, and **every remediation attempt** already tried.

This incident spans both the **website** (Next.js app at `website/LandingPage/exempliphai`) and the **Chrome extension** (MV3). The most plausible trigger was an extension “sign out” feature that manipulated Firebase Auth persistence.

---

## 0) Executive summary (what we know for sure)

### 0.1 What works
- In **Incognito** with the extension enabled: login + sign-in/out flows work reliably and quickly.
- In a **fresh Chrome profile**: everything works reliably and quickly.

### 0.2 What fails
- In one specific existing Chrome profile (“broken profile”):
  - Website login frequently hangs ("Sending…" slow, "Verifying…" hangs or times out, later "Loading…" hangs after refresh).
  - After verifying successfully, the site often still behaves as signed-out on reload (`/login` does not redirect to `/dashboard/`).

### 0.3 Key evidence
- In the broken profile, the **Verify request returns 200 OK** and includes an **`idToken`** and `refreshToken`.
  - Therefore **Firebase accepts the code and issues credentials**.
  - The failure is **post-credential**: persistence/rehydration (Auth state), UI navigation, or browser storage behavior.

### 0.4 Most likely root cause
- The extension previously (Apr 6) implemented website sign-out by deleting Firebase Auth persistence storage, including:
  - `indexedDB.deleteDatabase('firebaseLocalStorageDb')`
- Deleting Firebase’s IndexedDB while the SDK is active is known to cause:
  - wedged auth initialization
  - extremely slow/hanging rehydration
  - inconsistent signed-in state across reloads
- Even after removing that behavior, the affected Chrome profile appears to remain in a degraded state.

---

## 1) Observed issues (symptoms) — detailed

### 1.1 Website login UI hangs
In the broken Chrome profile:
- `/login/`:
  - "Send code" can take an unusually long time.
  - After entering SMS code and clicking **Verify**, it can remain stuck on **"Verifying…"** indefinitely (or until our 20s timeout message).
- After attempting login and refreshing:
  - Protected pages show a **"Loading…"** screen for a very long time.

In Incognito/clean profile:
- "Send code" and "Verify" are fast.
- Post-login redirect is immediate.

### 1.2 Website treats user as signed out after “successful” verify (broken profile)
Important distinction reported by user:
- Clean profile:
  - after successful login, visiting `/login/` immediately redirects to `/dashboard/` (session rehydration OK).
- Broken profile:
  - visiting `/login/` does **not** redirect; it behaves as if signed out.

### 1.3 Network proof: verify succeeds even when UI hangs
Broken profile capture (user-provided):

- Request: `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=...`
- Status: `200 OK`
- Response JSON includes `idToken`, `refreshToken`, `localId`, `expiresIn`, `phoneNumber`.

Implication:
- Credential issuance succeeded.
- The failure is at least one of:
  - Firebase persistence write not completing or not readable later
  - Auth SDK rehydration path wedged/slow (on page load)
  - navigation/React state blocked waiting on `onAuthStateChanged`

### 1.4 Correlation with extension sign-out
User reported:
- The bug started immediately after clicking **Sign out** inside the extension.

We later confirmed the extension sign-out was doing destructive deletion of Firebase IndexedDB in the website tab in an earlier commit.

---

## 2) Code-level architecture (relevant pieces)

### 2.1 Website login implementation
- `website/LandingPage/exempliphai/src/app/login/page.tsx`
  - Uses Firebase web SDK phone auth:
    - `RecaptchaVerifier`
    - `signInWithPhoneNumber`
    - `confirmation.confirm(code)`

### 2.2 Website auth state
- `website/LandingPage/exempliphai/src/lib/auth/auth-context.tsx`
  - `onAuthStateChanged(auth, ...)` drives `{ user, loading }`.
  - If `loading` stays true → app shows “Loading…”.

- `website/LandingPage/exempliphai/src/lib/auth/require-auth.tsx`
  - Redirects to `/login` only when `loading === false && user === null`.
  - While `loading===true`, it shows the “Loading…” card.

### 2.3 Extension ↔ website auth bridge
- Extension content script:
  - `src/public/contentScripts/siteAuthBridge.js`
  - Reads website Firebase auth state using:
    - a “shadow” localStorage key written by the website (`EXEMPLIPHAI_FIREBASE_AUTH_SHADOW`)
    - scanning localStorage/sessionStorage firebase keys (`firebase:authUser:...`)
    - and reading IndexedDB `firebaseLocalStorageDb` (`firebaseLocalStorage` store)

### 2.4 Extension sign-out button
- `src/vue_src/components/AccountSyncCard.vue`
  - Sign out action sends a message to website tabs:
    - `chrome.tabs.sendMessage(tabId, { action: 'EXEMPLIPHAI_SITE_SIGN_OUT' })`

---

## 3) Relevant commits (Apr 6 → Apr 7) — with what changed

> Note: This section intentionally includes more detail than a normal changelog.

### 3.1 Apr 6 — extension introduces website sign-out by deleting storage

#### Commit: `2f8c48f` — “Extension: hide Plus-only pills for paid users; sign out website+extension”
Files:
- `src/public/contentScripts/siteAuthBridge.js`
- other extension files (UI plan pill hiding)

Key new behavior:
- Adds support for `EXEMPLIPHAI_SITE_SIGN_OUT`.
- **Original implementation** aggressively cleared website auth persistence:
  - removed shadow key
  - removed Firebase auth keys from localStorage/sessionStorage (`firebase:authUser:*`)
  - **deleted IndexedDB**: `indexedDB.deleteDatabase('firebaseLocalStorageDb')`

Why this matters:
- Firebase Auth persistence for web commonly uses IndexedDB.
- Deleting its database while the SDK is running can wedge the state machine and cause future rehydration to hang.

#### Commit: `2630bc9` — “Extension: require sign-in for feature tabs; clear storage when signed out”
Files:
- `src/vue_src/sw/firebaseSync.ts`

Key behavior:
- Adds `clearSignedOutStorage()` removing many chrome.storage keys when signed out.

Not directly website persistence, but increased cleanup and sign-in gating.

### 3.2 Apr 7 — website/extension attempted fixes & mitigations

#### Commit: `14e7e30` — “Prevent login verify from hanging forever (add timeout + validate code)”
File:
- `website/LandingPage/exempliphai/src/app/login/page.tsx`

Changes:
- Enforce exactly 6 digits before confirm.
- Wrap confirm in a 20s timeout using `Promise.race`.

Purpose:
- Prevent infinite UI hang on “Verifying…”.

#### Commit: `499c7b3` — “Login: hard-navigate to /dashboard/ after successful phone verify”
File:
- `website/LandingPage/exempliphai/src/app/login/page.tsx`

Change:
- After successful verify, do `window.location.assign('/dashboard/')`.

Purpose:
- Avoid Next.js client transition hang on static export + trailingSlash.

#### Commit: `3ffa8b5` — “Fix website login break after extension sign-out (clean signOut via postMessage, no IndexedDB delete)”
Files:
- `src/public/contentScripts/siteAuthBridge.js`
- `website/LandingPage/exempliphai/src/lib/auth/auth-context.tsx`

Changes:
- Removed IndexedDB deletion from `EXEMPLIPHAI_SITE_SIGN_OUT`.
- New flow:
  - content script: `window.postMessage({ source: 'exempliphai-extension', action: 'EXEMPLIPHAI_SITE_SIGN_OUT' }, '*')`
  - website: listens for that postMessage, calls `auth.signOut()`.

Purpose:
- Avoid wedging Firebase by deleting persistence under it.

#### Commit: `5dc48c3` — “Extension: avoid running sign-out logic when already signed out”
File:
- `src/vue_src/components/AccountSyncCard.vue`

Change:
- Sign out button now returns early when `isAuthed` is false.

Purpose:
- Avoid destructive sign-out logic when already signed out.

#### Commit: `6fedafb` — “Auth: fast-path currentUser to avoid slow post-login loading”
File:
- `website/LandingPage/exempliphai/src/lib/auth/auth-context.tsx`

Change:
- On mount, if `auth.currentUser` exists, set `{ user, loading:false }` immediately.

Purpose:
- Reduce time waiting for `onAuthStateChanged` in slow profiles.

#### Commit: `395d8c3` — “Login: await Firebase auth persistence + force token write after phone verify”
File:
- `website/LandingPage/exempliphai/src/app/login/page.tsx`

Changes:
- `await setPersistence(auth, browserLocalPersistence)` best-effort before Send.
- before Verify: best-effort setPersistence again.
- after Verify: `auth.currentUser?.getIdToken(true)` to force token materialization + persistence.

Purpose:
- Attempt to force persistence initialization and durable session creation.

#### Commit: `cc60e2f` — “Docs: login hang in broken Chrome profile troubleshooting record (2026-04-07)”
File:
- This document

---

## 4) Detailed timeline (what happened & what was observed)

> Times approximate; Telegram message IDs are included when available.

### 4.1 Initial report (website)
- User: verify step stuck on “Verifying…” forever.

### 4.2 Confirmed Verify request can succeed
- User provided request payload and response for Verify (working code):
  - Payload had `sessionInfo` + `code`.
  - Response returned `idToken`.

Conclusion:
- Backend accepts code; UI hang is not simply “wrong code”.

### 4.3 User discovered extension sign-out correlation
- User stated bug began immediately after clicking extension **Sign out**.

### 4.4 Incognito vs broken profile
- Incognito with extension enabled: works.
- Broken profile: fails, even after removing extension later.

### 4.5 Further evidence: broken profile treats user as signed out
- Clean profile redirects from `/login` → `/dashboard` immediately.
- Broken profile does not redirect.

Conclusion:
- session rehydration is broken in that profile.

---

## 5) Remediations attempted (exhaustive list)

### 5.1 UX mitigations shipped
- Add 6-digit validation + confirm timeout (`14e7e30`).
- Hard navigation to `/dashboard/` (`499c7b3`).

### 5.2 Extension sign-out safety changes shipped
- Stop deleting `firebaseLocalStorageDb`, use clean signOut via postMessage (`3ffa8b5`).
- Avoid sign-out logic when already signed out (`5dc48c3`).

### 5.3 Website auth rehydration mitigations shipped
- Fast-path `auth.currentUser` on mount (`6fedafb`).
- Explicitly await persistence before send/verify + force token write (`395d8c3`).

### 5.4 Browser/profile troubleshooting attempted
User reported trying (broken profile):
- Disable all extensions → still broken.
- Confirm 3rd-party cookies setting off → still broken.
- Clear site data (various) → still broken.
- Remove extension entirely → still broken.

User confirmed:
- Fresh Chrome profile works.

---

## 6) Current state (as of end of day 2026-04-07)

Broken profile:
- Can receive 200 OK idToken on Verify.
- Yet UI can remain “Loading…” for a long time.
- Visiting `/login` does not redirect (signed out behavior).
- “Send code” step can be very slow.

Clean profile / Incognito:
- Instant send/verify.
- Session rehydrates properly.

---

## 7) Hypotheses to pursue next (for the next AI)

### 7.1 Firebase Auth persistence layer is wedged in the broken profile
Even with our code changes, the broken profile may have a damaged IndexedDB state where:
- reads/writes hang
- transactions retry
- `onAuthStateChanged` callback is delayed

Next evidence to gather:
- DevTools Console logs in broken profile for IndexedDB/storage errors
- Application tab:
  - whether `firebaseLocalStorageDb` exists
  - whether entries are created/updated
- Timing logs inside site:
  - time to `getFirebase()`
  - time until `auth.currentUser` is non-null
  - time until `onAuthStateChanged` fires

### 7.2 Network is being degraded in that profile by non-extension factors
Since disabling extensions didn’t help:
- corporate proxy / AV / DNS / certificate interception at profile-level? (less likely)
- Chrome profile corruption / disk IO issues

Evidence:
- Compare Network waterfall in broken vs clean profile
- Look for long stalls before request is sent or during TLS handshake

### 7.3 The extension sign-out may have left the profile in a permanently-bad storage state
Even after stopping IndexedDB deletion, the original profile could have:
- partially removed Firebase keys
- corrupted IDB metadata

Potential workaround:
- create a “repair mode” page that:
  - uses `indexedDB.databases()` (where available) to inspect
  - offers targeted cleanup instructions

---

## 8) Appendix: audit commands used

- Full list since Apr 6:
  - `git log --since="2026-04-06 00:00" --oneline`

- Website login/auth touched since Apr 6:
  - `git log --since="2026-04-06 00:00" --oneline -- website/LandingPage/exempliphai/src/app/login website/LandingPage/exempliphai/src/lib/auth website/LandingPage/exempliphai/next.config.js`

- Find the site sign-out bridge references:
  - `grep -RIn "EXEMPLIPHAI_SITE_SIGN_OUT" src | head`
