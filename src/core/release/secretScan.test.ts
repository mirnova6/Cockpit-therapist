/**
 * Verifies the CI secret scanner actually rejects committed secrets (§25:
 * "Secret scanning rejects committed test secrets"). Runs the real script
 * against a temporary git repo containing a planted key.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCRIPT = new URL('../../../scripts/scan-secrets.mjs', import.meta.url).pathname;

function runScanner(cwd: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT], { cwd, encoding: 'utf8' });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('secret scanner', () => {
  it('passes on this repository (no committed secrets)', () => {
    const repo = new URL('../../../', import.meta.url).pathname;
    const res = runScanner(repo);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/Secret scan passed/);
  });

  it('rejects a committed provider key with a non-zero exit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'scan-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    // A realistic-looking key, planted deliberately.
    writeFileSync(join(dir, 'leak.ts'), `const key = "sk-ant-${'a'.repeat(40)}";\n`);
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const res = runScanner(dir);
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/Secret scan FAILED/);
    expect(res.out).toMatch(/Anthropic API key/);
  });
});
