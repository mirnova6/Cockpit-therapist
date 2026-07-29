import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { Icon } from '../../app/components/Icon';
import { Badge, Card } from '../../app/components/ui';
import { ConsentRefusedError } from '../../core/ai/aiGateway';
import type { AssistantMessage } from '../../core/db/intelligenceSchema';
import { fmtDate } from '../../lib/format';
import { useAiStore } from '../../state/aiStore';
import { useIntelligenceStore } from '../../state/intelligenceStore';
import type { ClientContext } from '../dashboard/ClientDashboardLayout';
import {
  BasisBadge,
  ConfidenceLevelBadge,
  FeedbackBar,
  GenerationStamp,
  RetrievalDebugPanel,
} from './shared';

const SUGGESTED_QUESTIONS = [
  'What has changed since the last session?',
  'What themes repeat across sessions?',
  'What supports the current formulation?',
  'What contradicts the current formulation?',
  'What treatment goals are progressing and which appear stalled?',
  'What risk-related information has changed?',
  'What should I assess next?',
];

function AssistantAnswerView({ message, clientId }: { message: AssistantMessage; clientId: string }) {
  const answer = message.answer;
  if (!answer) return <p className="small prewrap">{message.text}</p>;
  return (
    <div className="stack-sm">
      {message.generation && <GenerationStamp generation={message.generation} />}
      {answer.insufficientEvidence && (
        <Badge tone="neutral" icon="info">Insufficient documented evidence</Badge>
      )}
      {answer.blocks.map((block, i) => (
        <div key={i}>
          <div className="cluster" style={{ gap: 6 }}>
            <BasisBadge basis={block.basis} />
            {block.citedRefs.length > 0 && (
              <span className="muted small">cites {block.citedRefs.join(', ')}</span>
            )}
          </div>
          <p className="small prewrap" style={{ margin: '4px 0' }}>{block.text}</p>
        </div>
      ))}

      <div className="cluster" style={{ gap: 8 }}>
        <ConfidenceLevelBadge level={answer.confidence} />
      </div>

      {answer.contradictions.length > 0 && (
        <div className="notice notice--warn" style={{ display: 'block' }}>
          <strong className="small"><Icon name="alert" size={14} /> Contradictory evidence retrieved:</strong>
          <ul className="small" style={{ margin: '4px 0 0' }}>
            {answer.contradictions.map((c) => (
              <li key={c.ref}>
                {c.label} ({c.date ? fmtDate(c.date) : 'undated'}): “{c.excerpt.slice(0, 160)}”
              </li>
            ))}
          </ul>
        </div>
      )}

      <details>
        <summary className="small" style={{ cursor: 'pointer' }}>
          Client evidence used ({answer.clientEvidence.length})
        </summary>
        <ul className="small" style={{ margin: '6px 0' }}>
          {answer.clientEvidence.map((c) => (
            <li key={c.ref}>
              <strong>{c.ref}</strong> {c.label} · {c.date ? fmtDate(c.date) : 'undated'} · {c.approvalStatus}
              {c.refType === 'input' && (
                <>
                  {' '}·{' '}
                  <Link to={`/clients/${clientId}/inputs/${c.refId}?highlight=${encodeURIComponent(c.excerpt.slice(0, 80))}`}>
                    open source
                  </Link>
                </>
              )}
              <br />
              <span className="muted prewrap">“{c.excerpt.slice(0, 200)}{c.excerpt.length > 200 ? '…' : ''}”</span>
            </li>
          ))}
        </ul>
      </details>

      {answer.knowledgeUsed.length > 0 && (
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>
            Clinical knowledge used ({answer.knowledgeUsed.length})
          </summary>
          <ul className="small" style={{ margin: '6px 0' }}>
            {answer.knowledgeUsed.map((k, i) => (
              <li key={i}>
                <strong>{k.title}</strong> — {k.citation}{k.section ? ` · ${k.section}` : ''}{k.page ? ` · p. ${k.page}` : ''}
                <br />
                <span className="muted prewrap">“{k.passage.slice(0, 200)}…”</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {message.retrievalDebug && <RetrievalDebugPanel debug={message.retrievalDebug} />}

      {answer.followUpQuestions.length > 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Follow-ups to consider: {answer.followUpQuestions.join(' · ')}
        </p>
      )}

      {answer.suggestedActions.length > 0 && (
        <div className="cluster" style={{ gap: 6 }}>
          {answer.suggestedActions.map((action) => (
            <Link key={action.route} className="btn btn--secondary btn--sm" to={action.route}>
              {action.label}
            </Link>
          ))}
        </div>
      )}
      <FeedbackBar clientId={clientId} targetType="assistant-answer" targetId={message.id} operationId={message.generation?.operationId} />
    </div>
  );
}

export function AssistantTab() {
  const { client } = useOutletContext<ClientContext>();
  const data = useIntelligenceStore((s) => s.byClient[client.id]);
  const loadClient = useIntelligenceStore((s) => s.loadClient);
  const ask = useIntelligenceStore((s) => s.ask);
  const clearThread = useIntelligenceStore((s) => s.clearThread);
  const aiSettings = useAiStore((s) => s.settings);
  const activeReady = useAiStore((s) => s.activeReady);
  const setOnlineConfirmed = useAiStore((s) => s.setOnlineConfirmed);

  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string>();
  const [onlineConfirmChecked, setOnlineConfirmChecked] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const isOnline = aiSettings.activeProviderType === 'online' && activeReady;
  const messages = data?.assistantMessages ?? [];

  useEffect(() => {
    void loadClient(client.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const submit = async (text?: string) => {
    const q = (text ?? question).trim();
    if (!q || asking) return;
    setAsking(true);
    setError(undefined);
    if (isOnline) setOnlineConfirmed(onlineConfirmChecked);
    try {
      await ask(client.id, q, isOnline ? onlineConfirmChecked : undefined);
      setQuestion('');
    } catch (err) {
      setError(
        err instanceof ConsentRefusedError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'The assistant could not answer.',
      );
    } finally {
      setOnlineConfirmed(false);
      setAsking(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 940 }}>
      <Card title={`Clinical assistant — ${client.displayName} only`} icon="search">
        <div className="stack-sm">
          <p className="muted small" style={{ margin: 0 }}>
            Answers use only this client's authorized record (plus your approved knowledge library), always with
            citations, and the assistant cannot approve, modify, delete, or export anything — every action stays
            with you.
            {aiSettings.activeProviderType === 'deterministic' || !activeReady
              ? ' No AI model is connected, so answers are retrieval-based and labeled as such.'
              : aiSettings.activeProviderType === 'local'
                ? ' Processing runs on your local model; nothing leaves this device.'
                : ' Online mode is active — each question sends retrieved excerpts to the configured provider after your confirmation.'}
          </p>
          <div className="cluster" style={{ gap: 6, flexWrap: 'wrap' }}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button key={q} className="btn btn--secondary btn--sm" disabled={asking} onClick={() => void submit(q)}>
                {q}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="stack">
        {messages.map((message) => (
          <Card key={message.id}>
            <div className="stack-sm">
              <div className="cluster">
                <Badge tone={message.role === 'clinician' ? 'blue' : 'plum'} icon={message.role === 'clinician' ? 'user' : 'search'}>
                  {message.role === 'clinician' ? 'You' : 'Assistant'}
                </Badge>
                <span className="muted small">{fmtDate(message.at.slice(0, 10))}</span>
              </div>
              {message.role === 'clinician' ? (
                <p className="small prewrap" style={{ margin: 0 }}>{message.text}</p>
              ) : (
                <AssistantAnswerView message={message} clientId={client.id} />
              )}
            </div>
          </Card>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" size={15} />
          <span className="small">{error}</span>
        </div>
      )}

      <Card>
        <div className="stack-sm">
          {isOnline && (
            <label className="cluster small" style={{ gap: 8 }}>
              <input
                type="checkbox"
                checked={onlineConfirmChecked}
                onChange={(e) => setOnlineConfirmChecked(e.target.checked)}
              />
              I confirm that record excerpts retrieved for this question may be sent to {aiSettings.onlineModel} (online provider).
            </label>
          )}
          <div className="cluster">
            <textarea
              className="textarea"
              style={{ minHeight: 60, flex: 1 }}
              placeholder="Ask about this client… (e.g. What appears to increase engagement?)"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
              }}
            />
            <button
              className="btn btn--primary"
              disabled={asking || !question.trim() || (isOnline && !onlineConfirmChecked)}
              onClick={() => void submit()}
            >
              <Icon name="search" size={15} /> {asking ? 'Answering…' : 'Ask'}
            </button>
          </div>
          {messages.length > 0 && (
            <button className="btn btn--ghost btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => void clearThread(client.id)}>
              <Icon name="trash" size={13} /> Clear conversation (kept encrypted until cleared)
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
