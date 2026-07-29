/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build metadata baked in at build time for the release checklist / deployment
// report. Git may be unavailable (e.g. tarball builds) — fall back honestly.
function gitCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * Base path for the GitHub Pages deployment: the site is served from
 * https://mirnova6.github.io/Cockpit-therapist/, so assets must resolve under
 * that subdirectory.
 *
 * This is applied ONLY when DEPLOY_TARGET=github-pages, because a hard-coded
 * base would break two things that are verified today:
 *
 *  - the Tauri desktop shell loads `dist` from the filesystem
 *    (`frontendDist: "../../../dist"`), where an absolute `/Cockpit-therapist/`
 *    asset URL resolves to nothing;
 *  - the E2E harness serves `dist` with `vite preview` and fetches
 *    `/index.html` and `/assets/<bundle>`, which would 404 under a subpath.
 *
 * Everything except the Pages build therefore stays on '/'.
 */
const GITHUB_PAGES_BASE = '/Cockpit-therapist/';
const isGithubPages = process.env.DEPLOY_TARGET === 'github-pages';

export default defineConfig({
  base: isGithubPages ? GITHUB_PAGES_BASE : '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __BUILD_COMMIT__: JSON.stringify(gitCommit()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    // True only for the public web deployment. Drives a permanent, unmissable
    // banner stating this is a fictional/de-identified beta.
    __PUBLIC_DEMO__: JSON.stringify(isGithubPages),
  },
  server: { port: 5173 },
  build: { sourcemap: false },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
});
