import type { ReactNode } from 'react';
import { Icon } from '../../app/components/Icon';
import type { BadgeTone } from '../../app/components/ui';
import type { DocReviewStatus, GenerationInfo } from '../../core/db/documentSchema';

export function statusTone(status: DocReviewStatus): BadgeTone {
  switch (status) {
    case 'approved':
    case 'edited':
      return 'green';
    case 'draft':
    case 'pending-review':
      return 'amber';
    case 'rejected':
      return 'red';
    default:
      return 'neutral';
  }
}

/** Honest provenance banner shown on every generated document. */
export function GenerationBanner({ generation }: { generation: GenerationInfo }): ReactNode {
  return (
    <div className="notice notice--info" style={{ display: 'block' }}>
      <p className="small" style={{ margin: 0 }}>
        <Icon name="info" size={14} /> <strong>{generation.providerLabel}</strong> · generated{' '}
        {generation.generatedAt.slice(0, 10)}
      </p>
      <p className="small" style={{ margin: '4px 0 0' }}>{generation.disclosure}</p>
      {generation.warnings.length > 0 && (
        <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {generation.warnings.map((w, i) => (
            <li key={i}>
              <strong>{w.kind === 'risk' ? '⚠ ' : ''}{w.kind.replace(/-/g, ' ')}:</strong> {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
