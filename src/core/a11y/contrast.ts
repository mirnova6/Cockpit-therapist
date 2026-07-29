/**
 * WCAG 2.1 contrast math (Phase 9, §18).
 *
 * This is real arithmetic against the design-system tokens, not a stand-in.
 * It cannot tell you whether a screen is usable — only whether two specific
 * colours meet a numeric threshold. Manual review is still required; see
 * docs/phase9/ACCESSIBILITY.md.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export class ColorParseError extends Error {
  constructor(value: string) {
    super(`Not a supported colour literal: ${value}`);
    this.name = 'ColorParseError';
  }
}

/** Parses `#rgb`, `#rrggbb` and `rgb(r, g, b)`. Throws rather than guessing. */
export function parseColor(value: string): Rgb {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)$/.exec(v);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  throw new ColorParseError(value);
}

/** Relative luminance per WCAG 2.1 §relative-luminance. */
export function relativeLuminance(c: Rgb): number {
  const channel = (raw: number) => {
    const s = raw / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** Contrast ratio in the range [1, 21]. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(typeof a === 'string' ? parseColor(a) : a);
  const lb = relativeLuminance(typeof b === 'string' ? parseColor(b) : b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type TextSize = 'normal' | 'large';
export type WcagLevel = 'AA' | 'AAA';

export function requiredRatio(size: TextSize, level: WcagLevel): number {
  if (level === 'AAA') return size === 'large' ? 4.5 : 7;
  return size === 'large' ? 3 : 4.5;
}

export function meetsContrast(
  foreground: string,
  background: string,
  size: TextSize = 'normal',
  level: WcagLevel = 'AA',
): boolean {
  return contrastRatio(foreground, background) >= requiredRatio(size, level) - 1e-9;
}

/**
 * The colour pairs the UI actually renders. Kept in sync with theme.css by
 * `extractCssVariables`, which reads the stylesheet rather than trusting this
 * list, so a token edit that breaks contrast fails the test suite.
 */
export interface ContrastPair {
  name: string;
  foreground: string;
  background: string;
  size: TextSize;
  /** Non-text UI (borders, focus rings) uses the 3:1 rule. */
  nonText?: boolean;
}

export const THEME_CONTRAST_PAIRS: ContrastPair[] = [
  { name: 'body text on page background', foreground: '--ink', background: '--bg', size: 'normal' },
  { name: 'body text on surface', foreground: '--ink', background: '--surface', size: 'normal' },
  { name: 'secondary text on surface', foreground: '--ink-soft', background: '--surface', size: 'normal' },
  { name: 'secondary text on page background', foreground: '--ink-soft', background: '--bg', size: 'normal' },
  { name: 'link/brand text on surface', foreground: '--brand', background: '--surface', size: 'normal' },
  { name: 'brand text on page background', foreground: '--brand', background: '--bg', size: 'normal' },
  { name: 'risk-high badge text', foreground: '--red', background: '--red-soft', size: 'normal' },
  { name: 'risk-moderate badge text', foreground: '--amber', background: '--amber-soft', size: 'normal' },
  { name: 'risk-low badge text', foreground: '--green', background: '--green-soft', size: 'normal' },
  { name: 'informational badge text', foreground: '--brand', background: '--brand-soft', size: 'normal' },
  { name: 'hypothesis badge text', foreground: '--plum', background: '--plum-soft', size: 'normal' },
  { name: 'focus ring against page background', foreground: '--brand', background: '--bg', size: 'normal', nonText: true },
  { name: 'focus ring against surface', foreground: '--brand', background: '--surface', size: 'normal', nonText: true },
];

/** Reads `--token: value;` declarations out of a CSS source string. */
export function extractCssVariables(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const name = m[1];
    const value = m[2].trim();
    // First declaration wins: :root defines the canonical palette.
    if (!(name in out)) out[name] = value;
  }
  return out;
}

export interface ContrastFinding {
  pair: string;
  ratio: number;
  required: number;
  passes: boolean;
}

/** Evaluates every pair against the tokens actually declared in the stylesheet. */
export function auditThemeContrast(
  css: string,
  pairs: ContrastPair[] = THEME_CONTRAST_PAIRS,
): ContrastFinding[] {
  const vars = extractCssVariables(css);
  return pairs.map((pair) => {
    const fg = vars[pair.foreground] ?? pair.foreground;
    const bg = vars[pair.background] ?? pair.background;
    const ratio = contrastRatio(fg, bg);
    const required = pair.nonText ? 3 : requiredRatio(pair.size, 'AA');
    return {
      pair: pair.name,
      ratio: Math.round(ratio * 100) / 100,
      required,
      passes: ratio >= required - 1e-9,
    };
  });
}
