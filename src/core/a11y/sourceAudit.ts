/**
 * Static accessibility audit over the JSX source (Phase 9, §18).
 *
 * WHAT THIS IS: a lint pass that catches a specific, enumerated set of markup
 * mistakes — unlabelled icon buttons, images without alt text, positive
 * tabindex, click handlers on non-interactive elements, and colour used as the
 * only carrier of clinical meaning.
 *
 * WHAT THIS IS NOT: proof that the app is accessible. It never runs the app,
 * never renders a page, and cannot evaluate reading order, screen-reader
 * announcements, keyboard flow, magnification or cognitive load. Those require
 * the manual checklist in docs/phase9/ACCESSIBILITY.md. Passing this audit is
 * a floor, not a certification.
 */

export type A11yRuleId =
  | 'img-alt'
  | 'icon-button-name'
  | 'positive-tabindex'
  | 'click-handler-on-non-interactive'
  | 'anchor-without-href'
  | 'dialog-needs-name'
  | 'color-only-risk-signal'
  | 'autofocus';

export interface A11yFinding {
  rule: A11yRuleId;
  file: string;
  line: number;
  snippet: string;
  message: string;
}

export interface SourceFile {
  path: string;
  content: string;
}

const RULE_MESSAGES: Record<A11yRuleId, string> = {
  'img-alt': '<img> needs an alt attribute (use alt="" if purely decorative).',
  'icon-button-name':
    'A button whose only child is an <Icon> has no accessible name — add aria-label.',
  'positive-tabindex':
    'Positive tabindex reorders the tab sequence unpredictably; use 0 or -1.',
  'click-handler-on-non-interactive':
    'onClick on a <div>/<span> is not keyboard reachable — use <button>, or add role + tabIndex + key handler.',
  'anchor-without-href': '<a> without href is not focusable — use a <button>.',
  'dialog-needs-name': 'role="dialog" needs aria-label or aria-labelledby.',
  'color-only-risk-signal':
    'Risk/severity must not be conveyed by colour alone — pair it with text or an icon.',
  autofocus: 'autoFocus moves focus without user intent and disorients screen-reader users.',
};

/** Splits a source file into JSX-ish opening tags with their line numbers. */
function openingTags(content: string): { tag: string; line: number; raw: string }[] {
  const out: { tag: string; line: number; raw: string }[] = [];
  const re = /<([A-Za-z][A-Za-z0-9.]*)((?:[^<>'"]|'[^']*'|"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const line = content.slice(0, m.index).split('\n').length;
    out.push({ tag: m[1], line, raw: m[0] });
  }
  return out;
}

function hasAttr(raw: string, name: string): boolean {
  return new RegExp(`(?:^|\\s)${name}(?=[=\\s/>])`).test(raw);
}

/** True when a <button ...> element's content is nothing but an <Icon />. */
function iconOnlyButtons(content: string): { line: number; raw: string }[] {
  const out: { line: number; raw: string }[] = [];
  const re = /<button\b((?:[^<>'"]|'[^']*'|"[^"]*"|\{(?:[^{}]|\{[^{}]*\})*\})*)>([\s\S]{0,400}?)<\/button>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const attrs = m[1];
    const inner = m[2];
    if (hasAttr(attrs, 'aria-label') || hasAttr(attrs, 'aria-labelledby') || hasAttr(attrs, 'title')) continue;
    const stripped = inner
      .replace(/<Icon\b[^>]*\/>/g, '')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\s+/g, '');
    // Empty after removing icons => no text node to announce.
    if (stripped === '' && /<Icon\b/.test(inner)) {
      out.push({ line: content.slice(0, m.index).split('\n').length, raw: `<button${attrs}>` });
    }
  }
  return out;
}

/**
 * Risk/severity styling that carries meaning must be accompanied by text.
 * We flag className strings that encode a risk tone with no sibling label.
 */
function colorOnlySignals(content: string): { line: number; raw: string }[] {
  const out: { line: number; raw: string }[] = [];
  const re = /<(span|div|i|b)\b([^<>]*class(?:Name)?="[^"]*\b(?:dot|swatch|pip|bar)--(?:red|amber|green|risk)[^"]*"[^<>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    if (hasAttr(m[2], 'aria-label') || hasAttr(m[2], 'title')) continue;
    out.push({ line: content.slice(0, m.index).split('\n').length, raw: m[0] });
  }
  return out;
}

export function auditSource(files: SourceFile[]): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const push = (rule: A11yRuleId, file: string, line: number, snippet: string) =>
    findings.push({ rule, file, line, snippet: snippet.slice(0, 160), message: RULE_MESSAGES[rule] });

  for (const { path, content } of files) {
    for (const { tag, line, raw } of openingTags(content)) {
      if (tag === 'img' && !hasAttr(raw, 'alt')) push('img-alt', path, line, raw);

      const tabIndex = /tabIndex=\{?\s*(-?\d+)/.exec(raw);
      if (tabIndex && Number(tabIndex[1]) > 0) push('positive-tabindex', path, line, raw);

      if (hasAttr(raw, 'autoFocus')) push('autofocus', path, line, raw);

      if (tag === 'a' && !hasAttr(raw, 'href') && !hasAttr(raw, 'role')) {
        push('anchor-without-href', path, line, raw);
      }

      if (/role="dialog"/.test(raw) && !hasAttr(raw, 'aria-label') && !hasAttr(raw, 'aria-labelledby')) {
        push('dialog-needs-name', path, line, raw);
      }

      if (
        (tag === 'div' || tag === 'span' || tag === 'li') &&
        /\bonClick=/.test(raw) &&
        !hasAttr(raw, 'role') &&
        !/onKeyDown=|onKeyUp=|onKeyPress=/.test(raw)
      ) {
        push('click-handler-on-non-interactive', path, line, raw);
      }
    }

    for (const { line, raw } of iconOnlyButtons(content)) push('icon-button-name', path, line, raw);
    for (const { line, raw } of colorOnlySignals(content)) push('color-only-risk-signal', path, line, raw);
  }

  return findings;
}

export interface A11ySummary {
  filesScanned: number;
  findings: A11yFinding[];
  byRule: Record<string, number>;
  /** Always true — automated coverage never replaces the manual checklist. */
  manualReviewStillRequired: true;
}

export function summarizeAudit(files: SourceFile[]): A11ySummary {
  const findings = auditSource(files);
  const byRule: Record<string, number> = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] ?? 0) + 1;
  return { filesScanned: files.length, findings, byRule, manualReviewStillRequired: true };
}

/**
 * Structural landmark checks: every routed screen should expose a main
 * landmark that the skip link can target.
 */
export function auditLandmarks(files: SourceFile[]): A11yFinding[] {
  const out: A11yFinding[] = [];
  for (const { path, content } of files) {
    if (!/<main\b/.test(content)) continue;
    const re = /<main\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      if (!/id="main-content"/.test(m[1])) {
        out.push({
          rule: 'dialog-needs-name',
          file: path,
          line: content.slice(0, m.index).split('\n').length,
          snippet: m[0],
          message: '<main> should carry id="main-content" so the skip link can reach it.',
        });
      }
    }
  }
  return out;
}
