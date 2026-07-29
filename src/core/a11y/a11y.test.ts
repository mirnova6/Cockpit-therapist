import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditThemeContrast,
  contrastRatio,
  extractCssVariables,
  meetsContrast,
  parseColor,
  relativeLuminance,
  requiredRatio,
  ColorParseError,
} from './contrast';
import { auditLandmarks, auditSource, summarizeAudit, type SourceFile } from './sourceAudit';

function walk(dir: string, ext: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, acc);
    else if (full.endsWith(ext)) acc.push(full);
  }
  return acc;
}

const tsxFiles: SourceFile[] = walk('src', '.tsx').map((path) => ({
  path,
  content: readFileSync(path, 'utf8'),
}));

const themeCss = readFileSync('src/app/theme.css', 'utf8');

describe('WCAG contrast math', () => {
  it('computes the reference ratios correctly', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    // Known WCAG example: #777 on white is 4.48:1 (just under AA).
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('parses hex shorthand, hex longhand and rgb()', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('#3F6E93')).toEqual({ r: 63, g: 110, b: 147 });
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('refuses colour formats it cannot evaluate rather than guessing', () => {
    expect(() => parseColor('hsl(200 50% 40%)')).toThrow(ColorParseError);
    expect(() => parseColor('var(--brand)')).toThrow(ColorParseError);
  });

  it('applies the correct AA/AAA thresholds', () => {
    expect(requiredRatio('normal', 'AA')).toBe(4.5);
    expect(requiredRatio('large', 'AA')).toBe(3);
    expect(requiredRatio('normal', 'AAA')).toBe(7);
    expect(meetsContrast('#777777', '#ffffff', 'normal', 'AA')).toBe(false);
    expect(meetsContrast('#777777', '#ffffff', 'large', 'AA')).toBe(true);
  });

  it('luminance is monotonic in brightness', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe('design-system tokens meet WCAG AA', () => {
  it('reads the palette out of the real stylesheet', () => {
    const vars = extractCssVariables(themeCss);
    expect(vars['--ink']).toBeTruthy();
    expect(vars['--brand']).toBeTruthy();
    expect(vars['--red-soft']).toBeTruthy();
  });

  it('every text and focus-ring pair the UI renders passes AA', () => {
    const findings = auditThemeContrast(themeCss);
    const failures = findings.filter((f) => !f.passes);
    expect(
      failures.map((f) => `${f.pair}: ${f.ratio}:1 (needs ${f.required}:1)`),
    ).toEqual([]);
    expect(findings.length).toBeGreaterThan(10);
  });
});

describe('static JSX accessibility audit', () => {
  it('scans the whole UI tree', () => {
    expect(tsxFiles.length).toBeGreaterThan(50);
  });

  it('finds no accessibility violations in the shipped UI', () => {
    const findings = auditSource(tsxFiles);
    expect(findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.message}`)).toEqual([]);
  });

  it('every <main> landmark is reachable from the skip link', () => {
    expect(auditLandmarks(tsxFiles).map((f) => `${f.file}:${f.line}`)).toEqual([]);
  });

  it('the app renders a skip-navigation link as an early tab stop', () => {
    const app = tsxFiles.find((f) => f.path.endsWith('app/App.tsx'));
    expect(app?.content).toContain('href="#main-content"');
    expect(app?.content).toMatch(/skip-nav/);
  });

  it('the stylesheet keeps the skip link off-screen until focused', () => {
    expect(themeCss).toMatch(/\.skip-nav\s*\{[^}]*left:\s*-9999px/);
    expect(themeCss).toMatch(/\.skip-nav:focus\s*\{[^}]*left:\s*0/);
  });

  it('honours prefers-reduced-motion and coarse pointers', () => {
    expect(themeCss).toContain('@media (prefers-reduced-motion: reduce)');
    expect(themeCss).toMatch(/@media \(pointer: coarse\)[\s\S]{0,200}min-height:\s*44px/);
  });
});

describe('the audit actually detects violations (it is not vacuous)', () => {
  const bad: SourceFile[] = [
    {
      path: 'fake/Bad.tsx',
      content: `
        export function Bad() {
          return (
            <div>
              <img src="x.png" />
              <button className="icon-btn"><Icon name="trash" size={14} /></button>
              <span tabIndex={3}>reordered</span>
              <div onClick={() => go()}>click me</div>
              <a onClick={() => go()}>fake link</a>
              <div role="dialog">unnamed</div>
              <input autoFocus />
              <span className="dot--red" />
            </div>
          );
        }
      `,
    },
  ];

  it('reports every rule it claims to implement', () => {
    const summary = summarizeAudit(bad);
    expect(Object.keys(summary.byRule).sort()).toEqual(
      [
        'anchor-without-href',
        'autofocus',
        'click-handler-on-non-interactive',
        'color-only-risk-signal',
        'dialog-needs-name',
        'icon-button-name',
        'img-alt',
        'positive-tabindex',
      ].sort(),
    );
    expect(summary.manualReviewStillRequired).toBe(true);
  });

  it('accepts the accessible equivalents', () => {
    const good: SourceFile[] = [
      {
        path: 'fake/Good.tsx',
        content: `
          <img src="x.png" alt="Chart of PHQ-9 scores" />
          <button className="icon-btn" aria-label="Delete note"><Icon name="trash" size={14} /></button>
          <span tabIndex={-1}>ok</span>
          <button onClick={() => go()}>click me</button>
          <a href="#main-content">skip</a>
          <div role="dialog" aria-label="Confirm">named</div>
          <span className="dot--red" aria-label="High risk" />
        `,
      },
    ];
    expect(auditSource(good)).toEqual([]);
  });

  it('flags a <main> without the skip-link target', () => {
    expect(auditLandmarks([{ path: 'fake/NoId.tsx', content: '<main className="page">x</main>' }])).toHaveLength(1);
  });
});

describe('risk is never signalled by colour alone', () => {
  it('RiskBadge always renders an icon and the level text', () => {
    const ui = readFileSync('src/app/components/ui.tsx', 'utf8');
    expect(ui).toMatch(/Risk: \{riskLabel\(level\)\}/);
    expect(ui).toMatch(/const icon = level === 'acute' \|\| level === 'high' \? 'alert' : 'shield'/);
  });
});

describe('modal dialogs trap focus and restore it', () => {
  const ui = readFileSync('src/app/components/ui.tsx', 'utf8');

  it('declares itself a modal dialog with an accessible name', () => {
    expect(ui).toContain('role="dialog"');
    expect(ui).toContain('aria-modal="true"');
    expect(ui).toContain('aria-label={title}');
  });

  it('closes on Escape', () => {
    expect(ui).toMatch(/e\.key === 'Escape'/);
  });

  it('cycles Tab within the dialog and restores focus on close', () => {
    expect(ui).toMatch(/e\.key !== 'Tab'/);
    expect(ui).toMatch(/previouslyFocused\?\.focus\?\.\(\)/);
  });
});
