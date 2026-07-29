import { Icon } from './Icon';

/**
 * Permanent banner for the public web deployment (GitHub Pages).
 *
 * Distinct from `BetaBanner`, which a clinician turns on and off: this one is
 * baked in at build time (`__PUBLIC_DEMO__`) and cannot be dismissed, because
 * anyone can reach the public URL without having read a word of documentation.
 * It renders only in the Pages build — local, native and test builds are
 * unaffected.
 */
export const PUBLIC_DEMO_NOTICE =
  'Public demonstration build — use fictional or fully de-identified data only. ' +
  'This build is NOT approved for real client information (PHI). Everything you ' +
  'enter stays encrypted in this browser on this device and is never uploaded.';

export function PublicDemoBanner() {
  if (!__PUBLIC_DEMO__) return null;
  return (
    <div className="public-demo-banner" role="alert">
      <Icon name="alert" size={15} />
      <span>{PUBLIC_DEMO_NOTICE}</span>
    </div>
  );
}
