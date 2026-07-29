import { describe, expect, it } from 'vitest';
import { redactText } from './redaction';
import { deterministicVerifier, type VerificationContext } from './verification';

const context: VerificationContext = {
  clientId: 'c1',
  evidence: [
    {
      ref: 'E1',
      refType: 'fact',
      refId: 'f1',
      clientId: 'c1',
      text: 'Client reports avoiding contact with family due to anticipated criticism.',
    },
    {
      ref: 'E2',
      refType: 'hypothesis',
      refId: 'h1',
      clientId: 'c1',
      text: 'HYPOTHESIS: Avoidance may function as protection against shame or rejection.',
    },
    {
      ref: 'E3',
      refType: 'fact',
      refId: 'f2',
      clientId: 'OTHER-CLIENT',
      text: 'Client reports avoiding contact with family due to anticipated criticism.',
    },
  ],
  knowledge: [
    {
      ref: 'K1',
      sourceId: 's1',
      chunkId: 'ch1',
      title: 'MI Manual',
      citation: 'Miller & Rollnick (2013)',
      text: 'Motivational interviewing works with ambivalence by developing discrepancy between behavior and values.',
    },
  ],
  contradictions: [
    { ref: 'C1', text: 'CONTRADICTION on alcohol use: client reported abstinence but a later note documents alcohol use.' },
  ],
};

async function verdictOf(text: string, refs: string[], kind: 'factual' | 'interpretive' | 'therapist-authored' | 'template' = 'factual') {
  const [verdict] = await deterministicVerifier.verify([{ id: 'x', text, citedRefs: refs, kind }], context);
  return verdict;
}

describe('deterministic claim verification — all seven statuses', () => {
  it('directly supported', async () => {
    const verdict = await verdictOf('Client avoids contact with family, anticipating criticism.', ['E1']);
    expect(verdict.status).toBe('directly-supported');
    expect(verdict.verifiedRefs).toContain('E1');
  });

  it('supported by approved hypothesis — never presented as fact support', async () => {
    const verdict = await verdictOf('Avoidance may function as protection against shame.', ['E2']);
    expect(verdict.status).toBe('supported-by-hypothesis');
    expect(verdict.note).toContain('not established fact');
  });

  it('general clinical guidance from knowledge only', async () => {
    const verdict = await verdictOf('Motivational interviewing can develop discrepancy when ambivalence is present.', ['K1']);
    expect(verdict.status).toBe('general-clinical-guidance');
  });

  it('therapist authored', async () => {
    const verdict = await verdictOf('I will follow up next session.', [], 'therapist-authored');
    expect(verdict.status).toBe('therapist-authored');
  });

  it('unsupported when nothing is cited', async () => {
    const verdict = await verdictOf('Client shows borderline traits.', []);
    expect(verdict.status).toBe('unsupported');
  });

  it('needs clarification when the citation does not actually support the claim', async () => {
    const verdict = await verdictOf('Client started new blood-pressure medication yesterday.', ['E1']);
    expect(verdict.status).toBe('needs-clarification');
  });

  it('contradicted when retrieved contradictory evidence touches the claim', async () => {
    const verdict = await verdictOf('Client has maintained complete abstinence from alcohol use.', ['E1']);
    expect(verdict.status).toBe('contradicted');
    expect(verdict.note).toContain('C1');
  });

  it('citations of another client’s evidence are treated as unverifiable', async () => {
    const verdict = await verdictOf('Client avoids contact with family, anticipating criticism.', ['E3']);
    expect(verdict.status).not.toBe('directly-supported');
    expect(verdict.verifiedRefs).not.toContain('E3');
  });

  it('the verifier is a separate component with a swappable interface', () => {
    // The generator never verifies itself: verification goes through the
    // ClaimVerifier interface, so a different provider can implement it.
    expect(deterministicVerifier.id).toBe('deterministic-verifier');
    expect(typeof deterministicVerifier.verify).toBe('function');
  });
});

describe('redaction', () => {
  it('replaces names, phones, emails, and addresses — and reports what it did', () => {
    const result = redactText(
      'Maya Novak (maya@example.com, 555-123-4567) lives at 12 Oak Street. DOB: 01/02/1990.',
      { knownNames: ['Maya Novak'] },
    );
    expect(result.text).not.toContain('Maya Novak');
    expect(result.text).not.toContain('maya@example.com');
    expect(result.text).not.toContain('555-123-4567');
    expect(result.text).not.toContain('12 Oak Street');
    expect(result.text).toContain('[CLIENT]');
    expect(result.text).toContain('[EMAIL]');
    expect(result.text).toContain('[PHONE]');
    expect(result.text).toContain('[ADDRESS]');
    expect(result.replacements.length).toBeGreaterThanOrEqual(4);
  });
});
