#!/usr/bin/env node
/**
 * Dependency-advisory gate (Phase 9, §17).
 *
 * `npm audit` alone is a poor gate: it fails on development-toolchain advisories
 * that never ship, which trains people to add `|| true` and stop reading it.
 * This wraps it so the gate stays meaningful:
 *
 *   - Every advisory must be listed in security/advisory-exceptions.json with a
 *     written reason, or the build fails. A NEW advisory always blocks CI until
 *     a human reviews it.
 *   - Exceptions expire. An expired file fails the build exactly like an
 *     unreviewed advisory, so "we looked at it once in 2026" cannot hold forever.
 *   - Nothing is silently suppressed: every advisory is printed either way.
 *
 * Exit 0 = every advisory is reviewed and unexpired. Exit 1 = something needs a
 * human.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXCEPTIONS_PATH = new URL('../security/advisory-exceptions.json', import.meta.url).pathname;

function runAudit() {
  // npm audit exits non-zero when it finds anything; we want the JSON regardless.
  try {
    return JSON.parse(execFileSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function collectAdvisories(report) {
  const found = new Map();
  for (const [pkg, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via !== 'object' || !via.url) continue;
      const id = via.url.split('/').pop();
      if (!found.has(id)) {
        found.set(id, { id, package: pkg, severity: via.severity ?? entry.severity, title: via.title ?? '', url: via.url });
      }
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const exceptionsFile = JSON.parse(readFileSync(EXCEPTIONS_PATH, 'utf8'));
const byId = new Map((exceptionsFile.exceptions ?? []).map((e) => [e.id, e]));
const advisories = collectAdvisories(runAudit());

console.log(`Dependency advisories found: ${advisories.length}`);
console.log(`Reviewed exceptions on file: ${byId.size} (reviewed ${exceptionsFile.reviewedOn}, expires ${exceptionsFile.expiresOn})\n`);

const problems = [];

const expiry = Date.parse(exceptionsFile.expiresOn ?? '');
if (!Number.isFinite(expiry)) {
  problems.push('security/advisory-exceptions.json has no valid expiresOn date.');
} else if (Date.now() > expiry && advisories.length > 0) {
  problems.push(
    `The advisory review expired on ${exceptionsFile.expiresOn}. Re-review every entry and update reviewedOn/expiresOn.`,
  );
}

for (const advisory of advisories) {
  const exception = byId.get(advisory.id);
  if (!exception) {
    problems.push(
      `UNREVIEWED ${advisory.severity}: ${advisory.id} (${advisory.package}) — ${advisory.title}\n` +
        `    ${advisory.url}\n` +
        '    Add a reviewed entry to security/advisory-exceptions.json, or upgrade the dependency.',
    );
    continue;
  }
  const shipped = exception.shipped ? 'SHIPPED' : 'dev-only';
  console.log(`  reviewed  ${advisory.severity.padEnd(8)} ${advisory.id}  ${advisory.package}  [${shipped}]`);
  console.log(`            ${exception.whyNotReachable}`);
}

// Exceptions for advisories that no longer appear are stale bookkeeping, not a
// security problem — report them so the file stays honest, but do not fail.
const stale = [...byId.keys()].filter((id) => !advisories.some((a) => a.id === id));
if (stale.length > 0) {
  console.log(`\nNote: ${stale.length} exception(s) no longer match any advisory and can be removed: ${stale.join(', ')}`);
}

if (problems.length > 0) {
  console.error(`\nDependency audit FAILED — ${problems.length} item(s) need a human:\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log('\nAll dependency advisories are reviewed and the review is current.');
