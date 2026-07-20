import { Badge } from './ui';
import { useAiStore } from '../../state/aiStore';

/**
 * Honest local/offline/online processing indicator (Phase 6 UX). Reflects the
 * ACTIVE AI mode and whether the emergency kill switch is engaged — never
 * claims online unless online mode is genuinely active and connected.
 */
export function ProcessingStatusBadge() {
  const settings = useAiStore((s) => s.settings);
  const activeReady = useAiStore((s) => s.activeReady);

  if (settings.onlineKillSwitch) {
    return <Badge tone="red" icon="shield">Online disabled (kill switch)</Badge>;
  }
  if (settings.activeProviderType === 'online' && activeReady) {
    return <Badge tone="amber" icon="upload">Online AI — sends leave device</Badge>;
  }
  if (settings.activeProviderType === 'local' && activeReady) {
    return <Badge tone="blue" icon="shield">Local AI — on this device</Badge>;
  }
  return <Badge tone="green" icon="shield">Local-only</Badge>;
}
