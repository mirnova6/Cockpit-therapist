/**
 * Repeated-run harness for the browser E2E suite (Phase 8 hardening).
 *
 * Runs the full suite N times consecutively (default 20) and reports per-run
 * results plus an aggregate flake summary. Its purpose is to prove stability
 * — a single green run cannot distinguish "stable" from "got lucky".
 *
 * Usage:
 *   node e2e/repeat.mjs            # 20 runs
 *   node e2e/repeat.mjs 50         # 50 runs
 *   E2E_PARALLEL=3 node e2e/repeat.mjs 9   # 9 runs, 3 at a time
 *
 * Exits non-zero if ANY run fails.
 */
import { spawn } from 'node:child_process';

const RUNS = Number(process.argv[2] ?? 20);
const PARALLEL = Math.max(1, Number(process.env.E2E_PARALLEL ?? 1));
const SMOKE = new URL('./smoke.mjs', import.meta.url).pathname;

function runOnce(index) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [SMOKE], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { out += String(d); });
    child.on('exit', (code) => {
      const failedChecks = [...out.matchAll(/^\s*✗ (.+)$/gm)].map((m) => m[1].trim());
      const passedCount = (out.match(/✓/g) ?? []).length;
      const portMatch = /port=(\d+)/.exec(out);
      const setupFailure = /E2E setup failure: (.+)/.exec(out);
      resolve({
        index,
        ok: code === 0,
        seconds: ((Date.now() - started) / 1000).toFixed(1),
        passedCount,
        failedChecks,
        port: portMatch?.[1] ?? '?',
        setupFailure: setupFailure?.[1],
        output: out,
      });
    });
  });
}

console.log(`Repeated E2E: ${RUNS} run(s), parallelism ${PARALLEL}\n`);

const results = [];
for (let start = 0; start < RUNS; start += PARALLEL) {
  const batch = [];
  for (let k = 0; k < PARALLEL && start + k < RUNS; k++) batch.push(runOnce(start + k + 1));
  for (const r of await Promise.all(batch)) {
    results.push(r);
    const label = `run ${String(r.index).padStart(2)}/${RUNS}  port=${r.port}  ${r.seconds}s  ${r.passedCount} passed`;
    if (r.ok) {
      console.log(`  ✓ ${label}`);
    } else if (r.setupFailure) {
      console.error(`  ✗ ${label}  SETUP: ${r.setupFailure}`);
    } else {
      console.error(`  ✗ ${label}  failed: ${r.failedChecks.join(' | ') || '(unknown)'}`);
    }
  }
}

const failed = results.filter((r) => !r.ok);
const tally = new Map();
for (const r of failed) for (const c of r.failedChecks) tally.set(c, (tally.get(c) ?? 0) + 1);

console.log('\n──────── summary ────────');
console.log(`runs:    ${results.length}`);
console.log(`passed:  ${results.length - failed.length}`);
console.log(`failed:  ${failed.length}`);
const counts = [...new Set(results.map((r) => r.passedCount))];
console.log(`checks per run: ${counts.join(', ')}${counts.length > 1 ? '  (INCONSISTENT)' : ''}`);
const ports = new Set(results.map((r) => r.port));
console.log(`distinct ports: ${ports.size}/${results.length}${ports.size === results.length ? ' (no reuse)' : ''}`);

if (tally.size > 0) {
  console.log('\nflaky/failing checks:');
  for (const [name, n] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}× ${name}`);
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length}/${results.length} run(s) FAILED`);
  const first = failed[0];
  console.error('\n--- output of first failing run ---');
  console.error(first.output.split('\n').slice(-40).join('\n'));
  process.exit(1);
}
console.log(`\nAll ${results.length} consecutive E2E runs passed.`);
