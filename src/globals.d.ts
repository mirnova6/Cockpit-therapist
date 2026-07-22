// Build-time constants injected by Vite `define` (see vite.config.ts). They are
// replaced with literals at build time. In the test/dev environment they may be
// undefined, so all reads go through buildInfo.ts which guards with typeof.
declare const __APP_VERSION__: string | undefined;
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

// Minimal shims for the Node builtins used in vite.config.ts (build-time only;
// this project does not depend on @types/node).
declare module 'node:child_process' {
  export function execSync(command: string, options?: { stdio?: unknown }): { toString(): string };
}
declare module 'node:fs' {
  export function readFileSync(path: unknown, encoding: string): string;
}
