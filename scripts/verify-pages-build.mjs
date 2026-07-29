#!/usr/bin/env node
/**
 * Verifies the GitHub Pages build before it is published.
 *
 * This is a real gate, not a formality. A static site published to a public URL
 * cannot be un-published from anyone's cache, so the things that must be true
 * are checked mechanically rather than assumed:
 *
 *   1. Assets resolve under /Cockpit-therapist/ — otherwise the deployed page
 *      loads nothing and looks broken.
 *   2. The permanent "fictional / de-identified only, not approved for real
 *      PHI" notice is actually present in the shipped bundle.
 *   3. No API keys or secret-shaped material is in the output.
 *   4. No real client data. The bundle DOES contain the deliberately fictional
 *      sample workspace; this checks that everything in it is marked
 *      [FICTIONAL] and that no unmarked-looking clinical fixture leaked in.
 *   5. The static host files needed for a subpath SPA are present.
 *
 * Exit 0 = safe to publish. Exit 1 = something a human must look at.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BASE = '/Cockpit-therapist/';

const problems = [];
const notes = [];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error('dist/ not found — run `npm run build:pages` first.');
  process.exit(1);
}

const rel = (f) => f.slice(DIST.length);
const textFiles = files.filter((f) => /\.(html|js|css|json|txt|svg|map)$/i.test(f));

// ---------------------------------------------------------------- 1. base path

const indexPath = join(DIST, 'index.html');
let indexHtml = '';
try {
  indexHtml = readFileSync(indexPath, 'utf8');
} catch {
  problems.push('dist/index.html is missing.');
}

const assetRefs = [...indexHtml.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const localRefs = assetRefs.filter((r) => !/^(https?:)?\/\//.test(r) && !r.startsWith('data:'));
const wrongBase = localRefs.filter((r) => !r.startsWith(BASE));
if (localRefs.length === 0) {
  problems.push('index.html references no local assets — the build looks empty.');
} else if (wrongBase.length > 0) {
  problems.push(
    `index.html references ${wrongBase.length} asset(s) not under ${BASE}: ${wrongBase.join(', ')}\n` +
      '    The build was probably produced without DEPLOY_TARGET=github-pages.',
  );
} else {
  notes.push(`${localRefs.length} asset reference(s) all resolve under ${BASE}`);
}

// -------------------------------------------------- 2. public labelling present

const NOTICE_FRAGMENTS = [
  'Public demonstration build',
  'fictional or fully de-identified data only',
  'NOT approved for real client information',
];
const bundleText = textFiles
  .filter((f) => /\.(js|html)$/i.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const missingNotice = NOTICE_FRAGMENTS.filter((fragment) => !bundleText.includes(fragment));
if (missingNotice.length > 0) {
  problems.push(
    `The public-demonstration notice is not in the built bundle. Missing: ${missingNotice
      .map((m) => `"${m}"`)
      .join(', ')}\n` + '    A public build must state on its face that it is not for real PHI.',
  );
} else {
  notes.push('permanent public-demonstration notice present in the bundle');
}

if (!/__PUBLIC_DEMO__/.test(bundleText)) {
  notes.push('__PUBLIC_DEMO__ was inlined at build time (expected)');
}

// ------------------------------------------------------------- 3. no secrets

const SECRET_PATTERNS = [
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{16,}/ },
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

for (const file of textFiles) {
  const content = readFileSync(file, 'utf8');
  for (const { name, re } of SECRET_PATTERNS) {
    const hit = re.exec(content);
    if (hit) problems.push(`${name} found in dist/${rel(file)}: ${hit[0].slice(0, 12)}…`);
  }
}
if (!problems.some((p) => p.includes('found in dist/'))) {
  notes.push(`no secret-shaped material in ${textFiles.length} text file(s)`);
}

// ------------------------------------------------------- 4. no real client data

// The sample workspace is intentionally bundled. Every client display name in
// it must carry the [FICTIONAL] marker, so a visitor can never mistake seeded
// data for a real record.
const displayNames = [...bundleText.matchAll(/displayName:\s*"([^"]{2,80})"/g)].map((m) => m[1]);
const unmarked = displayNames.filter((n) => !n.includes('[FICTIONAL]'));
if (unmarked.length > 0) {
  problems.push(
    `Bundled sample data contains ${unmarked.length} client name(s) without the [FICTIONAL] marker: ` +
      unmarked.slice(0, 5).join(', '),
  );
} else if (displayNames.length > 0) {
  notes.push(`all ${displayNames.length} bundled sample client name(s) marked [FICTIONAL]`);
}

// Guard against a real-looking identifier format ever reaching the bundle.
const IDENTIFIER_PATTERNS = [
  { name: 'US SSN', re: /\b\d{3}-\d{2}-\d{4}\b/ },
  { name: 'long digit run (possible MRN/account)', re: /\b\d{12,}\b/ },
];
for (const { name, re } of IDENTIFIER_PATTERNS) {
  const hit = re.exec(bundleText);
  if (hit) problems.push(`Possible real identifier (${name}) in the bundle: ${hit[0]}`);
}

// ------------------------------------------------------- 5. static host files

for (const required of ['404.html', '.nojekyll']) {
  if (!files.some((f) => rel(f) === required)) {
    problems.push(`dist/${required} is missing — needed for correct GitHub Pages hosting.`);
  }
}
if (!problems.some((p) => p.includes('needed for correct GitHub Pages hosting'))) {
  notes.push('404.html and .nojekyll present');
}

// ------------------------------------------------------------------ report

console.log(`Verifying dist/ for publication at https://mirnova6.github.io${BASE}\n`);
for (const note of notes) console.log(`  ok    ${note}`);

if (problems.length > 0) {
  console.error(`\nPages build verification FAILED — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}\n`);
  process.exit(1);
}

console.log('\nPages build verified: correct base path, labelled as a non-PHI beta, no secrets, no real client data.');
