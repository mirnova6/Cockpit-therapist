/**
 * Build metadata (Phase 8) — version, commit, and build date baked in at build
 * time by Vite `define`. Reads are guarded so tests/dev (where the constants
 * are not defined) get honest "dev"/"unknown" values rather than crashing.
 */
export interface BuildInfo {
  version: string;
  commit: string;
  buildDate: string;
  /** True only for a real production build where the constants were injected. */
  isProductionBuild: boolean;
}

function readConst(name: '__APP_VERSION__' | '__BUILD_COMMIT__' | '__BUILD_DATE__'): string | undefined {
  try {
    // eslint-disable-next-line no-eval
    switch (name) {
      case '__APP_VERSION__':
        return typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__;
      case '__BUILD_COMMIT__':
        return typeof __BUILD_COMMIT__ === 'undefined' ? undefined : __BUILD_COMMIT__;
      case '__BUILD_DATE__':
        return typeof __BUILD_DATE__ === 'undefined' ? undefined : __BUILD_DATE__;
    }
  } catch {
    return undefined;
  }
}

export function buildInfo(): BuildInfo {
  const version = readConst('__APP_VERSION__');
  const commit = readConst('__BUILD_COMMIT__');
  const buildDate = readConst('__BUILD_DATE__');
  return {
    version: version ?? '0.0.0-dev',
    commit: commit ?? 'unknown',
    buildDate: buildDate ?? 'dev',
    isProductionBuild: Boolean(version && commit && buildDate),
  };
}
