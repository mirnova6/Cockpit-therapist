# Online AI Backend / Proxy Architecture Plan (Phase 6)

**This is a FUTURE ARCHITECTURE PLAN, not an implemented production backend.**
No backend is built in this repo. Today, online AI is a direct browser→provider
call intended for fictional/development use, gated by consent, attestation,
approval registry, kill switch, and confirmed preview. For real PHI, that
direct path must be replaced by the proxy described here.

## Problem

Direct browser→provider requests mean:

- the provider API key would have to live on the device,
- PHI transits from the clinician device straight to the vendor,
- there is no organizational chokepoint for policy, audit, or rate control.

For production PHI use this is inadequate. A minimal, well-scoped backend fixes
it while keeping the client local-first for everything else.

## Target architecture

```
Clinician app ──HTTPS──> Cockpit proxy (org-controlled) ──HTTPS──> AI provider
   (holds no                (holds provider key,             (Anthropic, etc.)
    provider key)            enforces policy, audits)
```

The app sends the assembled task (already fenced: system rules / clinician
command / untrusted client evidence / knowledge) to the org's proxy, not to the
vendor. The proxy is the only component that holds the provider key.

## Requirements the proxy must satisfy

1. **Server-side provider key handling.** Keys in a secrets manager (KMS/HSM),
   never shipped to clients. Rotation without app updates.
2. **Request signing.** App authenticates to the proxy (per-clinician token /
   mTLS); the proxy signs/authorizes upstream calls. Reject unsigned requests.
3. **Audit without plaintext.** Log operation metadata (who, when, provider,
   model, purpose, byte counts, decision) — never prompt/response bodies.
   Mirror the client's existing "no clinical plaintext in logs" rule server-side.
4. **Provider approval enforcement.** The proxy re-checks the same approval
   model the client enforces (approved status, unexpired, allowed purpose) so a
   compromised client cannot bypass it.
5. **BAA/contract configuration.** Per-provider config records the executed BAA
   and the purposes it covers; the proxy refuses purposes outside it.
6. **Per-organization settings.** Allowed providers/models, redaction policy,
   data-residency region, retention posture, default kill switch.
7. **Rate limiting.** Per-clinician and per-org quotas; burst protection.
8. **Abuse prevention.** Anomaly detection on volume/patterns; automatic
   suspension hooks; org-level emergency disable (server-side kill switch).
9. **Error handling.** Sanitized, typed errors to the client (auth, rate-limit,
   provider-unavailable) with no upstream detail leakage.
10. **Training/retention configuration tracking.** Where the provider exposes
    "no training / zero-retention" controls, record and enforce that the proxy
    sets them, and store the attestation.
11. **Future multi-user support.** Per-user identity, roles, and audit
    attribution; org admin console for providers, quotas, and kill switch.

## Client-side changes when the proxy exists

- Add a provider type `secure-proxy` behind the existing `ClinicalAIProvider`
  seam. The rest of the app is unchanged because everything routes through the
  gateway already.
- The client stops holding the vendor key; it holds only a proxy auth token.
- The outbound preview and per-run confirmation remain — the clinician still
  sees exactly what leaves the device.
- The existing per-client local-only override still forbids any online send.

## Explicitly out of scope for this phase

Building, deploying, or operating the proxy; multi-tenant hosting; billing.
Those belong to the organizational-deployment phase and require their own
security review.
