# GitHub Pages deployment

**Published address: https://mirnova6.github.io/Cockpit-therapist/**

This is the **public demonstration build of the fictional-data beta**. It is
**not approved for real client information (PHI)**, and the app says so
permanently and undismissably on every screen.

---

## What is deployed

A static, client-only browser build. There is no server, no database, no
API, and no account. Everything a visitor creates lives in **their own
browser's IndexedDB, AES-256-GCM encrypted**, and is never uploaded — the
deployment test asserts the page makes no outbound request to any external
host.

## Configuration

| Concern | Setting |
| --- | --- |
| Base path | `/Cockpit-therapist/` |
| Applied when | `DEPLOY_TARGET=github-pages` (`npm run build:pages`) |
| Router | `HashRouter` (already in use before this deployment) |
| Trigger | push to `main`, plus manual dispatch |
| Workflow | `.github/workflows/pages.yml` |
| Secrets used | **none** |

### Why the base path is build-scoped, not hard-coded

`base` is `/Cockpit-therapist/` only for the Pages build, and `/` everywhere
else. Hard-coding it would break two systems that are verified today:

- the **Tauri desktop shell** loads `dist` from the filesystem
  (`frontendDist: "../../../dist"`), where an absolute `/Cockpit-therapist/`
  asset URL resolves to nothing;
- the **E2E harness** serves `dist` with `vite preview` and fetches
  `/index.html` and `/assets/<bundle>`, which would 404 under a subpath.

Both were re-run after the change and still pass.

### Why nested routes survive a refresh

The app already used `HashRouter` before this work. Everything after `#` is
never sent to the server, so `…/Cockpit-therapist/#/governance` reloads
correctly on a static host with no rewrite rules at all.

`public/404.html` covers the remaining case — a bare path with no hash, e.g.
someone hand-typing `…/Cockpit-therapist/clients/123`, or an old link. GitHub
Pages serves that file for unknown paths; it redirects into the equivalent hash
route instead of showing GitHub's 404.

`public/.nojekyll` stops Pages from running the build output through Jekyll.

## Verification

Two gates run in the workflow before anything is published, and both fail the
build rather than warn.

**`scripts/verify-pages-build.mjs`** — static checks on `dist/`:

- every local asset reference resolves under `/Cockpit-therapist/`
- the public-demonstration notice is genuinely present in the shipped bundle
- no API keys or secret-shaped material in any output file
- every bundled sample client name carries the `[FICTIONAL]` marker
- no real-identifier shapes (SSN pattern, long digit runs)
- `404.html` and `.nojekyll` are present

Confirmed to be a real gate: it exits 1 on a build produced without
`DEPLOY_TARGET=github-pages`, and 0 on a correct one.

**`npm run test:pages`** (`e2e/pages.mjs`) — serves `dist/` exactly as Pages
does (repo subpath, `404.html` for unknown paths) and drives a real browser
through 14 checks:

```
✓ root URL loads the app under the subpath
✓ no console/page errors or failed requests
✓ public-demo banner shown on first load
✓ banner says fictional / de-identified only
✓ banner says NOT approved for real client information
✓ banner says data stays in this browser
✓ workspace created on the deployed path
✓ nested route opens directly from a pasted URL
✓ refresh on a nested route serves the app (not a 404)
✓ nested route survives refresh in the URL
✓ banner still shown after refresh
✓ bare nested path recovers into the app via 404.html
✓ 404.html served with a 404 status (as Pages does)
✓ no outbound requests to any external host
```

## What is NOT deployed and NOT claimed

- **No secrets.** The workflow reads no repository secrets and the build needs
  none. The app ships with no provider credentials; a clinician supplies their
  own at runtime, stored encrypted in their own browser.
- **No client data, real or test PHI.** The only bundled data is the
  deliberately fictional sample workspace, every record of which is marked
  `[FICTIONAL]` — asserted by the build gate.
- **No connected AI model.** Deterministic, rule-based logic only unless a
  visitor connects their own.
- **No signed native app.** This is a browser build; see `native/README.md`.
- **No compliance claim.** The Real PHI Readiness Gate remains blocked by
  default and is unchanged by this deployment.

## One-time repository setup

The workflow needs Pages set to build from GitHub Actions:

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

Until that is set, the `deploy` job fails with a "Pages is not enabled" error.
It cannot be enabled from the workflow itself.
