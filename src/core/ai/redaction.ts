/**
 * Deterministic redaction applied before online sending when the clinician
 * enables it. This is a best-effort transformation and the UI must never
 * imply it is perfect — the transformed text is always SHOWN to the
 * clinician before anything is sent (§3).
 */

export interface RedactionContext {
  /** Names/identifiers known for this client (display name, identifier, …). */
  knownNames: string[];
}

export interface RedactionResult {
  text: string;
  /** Which kinds of replacements happened, for the preview UI. */
  replacements: Array<{ kind: string; count: number }>;
}

const PATTERNS: Array<{ kind: string; regex: RegExp; replacement: string }> = [
  { kind: 'email address', regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '[EMAIL]' },
  { kind: 'phone number', regex: /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, replacement: '[PHONE]' },
  { kind: 'SSN-like number', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[ID-NUMBER]' },
  { kind: 'date of birth', regex: /\b(?:DOB|date of birth)[:\s]+[\d/.-]+\b/gi, replacement: 'DOB: [DATE]' },
  {
    kind: 'street address',
    regex: /\b\d{1,5}\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b\.?/g,
    replacement: '[ADDRESS]',
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactText(text: string, context: RedactionContext): RedactionResult {
  let output = text;
  const replacements: Array<{ kind: string; count: number }> = [];

  for (const name of context.knownNames.filter((n) => n.trim().length >= 2)) {
    const regex = new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, 'gi');
    const count = (output.match(regex) ?? []).length;
    if (count > 0) {
      output = output.replace(regex, '[CLIENT]');
      replacements.push({ kind: `client name/identifier ("${name.trim()[0]}…")`, count });
    }
  }

  for (const pattern of PATTERNS) {
    const count = (output.match(pattern.regex) ?? []).length;
    if (count > 0) {
      output = output.replace(pattern.regex, pattern.replacement);
      replacements.push({ kind: pattern.kind, count });
    }
  }

  return { text: output, replacements };
}

export const REDACTION_DISCLAIMER =
  'Automated redaction is a best-effort transformation and can miss identifying details. Review the transformed text below before sending.';
