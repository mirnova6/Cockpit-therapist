# Accessibility — Phase 9

Cockpit is a clinical decision-support tool. A clinician who cannot operate it
by keyboard, or who cannot read a risk badge, is not a niche case — they are a
clinician who cannot do their job safely. This document records what was
changed, what is checked automatically, and what still requires a human.

**Cockpit has not been audited by an accessibility professional and makes no
WCAG conformance claim.** The automated checks below are a floor. Section 508 /
WCAG 2.1 AA conformance requires the manual review in this document plus an
independent audit, neither of which has been completed.

---

## 1. What changed in Phase 9

| Change | File | Why |
| --- | --- | --- |
| Skip-navigation link as the first tab stop | `src/app/App.tsx`, `theme.css` | Keyboard users previously had to tab through the whole banner and nav on every route |
| `id="main-content" tabIndex={-1}` on all 22 `<main>` landmarks | 21 screen files | Gives the skip link a real, focusable target |
| Focus trap in `Modal` | `src/app/components/ui.tsx` | Tab escaped the dialog into the page behind it; focus is now cycled and restored to the opener on close |
| Escape closes the mobile navigation sheet | `ClientDashboardLayout.tsx` | Matched the dialog contract; sheet was mouse-dismiss-only |
| Sheet backdrop is a real `<button>` with a name | `ClientDashboardLayout.tsx` | A `<div onClick>` is unreachable by keyboard |
| Always-visible `:focus-visible` ring (3px) | `theme.css` | Focus was only inferable from the browser default in some components |
| 44px minimum touch targets under `@media (pointer: coarse)` | `theme.css` | Buttons in dense clinical tables were below the recommended target size on tablets |
| `@media (prefers-reduced-motion: reduce)` | `theme.css` | Vestibular-disorder safety |
| `.sr-only` utility | `theme.css` | Non-visual alternatives for status conveyed graphically |
| Three palette tokens darkened for AA | `theme.css` | See §3 |

Nothing about clinical behaviour changed. No review gate, risk safeguard,
encryption path or isolation check was touched.

---

## 2. Automated coverage — and its hard limits

`src/core/a11y/` contains two automated passes, run by `npm test`:

**`contrast.ts`** — real WCAG 2.1 relative-luminance and contrast-ratio
arithmetic, evaluated against tokens **parsed out of `theme.css` itself**. If
someone edits a colour token and breaks a contrast pair, the test suite fails.
13 pairs are checked (body text, secondary text, links, all four badge tones,
focus rings on both backgrounds).

**`sourceAudit.ts`** — a static pass over all 71 `.tsx` files enforcing eight
rules: `img-alt`, `icon-button-name`, `positive-tabindex`,
`click-handler-on-non-interactive`, `anchor-without-href`, `dialog-needs-name`,
`color-only-risk-signal`, `autofocus`. The test suite asserts both that the
shipped UI has zero findings *and* that the auditor reports all eight rules on a
deliberately broken fixture — so the "0 findings" result cannot be vacuous.

### What these cannot tell you

They never render a page, never launch a screen reader, and never simulate a
user. They cannot evaluate:

- reading order or whether the DOM order matches the visual order
- what a screen reader actually announces (`aria-label` presence ≠ good label)
- whether focus goes somewhere sensible after an async action completes
- live-region announcements for draft-generation and review-queue changes
- whether a clinician under time pressure can find the risk information
- 200% zoom / 400% reflow, Windows High Contrast, browser text-size overrides
- colour perception beyond the numeric ratio (e.g. red/green risk distinction
  for a deuteranopic user — which is why risk **always** carries an icon and a
  text label, never colour alone)

Passing the automated audit is necessary. It is nowhere near sufficient.

---

## 3. Contrast findings and fixes

The initial run against the real stylesheet found three genuine AA failures.
All three were fixed by darkening the token; no layout or component changed.

| Token | Before | Ratio before | After | Ratio after | Pair |
| --- | --- | --- | --- | --- | --- |
| `--amber` | `#9a6d1f` | 3.97:1 ✗ | `#8a5f14` | 4.88:1 ✓ | amber badge / `--amber-soft` |
| `--green` | `#55806b` | 3.84:1 ✗ | `#4a7260` | 4.66:1 ✓ | green badge / `--green-soft` |
| `--ink-faint` | `#7e8c97` | 3.45:1 ✗ | `#64727c` | 4.95:1 ✓ | `.muted` text / surface |

`--ink-faint` is the most widely used of the three — it drives `.muted`,
`.field__hint`, `.kv dt` and the outline badge, i.e. most secondary text in the
app. It was below AA everywhere it appeared.

Current state: all 13 checked pairs pass AA. Ratios range 4.59:1 (red badge) to
13.50:1 (body text on surface).

---

## 4. Manual accessibility testing checklist

Run this before any release intended for clinician use. Record the date, the
tester, the assistive technology and version, and the result of every line.
**Do not mark a line as passing because the automated audit passed.**

