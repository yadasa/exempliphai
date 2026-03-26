# UI Fixes Plan (Web)

> Scope: **ExempliphAI Next.js app** (primarily `website/LandingPage/exempliphai`).
>
> Goals (from request):
> 1) **Dark mode by default** (Next.js theme provider) with persistence via **localStorage and/or cookie**.
> 2) **Persistent homepage navbar/header on all pages** via shared `app/layout.tsx` (or a shared layout wrapper).
> 3) **Post-signin dashboard** (`/dashboard` as the default redirect) with navigation cards:
>    - `/account`, `/profile`, `/referrals`
>    - `/resume-tailoring` (empty stub)
>    - `/job-search` (empty stub)
>    - highlighted **Upgrade** box with a gradient button (same visual language as “waitlist”), linking to `/upgrade` (paid plans page stub).
>
> This document is **plan-only**. Implementation should wait for explicit approval.

---

## 0) Inventory & Key Files

### Next.js app (App Router)
- Root layout: `website/LandingPage/exempliphai/src/app/layout.tsx`
- Login: `website/LandingPage/exempliphai/src/app/login/page.tsx`
- Account: `website/LandingPage/exempliphai/src/app/account/page.tsx`
- Profile: `website/LandingPage/exempliphai/src/app/profile/page.tsx`
- Referrals: (likely within Account tabs) `website/LandingPage/exempliphai/src/app/account/page.tsx`
- Auth guard / auth helpers (if present): `website/LandingPage/exempliphai/src/lib/auth/*`

### New pages to add
- Dashboard: `website/LandingPage/exempliphai/src/app/dashboard/page.tsx`
- Resume tailoring stub: `website/LandingPage/exempliphai/src/app/resume-tailoring/page.tsx`
- Job search stub: `website/LandingPage/exempliphai/src/app/job-search/page.tsx`
- Upgrade stub: `website/LandingPage/exempliphai/src/app/upgrade/page.tsx`

### Theme / UI scaffolding (expected)
- Shared UI components: `website/LandingPage/exempliphai/src/components/*`
- Tailwind config: `website/LandingPage/exempliphai/tailwind.config.*`
- Global styles: `website/LandingPage/exempliphai/src/app/globals.css`

---

## 1) Dark Mode Default + Persistence

### Desired behavior
- Default theme is **dark** for first-time visitors.
- Theme choice persists across sessions.
- Theme can be controlled without a “flash” (avoid light → dark flicker on first paint).

### Recommended approach (Next.js App Router)
1. Add `next-themes` (or equivalent) and wrap the app with a `ThemeProvider` in `src/app/layout.tsx`.
2. Set:
   - `defaultTheme="dark"`
   - `enableSystem={false}` (unless system preference should override)
   - `attribute="class"` (Tailwind dark mode via `class`)
3. Persist via `next-themes` storage key (localStorage by default).
4. Optional (better first paint / SSR alignment): also mirror theme to a cookie so middleware/server can render correct theme immediately.

### Persistence options
- **Option A (simplest):** localStorage only (via `next-themes`).
  - Pro: minimal.
  - Con: can still have a brief mismatch if SSR assumes light.

- **Option B (recommended):** localStorage + cookie.
  - On theme change: write cookie `theme=dark|light`.
  - In layout or middleware: read cookie to set the initial class.
  - Goal: eliminate theme flicker and keep consistent across SSR/CSR.

### Acceptance criteria
- First visit renders dark UI.
- Refresh keeps last-selected theme.
- No visible flash from light → dark on load.

---

## 2) Persistent Navbar/Header on All Pages

### Desired behavior
- The homepage navbar/header is present across all pages (marketing + app pages), unless explicitly excluded.
- Navigation does not re-implement per page.

### Recommended structure
- Move the header/nav component into a shared layout level:
  - `src/app/layout.tsx` (global) OR
  - `src/app/(site)/layout.tsx` for all public+app routes (preferred if there are pages that must be minimal)

Suggested route groups (if needed):
- `src/app/(site)/...` includes header
- `src/app/(auth)/login/...` optionally minimal/no header

### Implementation notes
- Extract the existing homepage header into `src/components/site/SiteHeader.tsx`.
- Ensure header styles support both:
  - landing pages
  - authenticated pages (Dashboard/Account/Profile)

### Acceptance criteria
- Header appears on `/`, `/dashboard`, `/account`, `/profile`, `/referrals` views.
- Header links work and reflect auth state if applicable.

---

## 3) Post-signin Dashboard + Default Redirect

### Desired behavior
- After successful login, user lands on **`/dashboard`** (default redirect).
- `/dashboard` shows a grid of cards/links:
  - **Account** → `/account`
  - **Profile** → `/profile`
  - **Referrals** → `/referrals` (or `/account?tab=referrals` depending on current routing)
  - **Resume Tailoring** → `/resume-tailoring` (stub)
  - **Job Search** → `/job-search` (stub)
- A highlighted **Upgrade** callout/box:
  - visually emphasized
  - gradient button similar to the waitlist CTA
  - button links to `/upgrade`

### Routing decisions to confirm (plan-level)
- If referrals is currently implemented as an Account tab, we can support a dedicated route:
  - either add `/referrals` page that renders the same component
  - or link to `/account?tab=referrals` and keep `/referrals` as a redirect.

### Dashboard UI spec (lightweight)
- Card layout:
  - responsive grid (1 col mobile, 2–3 cols desktop)
  - each card: icon, title, short description, arrow/CTA
- Upgrade highlight:
  - distinct background (subtle gradient + border glow)
  - gradient button (reuse existing button component if present)

### Add stub pages
- `/resume-tailoring`:
  - simple placeholder: “Coming soon” + brief description.
- `/job-search`:
  - simple placeholder: “Coming soon”.
- `/upgrade`:
  - placeholder pricing/plans stub (paid plans forthcoming).

### Acceptance criteria
- Signing in routes to `/dashboard`.
- `/dashboard` renders cards with working links.
- Upgrade box is clearly highlighted; button style matches existing gradient CTA.

---

## 4) Implementation Order (revised)

1. **Persistent header/layout plumbing**
   - Extract header component
   - Add to shared `app/layout.tsx` or `app/(site)/layout.tsx`

2. **Theme provider + dark default + persistence**
   - Add `ThemeProvider` + dark default
   - Ensure Tailwind dark mode works consistently
   - Add cookie mirroring if needed to remove flicker

3. **Dashboard + stubs**
   - Add `/dashboard` page and card grid
   - Add `/resume-tailoring`, `/job-search`, `/upgrade` stubs
   - Implement highlighted Upgrade callout

4. **Auth redirect update**
   - Update post-login redirect to `/dashboard`
   - Ensure unauthenticated access to `/dashboard` is guarded/redirected to `/login`

---

## 5) Testing Checklist

- Theme:
  - first-time visit defaults to dark
  - theme persists after refresh
  - no flash/flicker on first render

- Header:
  - header visible on all intended routes
  - nav links correct

- Dashboard:
  - after login lands on `/dashboard`
  - cards link to correct routes
  - Upgrade callout present + gradient button styling correct

- Stubs:
  - `/resume-tailoring`, `/job-search`, `/upgrade` load without errors

---

## 6) Definition of Done

- Dark mode is default and persists (localStorage and/or cookie; no flicker).
- Homepage navbar/header is shared and appears across all pages as intended.
- `/dashboard` exists and is the default post-signin landing route.
- Dashboard includes navigation cards and a highlighted Upgrade CTA linking to `/upgrade`.
- `/resume-tailoring`, `/job-search`, and `/upgrade` pages exist as stubs.
