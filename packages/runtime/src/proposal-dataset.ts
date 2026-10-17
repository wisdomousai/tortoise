import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJson, type Proposal } from '@agent-native/contracts';
import type { ExecutionContext, Invocation, QueryResult } from './types.js';

/**
 * Training data from people's decisions on proposals: what an agent proposed, and whether a
 * person accepted, rejected (with their reason) or let it expire. It is read through
 * `proposal.list` as the exporting caller, so it holds only proposals that caller may see, and
 * redaction is applied before the digest, so the digest names exactly what left the host.
 */

export const PROPOSAL_DATASET_FORMAT = 'agent-native/proposal-dataset@1';

export interface DatasetRedaction {
  /** Input fields to blank per proposed operation, as dotted paths, e.g. `{ 'lot.note': ['text'] }`. */
  readonly fields?: Readonly<Record<string, readonly string[]>>;
  /** Blank the agent's rationale, which can quote record contents. */
  readonly rationale?: boolean;
  /** Blank the person's rejection reason. */
  readonly reason?: boolean;
}

export interface ProposalDatasetRow {
  readonly id: string;
  readonly operation: string;
  readonly input: unknown;
  readonly rationale: string;
  readonly outcome: 'accepted' | 'rejected' | 'expired';
  readonly reason?: string;
  readonly confidence?: number;
  /** The proposer's own label for its model; the run's recorded identity is the trusted one. */
  readonly model?: string;
  readonly resource?: string;
  readonly runId?: string;
  readonly createdAt: number;
  readonly closedAt?: number;
}

export interface ProposalDataset {
  readonly format: typeof PROPOSAL_DATASET_FORMAT;
  /** `sha256:` over the canonical JSON lines of `rows`; a model entry names it as its dataset. */
  readonly digest: string;
  readonly exportedBy: string;
  readonly rows: readonly ProposalDatasetRow[];
  /** The redaction applied, so a reader knows which blanks are deliberate. */
  readonly redaction: DatasetRedaction;
}

export interface ExportOptions {
  /** Only proposals of these operations. */
  readonly operations?: readonly string[];
  readonly redact?: DatasetRedaction;
}

export const REDACTED = '[redacted]';
const PAGE = 100;

function blank(value: unknown, path: readonly string[]): unknown {
  if (!path.length || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  const [key, ...rest] = path as [string, ...string[]];
  if (!Object.hasOwn(value, key)) return value;
  const record = value as Record<string, unknown>;
  return { ...record, [key]: rest.length ? blank(record[key], rest) : REDACTED };
}

function row(proposal: Proposal, redact: DatasetRedaction): ProposalDatasetRow {
  let input: unknown = proposal.input;
  for (const path of redact.fields?.[proposal.operation] ?? [])
    input = blank(input, path.split('.'));
  return {
    id: proposal.id,
    operation: proposal.operation,
    input,
    rationale: redact.rationale ? REDACTED : proposal.rationale,
    outcome: proposal.status as ProposalDatasetRow['outcome'],
    ...(proposal.reason !== undefined
      ? { reason: redact.reason ? REDACTED : proposal.reason }
      : {}),
    ...(proposal.confidence !== undefined ? { confidence: proposal.confidence } : {}),
    ...(proposal.model ? { model: proposal.model } : {}),
    ...(proposal.resource ? { resource: proposal.resource } : {}),
    ...(proposal.runId ? { runId: proposal.runId } : {}),
    createdAt: proposal.createdAt,
    ...(proposal.closedAt !== undefined ? { closedAt: proposal.closedAt } : {}),
  };
}

/** `sha256:` over each row's canonical JSON, one per line. */
export function datasetDigest(rows: readonly ProposalDatasetRow[]): string {
  const lines = rows.map((item) => `${canonicalJson(item)}\n`).join('');
  return `sha256:${bytesToHex(sha256(utf8ToBytes(lines)))}`;
}

/**
 * Export every closed proposal `context` may see, in ID order. Open proposals are left out: no
 * person has decided them yet.
 */
export async function exportProposalDataset(
  application: { queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult> },
  context: ExecutionContext,
  options: ExportOptions = {},
): Promise<ProposalDataset> {
  const redact = options.redact ?? {};
  const closed: Proposal[] = [];
  for (const status of ['accepted', 'rejected', 'expired'] as const)
    for (let offset = 0; ; offset += PAGE) {
      const page = (
        await application.queryRaw(
          { operation: 'proposal.list', input: { status, offset, limit: PAGE } },
          context,
        )
      ).data as { items: Proposal[]; total: number };
      closed.push(...page.items);
      if (page.items.length < PAGE || offset + PAGE >= page.total) break;
    }
  const wanted = options.operations && new Set(options.operations);
  const rows = closed
    .filter((proposal) => !wanted || wanted.has(proposal.operation))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((proposal) => row(proposal, redact));
  return {
    format: PROPOSAL_DATASET_FORMAT,
    digest: datasetDigest(rows),
    exportedBy: context.principalId,
    rows,
    redaction: redact,
  };
}
