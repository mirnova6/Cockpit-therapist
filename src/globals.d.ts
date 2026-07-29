// Build-time constants injected by Vite `define` (see vite.config.ts). They are
// replaced with literals at build time. In the test/dev environment they may be
// undefined, so all reads go through buildInfo.ts which guards with typeof.
declare const __APP_VERSION__: string | undefined;
/** True only in the public GitHub Pages build. */
declare const __PUBLIC_DEMO__: boolean;
declare const __BUILD_COMMIT__: string | undefined;
declare const __BUILD_DATE__: string | undefined;

// Minimal shims for the Node builtins used in vite.config.ts (build-time only;
// this project does not depend on @types/node).
/** Minimal Node process shim — build scripts read env vars; no @types/node. */
declare const process: { env: Record<string, string | undefined> };

declare module 'node:child_process' {
  export function execSync(command: string, options?: { stdio?: unknown }): { toString(): string };
  export function execFileSync(
    file: string,
    args?: readonly string[],
    options?: { cwd?: string; encoding?: string; stdio?: unknown },
  ): string;
}
declare module 'node:fs' {
  export function readFileSync(path: unknown, encoding: string): string;
  export function readFileSync(path: unknown): Uint8Array;
  export function writeFileSync(path: unknown, data: string): void;
  export function mkdtempSync(prefix: string): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean; size: number };
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