### 4.1 Keyboard only (unplug the mouse)

- [ ] Tab from a cold page load reaches "Skip to main content" first, and it is visible when focused
- [ ] Activating the skip link moves focus into `<main>`; the next Tab lands inside page content, not back in the nav
- [ ] Every interactive control is reachable by Tab, in an order that matches the visual layout
- [ ] No control is reachable but unusable (focusable with no Enter/Space handler)
- [ ] Focus is never invisible: the 3px ring is present on every control, including inside cards and tables
- [ ] Opening any modal moves focus into the dialog
- [ ] Tab and Shift+Tab stay inside the open modal and wrap at both ends
- [ ] Escape closes every modal, and focus returns to the control that opened it
- [ ] Escape closes the mobile navigation sheet
- [ ] The client list, review queue, timeline and evidence lists are fully operable without a pointer
- [ ] Approve / Reject / Edit on an AI draft are each independently keyboard-operable
- [ ] The Real PHI Readiness Gate and the risk-review controls are keyboard-operable
- [ ] No keyboard trap anywhere (you can always Tab back out to the browser chrome)

### 4.2 Screen reader

Test with at least two of: VoiceOver (macOS/Safari, iOS/Safari), NVDA
(Windows/Firefox), TalkBack (Android/Chrome).

- [ ] The page has one `<main>` landmark and the landmark list is navigable
- [ ] Every heading level is meaningful; no level is skipped for styling reasons
- [ ] Every icon-only button announces a verb-first name ("Delete note", not "trash")
- [ ] `RiskBadge` announces the risk level as words, not just a colour
- [ ] A draft's **status** (draft / pending review / approved) is announced, not implied by styling
- [ ] "AI-generated, awaiting clinician review" is announced where it is shown visually
- [ ] Form fields announce their label, their required state, and any hint text
- [ ] Validation errors are announced when they appear, not only rendered
- [ ] Modal dialogs announce as dialogs and read their title on open
- [ ] Long-running operations (analysis, retrieval, backup) announce start and completion
- [ ] Tables announce row and column context, or are restructured if they do not

### 4.3 Vision and display

- [ ] 200% browser zoom: no content lost, no horizontal scrolling of the page body
- [ ] 400% zoom / 320px-wide viewport: content reflows to a single column
- [ ] Browser minimum-font-size override does not clip or overlap text
- [ ] Windows High Contrast Mode: borders, focus rings and disabled states remain distinguishable
- [ ] Dark-mode / inverted-colour OS settings do not render any text invisible
- [ ] Greyscale the screen: risk, status and validity remain distinguishable (they must, since all carry text + icon)
- [ ] Deuteranopia/protanopia simulation: no clinical meaning is lost

### 4.4 Motion, timing and input

- [ ] With `prefers-reduced-motion` enabled, no transition or animation plays
- [ ] Auto-lock warns before locking and can be extended without a mouse
- [ ] No content flashes more than three times per second
- [ ] On a touch device, every control meets the 44×44px target and is not adjacent to a destructive action
- [ ] Pinch-zoom is not blocked
- [ ] Both portrait and landscape orientations are usable

### 4.5 Cognitive and clinical-safety load

These matter more here than in an ordinary app, because a missed cue is a
clinical risk, not an inconvenience.

- [ ] It is unambiguous, at a glance, which content is AI-generated and unapproved
- [ ] It is unambiguous which content is a *fact from the record* versus a *hypothesis*
- [ ] Risk-sensitive items cannot be bulk-approved and the UI makes that visible, not just enforced
- [ ] Error messages say what happened and what to do, without jargon or a stack trace
- [ ] Destructive actions state exactly what will be lost before confirmation
- [ ] Nothing implies HIPAA compliance, legal approval, or readiness for real PHI

### 4.6 Sign-off

| Field | Value |
| --- | --- |
| Date | |
| Tester | |
| Build / commit | |
| AT used (name + version) | |
| Browser + OS | |
| Lines failed | |
| Blockers raised | |

---

## 5. Known accessibility gaps

Stated plainly rather than left for a user to discover:

1. **No screen-reader testing has been performed.** The markup was written to
   support it and the static rules pass, but no VoiceOver/NVDA/TalkBack session
   has been run against this build.
2. **No live regions yet.** Draft generation, retrieval and review-queue
   updates change the DOM without announcing it. A screen-reader user will not
   learn that a draft finished generating unless they navigate to it.
3. **No independent audit.** No accessibility professional has reviewed this
   app. The WCAG claim in this document is limited to the 13 contrast pairs and
   8 static rules that are actually measured.
4. **Data-dense tables** (timeline, evidence, audit log) have not been checked
   for screen-reader row/column context.
5. **Zoom and reflow are untested** at 400%.
6. **Charts and score trends** have no textual alternative.

Items 1, 2 and 3 are blockers for any deployment to a clinician with a
disability-related access need, and should be resolved before general clinical
use.
