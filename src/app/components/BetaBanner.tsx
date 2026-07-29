import { Link } from 'react-router-dom';
import { BETA_BANNER } from '../../core/beta/betaSchema';
import { useBetaStore } from '../../state/betaStore';
import { Icon } from './Icon';

/**
 * Global beta banner (Phase 8). Shown on every screen while beta mode is on.
 * States plainly that only fictional/de-identified data may be used and that
 * real PHI remains blocked by the Real PHI Readiness Gate.
 */
export function BetaBanner() {
  const enabled = useBetaStore((s) => s.state?.enabled);
  if (!enabled) return null;
  return (
    <div className="beta-banner" role="status">
      <Icon name="alert" size={15} />
      <span>{BETA_BANNER}</span>
      <Link to="/beta" className="beta-banner__link">Beta tools</Link>
    </div>
  );
}
