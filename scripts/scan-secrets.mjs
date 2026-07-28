/**
 * Secret scanner (Phase 9 §17). Fails the build if anything key-shaped is
 * committed. Deliberately conservative: it scans tracked files only and skips
 * binary/build artifacts.
 *
 * Usage: node scripts/scan-secrets.mjs [--verbose]
 * Exit code 1 when a finding is detected.
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const VERBOSE = process.argv.includes('--verbose');

const PATTERNS = [
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Generic bearer secret assignment', re: /(?:api[_-]?key|secret|password|passphrase)\s*[:=]\s*["'][^"'\s]{16,}["']/i },
];

/** Files/dirs that legitimately contain example or test-only material. */
const SKIP_PATHS = [
  /^dist\//,
  /^node_modules\//,
  /^e2e\/output\//,
  /^src\/core\/documents\/extraction\/fixtures\//,
  /^scripts\/scan-secrets\.mjs$/, // the patterns themselves
];

const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|pdf|docx|rtf|zip|woff2?|ttf|mp4|wasm)$/i;

function trackedFiles() {
  return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
}

const findings = [];
for (const file of trackedFiles()) {
  if (SKIP_PATHS.some((re) => re.test(file))) continue;
  if (BINARY_EXT.test(file)) continue;
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue;

  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  for (const { name, re } of PATTERNS) {
    lines.forEach((line, i) => {
      // Clearly-marked placeholders used in docs and examples.
      if (/PLACEHOLDER|EXAMPLE|REDACTED|your-key-here|sk-\.\.\./i.test(line)) return;
      // Explicit, auditable per-line exception for deliberate test fixtures.
      if (/secret-scan-allow/.test(line)) return;
      // Self-evident non-secrets (test passphrases, canaries, fakes). Strict
      // key-FORMAT patterns still fire on these lines; only the loose
      // "assignment" heuristic is relaxed, so a real key is still caught.
      if (name.startsWith('Generic') && /\b(test|fake|dummy|sample|canary|example|fixture)\b/i.test(line)) return;
      if (re.test(line)) {
        findings.push({ file, line: i + 1, name, excerpt: line.trim().slice(0, 120) });
      }
    });
  }
}

if (VERBOSE) {
  console.log(`Scanned ${trackedFiles().length} tracked file(s).`);
}

if (findings.length > 0) {
  console.error(`Secret scan FAILED — ${findings.length} finding(s):\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.name}]`);
    console.error(`    ${f.excerpt}`);
  }
  console.error('\nRemove the secret and rotate it. Never commit provider keys or clinical data.');
  process.exit(1);
}

console.log('Secret scan passed: no key-shaped material found in tracked files.');
