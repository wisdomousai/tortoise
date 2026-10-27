import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { canonicalJson, type ApprovalRequest } from '@agent-native/contracts';
import type { ExecutionContext, Invocation, QueryResult } from './types.js';

/**
 * Training data from people's decisions on approval requests: what an agent requested, and whether a
 * person approved, rejected (with their reason) or let it expire. It is read through
 * `approval.list` as the exporting caller, so it holds only approval requests that caller may see, and
 * redaction is applied before the digest, so the digest names exactly what left the host.
 */

export const APPROVAL_DATASET_FORMAT = 'agent-native/approval-dataset@1';

export interface DatasetRedaction {
  /** Input fields to blank per requested operation, as dotted paths, e.g. `{ 'lot.note': ['text'] }`. */
  readonly fields?: Readonly<Record<string, readonly string[]>>;
  /** Blank the agent's rationale, which can quote record contents. */
  readonly rationale?: boolean;
  /** Blank the person's rejection reason. */
  readonly reason?: boolean;
}

export interface ApprovalDatasetRow {
  readonly id: string;
  readonly operation: string;
  readonly input: unknown;
  readonly rationale: string;
  readonly outcome: 'approved' | 'rejected' | 'expired';
  readonly reason?: string;
  readonly confidence?: number;
  /** The requester's own label for its model; the run's recorded identity is the trusted one. */
  readonly model?: string;
  readonly resource?: string;
  readonly runId?: string;
  readonly createdAt: number;
  readonly closedAt?: number;
}

export interface ApprovalDataset {
  readonly format: typeof APPROVAL_DATASET_FORMAT;
  /** `sha256:` over the canonical JSON lines of `rows`; a model entry names it as its dataset. */
  readonly digest: string;
  readonly exportedBy: string;
  readonly rows: readonly ApprovalDatasetRow[];
  /** The redaction applied, so a reader knows which blanks are deliberate. */
  readonly redaction: DatasetRedaction;
}

export interface ExportOptions {
  /** Only approval requests of these operations. */
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

function row(approval: ApprovalRequest, redact: DatasetRedaction): ApprovalDatasetRow {
  let input: unknown = approval.input;
  for (const path of redact.fields?.[approval.operation] ?? [])
    input = blank(input, path.split('.'));
  return {
    id: approval.id,
    operation: approval.operation,
    input,
    rationale: redact.rationale ? REDACTED : approval.rationale,
    outcome: approval.status as ApprovalDatasetRow['outcome'],
    ...(approval.reason !== undefined
      ? { reason: redact.reason ? REDACTED : approval.reason }
      : {}),
    ...(approval.confidence !== undefined ? { confidence: approval.confidence } : {}),
    ...(approval.model ? { model: approval.model } : {}),
    ...(approval.resource ? { resource: approval.resource } : {}),
    ...(approval.runId ? { runId: approval.runId } : {}),
    createdAt: approval.createdAt,
    ...(approval.closedAt !== undefined ? { closedAt: approval.closedAt } : {}),
  };
}

/** `sha256:` over each row's canonical JSON, one per line. */
export function datasetDigest(rows: readonly ApprovalDatasetRow[]): string {
  const lines = rows.map((item) => `${canonicalJson(item)}\n`).join('');
  return `sha256:${bytesToHex(sha256(utf8ToBytes(lines)))}`;
}

/**
 * Export every closed approval request `context` may see, in ID order. Pending approval requests are left out: no
 * person has decided them yet.
 */
export async function exportApprovalDataset(
  application: { queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult> },
  context: ExecutionContext,
  options: ExportOptions = {},
): Promise<ApprovalDataset> {
  const redact = options.redact ?? {};
  const closed: ApprovalRequest[] = [];
  for (const status of ['approved', 'rejected', 'expired'] as const)
    for (let offset = 0; ; offset += PAGE) {
      const page = (
        await application.queryRaw(
          { operation: 'approval.list', input: { status, offset, limit: PAGE } },
          context,
        )
      ).data as { items: ApprovalRequest[]; total: number };
      closed.push(...page.items);
      if (page.items.length < PAGE || offset + PAGE >= page.total) break;
    }
  const wanted = options.operations && new Set(options.operations);
  const rows = closed
    .filter((approval) => !wanted || wanted.has(approval.operation))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((approval) => row(approval, redact));
  return {
    format: APPROVAL_DATASET_FORMAT,
    digest: datasetDigest(rows),
    exportedBy: context.principalId,
    rows,
    redaction: redact,
  };
}
