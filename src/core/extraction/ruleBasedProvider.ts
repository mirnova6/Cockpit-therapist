/**
 * Deterministic rule-based extractor.
 *
 * Detects only clearly structured information — assessment scores, medication
 * mentions with doses, diagnosis codes/phrases, explicit risk keywords,
 * quoted client statements, recognizable BPS-style headings, and a small
 * fixed symptom lexicon. It performs NO semantic inference and never claims
 * to understand nuanced psychological content; that is a future AI provider's
 * job, and results are labeled accordingly.
 *
 * The extractor is a pure function: input text can never trigger actions,
 * only produce inert proposal data for clinician review.
 */
import { ASSESSMENT_DEFINITIONS } from '../assessments/definitions';
import type { ClinicalInput } from '../db/schema';
import type { SourceClassification } from '../db/structuredSchema';
import type {
  ExtractionProvider,
  ExtractionResult,
  ProposedFact,
  ProposedItem,
} from './types';

const CAPABILITY_NOTE =
  'Deterministic pattern matching only: assessment scores, medications with doses, ' +
  'diagnosis codes/phrases, explicit risk keywords, quoted statements, BPS headings, and ' +
  'a fixed symptom vocabulary. It does not interpret meaning, context, or nuance — ' +
  'no AI model is connected.';

// ------------------------------------------------------------ helpers

function lineNumberOf(text: string, index: number): string {
  return `line ${text.slice(0, index).split('\n').length}`;
}

/** The sentence containing the match, trimmed for display. */
function sentenceAround(text: string, index: number, matchLength: number): string {
  const boundary = /[.!?\n]/;
  let start = index;
  while (start > 0 && !boundary.test(text[start - 1])) start--;
  let end = index + matchLength;
  while (end < text.length && !boundary.test(text[end])) end++;
  return text
    .slice(start, Math.min(end + 1, text.length))
    .trim()
    .slice(0, 300);
}

function defaultClassification(input: ClinicalInput): SourceClassification {
  if (input.inputType === 'client-quote') return 'client-report';
  if (input.inputType === 'therapist-observation') return 'therapist-observation';
  if (
    input.inputType === 'bps' ||
    input.inputType === 'prior-treatment-plan' ||
    input.inputType === 'discharge-info' ||
    input.inputType === 'uploaded-document'
  ) {
    return 'prior-documentation';
  }
  if (input.reportedBy === 'client-reported') return 'client-report';
  if (input.reportedBy === 'collateral') return 'collateral';
  return 'therapist-observation';
}

// ------------------------------------------------------------ patterns

/** "PHQ-9: 18", "PHQ-9 score of 18", "scored 18 on the PHQ-9", "GAD-7 = 12" */
function extractAssessmentScores(text: string): ProposedItem[] {
  const items: ProposedItem[] = [];
  for (const def of ASSESSMENT_DEFINITIONS) {
    if (def.entry !== 'total') continue;
    const nameAlt = def.label.replace(/-/g, '[-\\s]?');
    const patterns = [
      new RegExp(`\\b${nameAlt}\\b[^\\d\\n]{0,20}?(\\d{1,3})\\b`, 'gi'),
      new RegExp(`\\bscored?\\s+(\\d{1,3})\\s+on\\s+(?:the\\s+)?${nameAlt}\\b`, 'gi'),
    ];
    const seen = new Set<number>();
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const score = Number(match[1]);
        if (Number.isNaN(score) || seen.has(score)) continue;
        if (def.min !== undefined && score < def.min) continue;
        if (def.max !== undefined && score > def.max) continue;
        seen.add(score);
        items.push({
          kind: 'assessment-score',
          definitionKey: def.key,
          name: def.label,
          totalScore: score,
          excerpt: sentenceAround(text, match.index ?? 0, match[0].length),
          sourceLocation: lineNumberOf(text, match.index ?? 0),
          confidence: 'high',
        });
      }
    }
  }
  return items;
}

