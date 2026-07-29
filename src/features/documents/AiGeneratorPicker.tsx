/**
 * Generator picker shared by the DAP and treatment-plan creation screens:
 * choose between the deterministic template generator (always available)
 * and the AI Document Generator (listed only while a real provider is
 * connected). For online mode it shows exactly which selected content
 * leaves the device and requires explicit confirmation before generating.
 */
import { useMemo } from 'react';
import { Icon } from '../../app/components/Icon';
import { Field } from '../../app/components/ui';
import { REDACTION_DISCLAIMER, redactText } from '../../core/ai/redaction';
import type { SourceSelection } from '../../core/db/documentSchema';
import { AI_DOC_PROVIDER_ID } from '../../core/documents/aiDocProvider';
import {
  DEFAULT_DOCUMENT_PROVIDER_ID,
  listDocumentProviders,
} from '../../core/documents/providerRegistry';
import { useAiStore } from '../../state/aiStore';
import { useDataStore } from '../../state/dataStore';

export function AiGeneratorPicker({
  clientId,
  clientNames,
  selection,
  providerId,
  onProviderChange,
  onlineConfirmed,
  setOnlineConfirmed,
}: {
  clientId: string;
  clientNames: string[];
  selection: SourceSelection;
  providerId: string;
  onProviderChange: (id: string) => void;
  onlineConfirmed: boolean;
  setOnlineConfirmed: (v: boolean) => void;
}) {
  const aiSettings = useAiStore((s) => s.settings);
  const inputs = useDataStore((s) => s.inputs[clientId]) ?? [];

  const providers = listDocumentProviders();
  const aiRegistered = providers.some((p) => p.id === AI_DOC_PROVIDER_ID);
  const isAi = providerId === AI_DOC_PROVIDER_ID;
  const isOnline = isAi && aiSettings.activeProviderType === 'online';

  const selectedInputs = useMemo(
    () => inputs.filter((i) => selection.inputIds.includes(i.id)),
    [inputs, selection.inputIds],
  );
  const outbound = useMemo(() => {
    if (!isOnline) return [];
    return selectedInputs.map((input) => {
      const text = aiSettings.redactBeforeSend
        ? redactText(input.rawText, { knownNames: clientNames }).text
        : input.rawText;
      return { id: input.id, label: `${input.inputType} (${input.dateOfInformation})`, text };
    });
  }, [isOnline, selectedInputs, aiSettings.redactBeforeSend, clientNames]);

  return (
    <div className="stack-sm">
      <Field label="Generator">
        <select
          className="select"
          style={{ width: 'auto' }}
          value={providerId}
          onChange={(e) => {
            onProviderChange(e.target.value);
            setOnlineConfirmed(false);
          }}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id === AI_DOC_PROVIDER_ID
                ? `${p.label} — ${aiSettings.activeProviderType === 'online' ? 'online (leaves this device)' : 'local model'}`
                : `${p.label} (deterministic, on-device)`}
            </option>
          ))}
        </select>
      </Field>
      <p className="muted small" style={{ margin: 0 }}>
        {isAi
          ? 'The AI writes prose from your selected sources only; every sentence is then checked by a separate deterministic verifier and unverified content is flagged for you.'
          : aiRegistered
            ? 'Deterministic template generator — rule-based assembly, no model involved.'
            : 'Deterministic template generator — no AI model is connected. Configure one under Workspace settings → AI processing to add AI drafting.'}
      </p>

      {isOnline && (
        <div className="notice notice--warn" style={{ display: 'block' }}>
          <strong className="small">
            <Icon name="upload" size={14} /> Online generation sends your selected sources to {aiSettings.onlineModel} (Anthropic).
          </strong>
          <p className="small muted" style={{ margin: '6px 0' }}>
            That includes the selected entries below plus the selected facts, assessment summaries, hypotheses,
            and goals (statement text with excerpts).
            {aiSettings.redactBeforeSend ? ` ${REDACTION_DISCLAIMER}` : ''}
          </p>
          {outbound.length === 0 && (
            <p className="small muted" style={{ margin: '6px 0' }}>No raw entries selected — only structured statements will be sent.</p>
          )}
          {outbound.map((o) => (
            <details key={o.id}>
              <summary className="small" style={{ cursor: 'pointer' }}>{o.label}</summary>
              <div className="soft small prewrap" style={{ maxHeight: 140, overflowY: 'auto' }}>{o.text}</div>
            </details>
          ))}
          <label className="cluster small" style={{ marginTop: 8, gap: 8 }}>
            <input type="checkbox" checked={onlineConfirmed} onChange={(e) => setOnlineConfirmed(e.target.checked)} />
            I reviewed what will be sent and confirm the online generation.
          </label>
        </div>
      )}
    </div>
  );
}

export { AI_DOC_PROVIDER_ID, DEFAULT_DOCUMENT_PROVIDER_ID };
