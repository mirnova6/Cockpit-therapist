# Cockpit secure online AI proxy — reference implementation (Phase 9)

**Status: reference implementation. NOT enabled for real PHI, and not deployed
by this repository.** It exists so that a future, approved online-AI
configuration has a reviewed starting point in which the client never holds a
provider API key.

Nothing here weakens the app's local-first defaults: online AI remains disabled
by default, the Real PHI Readiness Gate remains authoritative, and no PHI may be
sent until every gate in the app passes.

## Why a proxy

In direct-provider mode the client stores an API key and talks to the provider
itself. That is acceptable for local development with fictional data, but for
organizational use it means a key on every device and no central enforcement.
The proxy moves the key server-side and makes provider approval, allowed
purposes, rate limits and kill switches enforceable in one place.

## What it enforces (`server.mjs`)

| Control | Behavior |
| --- | --- |
| Server-side keys | The provider key lives only in the server environment. The client sends no key. |
| Request authentication | Bearer session token per workspace; unknown/expired tokens are rejected. |
| Provider allowlist | Only providers in the configured allowlist are reachable. |
| Model allowlist | Only allowlisted models are reachable. |
| Endpoint allowlist | Outbound host must be explicitly allowlisted. |
| Approval + purpose | Request must declare an approved provider and an allowed purpose. |
| Organization kill switch | One flag refuses every online request instantly. |
| Workspace policy | Per-workspace `localOnly` refuses online processing outright. |
| Size limits | Oversized payloads are rejected before any provider call. |
| Rate limiting | Per-workspace token bucket. |
| Timeout + cancellation | Upstream calls are abortable and time-bounded. |
| Sanitized errors | Provider errors are mapped to categories; upstream bodies are never echoed. |
| Audit without prompts | Operation logs record identifiers and metadata only — no prompt or output text. |
| No clinical retention | Prompts/outputs are NOT stored. Retention is opt-in and off by default. |
| Health/readiness | `/health` and `/ready` report status without leaking configuration. |

## Data minimization (client side, before any request)

The client performs the full Phase 4–7 gate sequence *before* calling the proxy:
validate organization/workspace/client → provider approval → allowed purpose →
BAA/contract tracking → AI consent → local-only restrictions → global and
organization kill switches → show the exact outbound preview → allow source
deselection → require explicit confirmation → send only the selected context →
record a plaintext-free operation log.

The proxy re-validates independently. Client-side checks are not trusted.

## Running it (development, fictional data only)

```bash
cd proxy
COCKPIT_PROXY_TOKENS='{"ws-dev":"dev-token"}' \
COCKPIT_PROVIDER_KEY='sk-...' \
node server.mjs           # listens on PORT (default 8787)
```

## Exact blockers before any real-PHI use

1. **Signed BAA** with the provider, recorded and approved in the app's registry.
2. **Independent security review** of this proxy, its deployment and its network path.
3. **Real authentication** — the reference uses static per-workspace tokens; production
   needs proper identity (SSO/OIDC), rotation and revocation.
4. **TLS termination + transport hardening** in front of the proxy.
5. **Deployment hardening**: secret management, log scrubbing verification, network egress
   allowlist, monitoring.
6. **Legal/HIPAA review** covering the arrangement end-to-end.

Until all of the above are complete, the app's Real PHI Readiness Gate stays
blocked and online PHI processing remains refused.
