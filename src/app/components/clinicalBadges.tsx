/**
 * Shared Phase 2 badges. Every status is communicated with a text label and
 * icon in addition to color (accessibility requirement).
 */
import {
  classificationLabel,
  EXTRACTION_METHOD_LABELS,
  reviewStatusLabel,
  type ExtractionConfidence,
  type ExtractionMethod,
  type HypothesisConfidence,
  type ReviewStatus,
  type SourceClassification,
} from '../../core/db/structuredSchema';
import { HYPOTHESIS_CONFIDENCES } from '../../core/db/structuredSchema';
import { Badge, type BadgeTone } from './ui';

const REVIEW_TONE: Record<ReviewStatus, { tone: BadgeTone; icon: string }> = {
  'pending': { tone: 'amber', icon: 'clock' },
  'approved': { tone: 'green', icon: 'check' },
  'edited': { tone: 'green', icon: 'edit' },
  'rejected': { tone: 'red', icon: 'x' },
  'needs-clarification': { tone: 'plum', icon: 'info' },
  'superseded': { tone: 'neutral', icon: 'archive' },
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const { tone, icon } = REVIEW_TONE[status];
  return (
    <Badge tone={tone} icon={icon}>
      {reviewStatusLabel(status)}
    </Badge>
  );
}

export function ClassificationBadge({ value }: { value: SourceClassification }) {
  return (
    <Badge tone={value === 'needs-source-clarification' ? 'plum' : 'blue'} icon="user">
      {classificationLabel(value)}
    </Badge>
  );
}

export function MethodBadge({ method }: { method: ExtractionMethod }) {
  return (
    <Badge tone={method === 'manual' ? 'neutral' : 'plum'} icon={method === 'manual' ? 'edit' : 'list'}>
      {EXTRACTION_METHOD_LABELS[method]}
    </Badge>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: ExtractionConfidence }) {
  const tone: BadgeTone = confidence === 'high' ? 'green' : confidence === 'moderate' ? 'amber' : 'neutral';
  return (
    <Badge tone={tone} icon="activity">
      Match confidence: {confidence}
    </Badge>
  );
}

export function HypothesisConfidenceBadge({ confidence }: { confidence: HypothesisConfidence }) {
  const label = HYPOTHESIS_CONFIDENCES.find((c) => c.value === confidence)?.label ?? confidence;
  const tone: BadgeTone =
    confidence === 'strong-support'
      ? 'green'
      : confidence === 'moderate-support'
        ? 'blue'
        : confidence === 'low-support'
          ? 'amber'
          : 'neutral';
  return (
    <Badge tone={tone} icon="activity">
      {label}
    </Badge>
  );
}

export function RiskFlagBadge({ label = 'Risk — individual review required' }: { label?: string }) {
  return (
    <Badge tone="red" icon="alert">
      {label}
    </Badge>
  );
}

export function TemporalBadge({ status }: { status: 'current' | 'historical' }) {
  return (
    <Badge tone={status === 'current' ? 'blue' : 'neutral'} icon="clock">
      {status === 'current' ? 'Current' : 'Historical'}
    </Badge>
  );
}
