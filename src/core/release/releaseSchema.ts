/**
 * Phase 8 release checklist schema.
 *
 * Human-tracked release-readiness items (build/signing, reviews, device and
 * beta testing). Auto-derivable facts (version, commit, build date, PHI-gate
 * status, online-AI status) are assembled live in the deployment report, not
 * stored here. Nothing here claims HIPAA compliance or real-PHI readiness.
 */

export type ReleaseStatus = 'not-started' | 'in-progress' | 'blocked' | 'done' | 'not-applicable';

export const RELEASE_STATUSES: Array<{ value: ReleaseStatus; label: string }> = [
  { value: 'not-started', label: 'Not started' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'done', label: 'Done' },
  { value: 'not-applicable', label: 'Not applicable' },
];

export interface ReleaseChecklistItem {
  id: string;
  key: string;
  category: string;
  label: string;
  detail: string;
  status: ReleaseStatus;
  notes?: string;
  updatedAt: string;
}

export type ReleaseSeed = Pick<ReleaseChecklistItem, 'key' | 'category' | 'label' | 'detail'>;

/** Human-tracked release items. All start 'not-started'. */
export const RELEASE_SEED: ReleaseSeed[] = [
  { key: 'desktop-build', category: 'Platform builds', label: 'macOS desktop build produced & signed', detail: 'Tauri build run on macOS with a Developer ID cert + notarization (see native/README.md blockers).' },
  { key: 'windows-build', category: 'Platform builds', label: 'Windows desktop build produced & signed', detail: 'Tauri build run on Windows with an Authenticode cert.' },
  { key: 'ios-build', category: 'Platform builds', label: 'iOS build produced', detail: 'Capacitor iOS app built in Xcode with a signing identity.' },
  { key: 'android-build', category: 'Platform builds', label: 'Android build produced', detail: 'Capacitor Android app built with a signing keystore.' },
  { key: 'tests-passed', category: 'Quality', label: 'Automated tests passed on this commit', detail: 'Unit + E2E suites green for the release commit.' },
  { key: 'native-storage', category: 'Native', label: 'Native durable storage verified on device', detail: 'FileStore round-trip verified; no plaintext clinical data on disk.' },
  { key: 'native-keystore', category: 'Native', label: 'OS key storage / device unlock verified', detail: 'Device unlock works; wiping the OS key forces passphrase unlock.' },
  { key: 'backup-restore', category: 'Data', label: 'Backup & restore verified on device', detail: 'Encrypted backup + integrity-checked restore tested on the target platform.' },
  { key: 'device-testing', category: 'Testing', label: 'Real-device test checklist completed', detail: 'docs/phase8/DEVICE_TESTING.md completed for each target platform.' },
  { key: 'beta-testing', category: 'Testing', label: 'Beta testing round completed', detail: 'Guided beta checklist run with fictional/de-identified data; bugs triaged.' },
  { key: 'security-review', category: 'Reviews', label: 'Independent security review completed', detail: 'Encryption/storage/key-management reviewed by a qualified reviewer.' },
  { key: 'legal-review', category: 'Reviews', label: 'Legal / HIPAA review completed', detail: 'Counsel review of safeguards, consent/disclosure, and jurisdiction requirements.' },
];