/** "Sertraline 50mg daily", "lithium 300 mg", "started Prazosin 1mg" */
function extractMedications(text: string, classification: SourceClassification): ProposedFact[] {
  const facts: ProposedFact[] = [];
  const pattern = /\b([A-Z][a-zA-Z]{3,})\s+(\d+(?:\.\d+)?)\s?(mg|mcg|g|ml|units?)\b/g;
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const key = `${match[1].toLowerCase()}-${match[2]}${match[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      kind: 'fact',
      category: 'medication',
      statement: `${match[1]} ${match[2]} ${match[3]}`,
      excerpt: sentenceAround(text, match.index ?? 0, match[0].length),
      sourceLocation: lineNumberOf(text, match.index ?? 0),
      classification: classification === 'client-report' ? 'client-report' : 'medication-record',
      confidence: 'high',
      riskRelated: false,
    });
  }
  return facts;
}

/** ICD-10 F-codes and explicit "diagnosed with …" phrases. */
function extractDiagnoses(text: string): ProposedFact[] {
  const facts: ProposedFact[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(/\bF\d{2}(?:\.\d{1,2})?\b/g)) {
    const code = match[0];
    if (seen.has(code)) continue;
    seen.add(code);
    facts.push({
      kind: 'fact',
      category: 'diagnosis',
      statement: `Diagnosis code documented: ${code}`,
      excerpt: sentenceAround(text, match.index ?? 0, code.length),
      sourceLocation: lineNumberOf(text, match.index ?? 0),
      classification: 'documented-diagnosis',
      confidence: 'high',
      riskRelated: false,
    });
  }

  const phrase = /\b(?:diagnos(?:ed with|is(?: of)?:?)|meets criteria for)\s+([A-Za-z][A-Za-z\s,-]{3,60}?)(?=[.;\n]|$)/gi;
  for (const match of text.matchAll(phrase)) {
    const label = match[1].trim();
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({
      kind: 'fact',
      category: 'diagnosis',
      statement: `Documented diagnosis: ${label}`,
      excerpt: sentenceAround(text, match.index ?? 0, match[0].length),
      sourceLocation: lineNumberOf(text, match.index ?? 0),
      classification: 'documented-diagnosis',
      confidence: 'moderate',
      riskRelated: false,
    });
  }
  return facts;
}

/** Explicit risk keywords → always risk-related, never bulk-approvable. */
const RISK_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bsuicid\w*/gi, label: 'suicide-related language' },
  { pattern: /\bself[-\s]?harm\w*/gi, label: 'self-harm language' },
  { pattern: /\bkill (?:myself|himself|herself|themselves)\b/gi, label: 'self-directed lethality language' },
  { pattern: /\bkill (?:him|her|them|someone)\b/gi, label: 'other-directed lethality language' },
  { pattern: /\bhomicid\w*/gi, label: 'homicide-related language' },
  { pattern: /\boverdose\w*/gi, label: 'overdose language' },
  { pattern: /\bcutting\b/gi, label: 'possible self-injury language' },
  { pattern: /\bno reason to live\b/gi, label: 'hopelessness statement' },
  { pattern: /\bhopeless\w*/gi, label: 'hopelessness language' },
  { pattern: /\babus(?:e|ed|ive)\b/gi, label: 'abuse-related language' },
  { pattern: /\bneglect\w*/gi, label: 'neglect-related language' },
  { pattern: /\bviolen\w*/gi, label: 'violence-related language' },
];

/**
 * Context qualifiers for risk keywords. Keyword matching cannot confirm
 * current client risk: "denies suicidal ideation", "history of suicidal
 * ideation", and "family member attempted suicide" all contain the same
 * keyword with very different meanings. Every match is therefore labeled a
 * POSSIBLE risk-related mention with the detected context, stays
 * risk-related (individual review only), and is never worded as confirmed.
 */
function riskContextQualifier(sentence: string, matchStart: number): string {
  const before = sentence.slice(0, Math.max(0, matchStart)).toLowerCase();
  // Negation must sit within a few words BEFORE the keyword ("denies SI",
  // "no current suicidal ideation") — "SI without plan" is NOT a denial.
  const negationNear =
    /\b(denies|denied|denying|no|without|never|negative for|not|reports? no|does not endorse|not endorsing)\s+(?:[\w-]+\s+){0,3}$/;
  if (negationNear.test(before)) {
    return 'text suggests denial or negation';
  }
  if (/\b(history of|hx of|previously|prior|in the past|years ago|as a (child|teen|teenager)|when (he|she|they) (was|were) (young|a child|a teenager))\b/i.test(sentence)) {
    return 'text suggests a historical reference';
  }
  if (/\b(mother|father|mom|dad|parent|brother|sister|sibling|son|daughter|uncle|aunt|grandmother|grandfather|cousin|friend|partner|husband|wife|spouse|roommate|coworker|family member)(['’]s)?\b/.test(before)) {
    return 'text may refer to a third party, not the client';
  }
  return 'context not determined by pattern matching';
}

function extractRiskStatements(text: string, classification: SourceClassification): ProposedFact[] {
  const facts: ProposedFact[] = [];
  const seenSentences = new Set<string>();
  for (const { pattern, label } of RISK_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const sentence = sentenceAround(text, match.index ?? 0, match[0].length);
      if (seenSentences.has(sentence)) continue;
      seenSentences.add(sentence);
      const idxInSentence = sentence.toLowerCase().indexOf(match[0].toLowerCase());
      const qualifier = riskContextQualifier(sentence, Math.max(0, idxInSentence));
      facts.push({
        kind: 'fact',
        category: 'risk-factor',
        statement:
          `Possible risk-related mention (${label}; ${qualifier}) — ` +
          `requires contextual clinician review, not a confirmed current risk: "${sentence}"`,
        excerpt: sentence,
        sourceLocation: lineNumberOf(text, match.index ?? 0),
        classification,
        confidence: 'moderate',
        riskRelated: true,
      });
    }
  }
  return facts;
}

/** Quoted client statements: “…” or "..." of reasonable length. */
function extractQuotes(text: string): ProposedFact[] {
  const facts: ProposedFact[] = [];
  const pattern = /[“"]([^”"\n]{12,240})[”"]/g;
  const seen = new Set<string>();
  for (const match of text.matchAll(pattern)) {
    const quote = match[1].trim();
    if (seen.has(quote)) continue;
    seen.add(quote);
    facts.push({
      kind: 'fact',
      category: 'other',
      statement: `Client statement: “${quote}”`,
      excerpt: match[0],
      sourceLocation: lineNumberOf(text, match.index ?? 0),
      classification: 'client-report',
      confidence: 'high',
      riskRelated: RISK_PATTERNS.some(({ pattern: p }) => new RegExp(p.source, 'i').test(quote)),
    });
  }
  return facts;
}

/**
 * Recognized BPS-style section headings → categorized section summaries.
 * `(?::|$)` requires a colon or end-of-line after the heading phrase so body
 * text that merely starts with a heading word ("Sleeps 4-5 hours…") never
 * counts as a heading.
 */
const HEADING_MAP: Array<{ pattern: RegExp; category: ProposedFact['category'] }> = [
  { pattern: /^(presenting (problem|concerns?)|chief complaint)\s*(?::|$)/i, category: 'presenting-problem' },
  { pattern: /^(sleep)\s*(?::|$)/i, category: 'sleep' },
  { pattern: /^(appetite)\s*(?::|$)/i, category: 'appetite' },
  { pattern: /^(medical (history|conditions?)|health history)\s*(?::|$)/i, category: 'medical-factor' },
  { pattern: /^(medications?|current medications?)\s*(?::|$)/i, category: 'medication' },
  { pattern: /^(diagnos[ei]s|diagnostic impressions?)\s*(?::|$)/i, category: 'diagnosis' },
  { pattern: /^(substance (use|abuse)( history)?|alcohol and drug use)\s*(?::|$)/i, category: 'substance-use' },
  { pattern: /^(trauma( history)?)\s*(?::|$)/i, category: 'trauma' },
  { pattern: /^(family (history|background|dynamics))\s*(?::|$)/i, category: 'family-factor' },
  { pattern: /^(developmental history)\s*(?::|$)/i, category: 'developmental-factor' },
  { pattern: /^(strengths?)\s*(?::|$)/i, category: 'strength' },
  { pattern: /^(risk( factors?| assessment)?)\s*(?::|$)/i, category: 'risk-factor' },
  { pattern: /^(protective factors?)\s*(?::|$)/i, category: 'protective-factor' },
  { pattern: /^(cultural (factors?|background|considerations?))\s*(?::|$)/i, category: 'cultural-factor' },
  { pattern: /^(treatment goals?)\s*(?::|$)/i, category: 'treatment-goal' },
];

function extractSections(text: string, classification: SourceClassification): ProposedFact[] {
  const facts: ProposedFact[] = [];
  const lines = text.split('\n');
  const headings: Array<{
    lineIdx: number;
    category: ProposedFact['category'];
    heading: string;
    inlineBody: string;
  }> = [];
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > 80) return;
    for (const { pattern, category } of HEADING_MAP) {
      const match = trimmed.match(pattern);
      if (match) {
        headings.push({
          lineIdx: idx,
          category,
          heading: match[0].replace(/:$/, '').trim(),
          // "Heading: inline content" keeps the same-line remainder as body.
          inlineBody: trimmed.slice(match[0].length).trim(),
        });
        break;
      }
    }
  });
  headings.forEach((h, i) => {
    const followingLines = lines.slice(h.lineIdx + 1, headings[i + 1]?.lineIdx ?? lines.length);
    const body = [h.inlineBody, ...followingLines].join('\n').trim();
    if (!body) return;
    const summary = body.replace(/\s+/g, ' ').slice(0, 280);
    facts.push({
      kind: 'fact',
      category: h.category,
      statement: `${h.heading}: ${summary}${body.length > 280 ? '…' : ''}`,
      excerpt: body.slice(0, 400),
      sourceLocation: `section “${h.heading}” (line ${h.lineIdx + 1})`,
      classification,
      confidence: 'high',
      riskRelated: h.category === 'risk-factor',
    });
  });
  return facts;
}

/** Fixed symptom lexicon → categorized sentence-level proposals. */
const SYMPTOM_LEXICON: Array<{ pattern: RegExp; category: ProposedFact['category']; label: string }> = [
  { pattern: /\binsomnia\b|\btrouble (falling|staying) asleep\b|\bcan'?t sleep\b/gi, category: 'sleep', label: 'sleep disturbance' },
  { pattern: /\bnightmares?\b/gi, category: 'trauma', label: 'nightmares' },
  { pattern: /\bflashbacks?\b/gi, category: 'trauma', label: 'flashbacks' },
  { pattern: /\bhypervigilan\w*/gi, category: 'trauma', label: 'hypervigilance' },
  { pattern: /\banhedonia\b|\blost interest\b|\bno interest\b/gi, category: 'mood', label: 'anhedonia / loss of interest' },
  { pattern: /\bpanic attacks?\b/gi, category: 'anxiety', label: 'panic attacks' },
  { pattern: /\bexcessive worry\b|\bconstant worry\b|\bworr(?:ies|ying) constantly\b/gi, category: 'anxiety', label: 'excessive worry' },
  { pattern: /\bpoor appetite\b|\bloss of appetite\b|\bnot eating\b/gi, category: 'appetite', label: 'appetite disturbance' },
  { pattern: /\bfatigue\b|\blow energy\b|\bexhausted\b/gi, category: 'energy', label: 'fatigue / low energy' },
  { pattern: /\bdifficulty concentrating\b|\bcan'?t concentrate\b|\bpoor concentration\b/gi, category: 'cognition', label: 'concentration difficulty' },
  { pattern: /\btearful\w*/gi, category: 'mood', label: 'tearfulness' },
  { pattern: /\birritab\w*/gi, category: 'mood', label: 'irritability' },
  { pattern: /\bdissociat\w*/gi, category: 'dissociation', label: 'dissociative experience' },
  { pattern: /\bcravings?\b/gi, category: 'craving', label: 'cravings' },
  { pattern: /\bwithdrawal symptoms?\b|\bdetox\w*/gi, category: 'withdrawal', label: 'withdrawal' },
  { pattern: /\brelapse\w*/gi, category: 'relapse-trigger', label: 'relapse-related content' },
];

function extractSymptoms(text: string, classification: SourceClassification): ProposedFact[] {
  const facts: ProposedFact[] = [];
  const seen = new Set<string>();
  for (const { pattern, category, label } of SYMPTOM_LEXICON) {
    for (const match of text.matchAll(pattern)) {
      const sentence = sentenceAround(text, match.index ?? 0, match[0].length);
      const key = `${category}:${sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        kind: 'fact',
        category,
        statement: `Documented mention of ${label}: "${sentence}"`,
        excerpt: sentence,
        sourceLocation: lineNumberOf(text, match.index ?? 0),
        classification,
        confidence: 'moderate',
        riskRelated: false,
      });
    }
  }
  return facts;
}

// ------------------------------------------------------------ provider

export const ruleBasedProvider: ExtractionProvider = {
  id: 'rule-based',
  label: 'Rule-Based Extraction (deterministic)',
  capabilityNote: CAPABILITY_NOTE,

  extract(input: ClinicalInput): ExtractionResult {
    const text = input.rawText ?? '';
    const classification = defaultClassification(input);
    const items: ProposedItem[] = [];

    if (text.trim().length > 0) {
      items.push(...extractAssessmentScores(text));
      items.push(...extractSections(text, classification));
      items.push(...extractMedications(text, classification));
      items.push(...extractDiagnoses(text));
      items.push(...extractRiskStatements(text, classification));
      items.push(...extractQuotes(text));
      items.push(...extractSymptoms(text, classification));
    }

    // Deduplicate identical statements across rules.
    const seen = new Set<string>();
    const deduped = items.filter((item) => {
      const key =
        item.kind === 'fact'
          ? `f:${item.category}:${item.statement}`
          : `a:${item.definitionKey}:${item.totalScore}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      providerId: this.id,
      providerLabel: this.label,
      capabilityNote: this.capabilityNote,
      items: deduped,
    };
  },
};
