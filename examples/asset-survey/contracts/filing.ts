import { z } from 'zod';
import { defineDataProvider, defineTarget } from '@agent-native/contracts';
import { operation } from './operation';
import {
  assetFoundSchema,
  assetSnapshotSchema,
  filingSchema,
  photoLimits,
  recordId,
} from './schemas';

/**
 * The enterprise asset management system: filings go out through the outbox, and its feed
 * reports the assets they created or updated. Searches read it live.
 */
export const eamTarget = defineTarget({
  target: 'eam',
  resourceType: 'Filing',
  operations: { settle: 'filing.settle', sync: 'filing.sync', status: 'filing.status' },
  settles: ['filing'],
  feed: { item: assetSnapshotSchema, max: 200, changes: ['node'] },
  status: {
    pending: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
  },
  descriptions: {
    settle: 'Integration principal only: record the EAM outcome of a filing.',
    sync: 'Integration principal only: apply EAM asset snapshots and advance the watermark.',
    status: 'Filing with the EAM: filings waiting, accepted and rejected, and the last feed sync.',
  },
});

/**
 * A directory the site names: each filing becomes a folder with its record as JSON and its
 * evidence photos, for systems that import files instead of offering an API. The declared
 * `filing-export` process writes it, so the site policy decides the directory. No feed: a
 * written folder is the outcome.
 */
export const exportTarget = defineTarget({
  target: 'export',
  resourceType: 'Filing',
  operations: { settle: 'filing.export.settle', status: 'filing.export.status' },
  settles: ['filing'],
  status: {
    pending: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
  },
  descriptions: {
    settle:
      'Integration principal only: record whether a filing was written to the export directory.',
    status: 'Filing to the export directory: filings waiting, written and refused.',
  },
});

/** EAM assets, searched live with the integration's service account. */
export const eamAssets = defineDataProvider({
  id: 'eam.asset',
  target: 'eam',
  identity: 'caller-or-service',
  resourceType: 'EamAsset',
  query: z.strictObject({
    q: z.string().max(100),
    limit: z.number().int().min(1).max(50).optional(),
  }),
  item: assetFoundSchema,
  descriptions: {
    search:
      'Search the EAM live for assets by designation, name or serial. Results are not stored; nodeId names the survey node already filed as that asset. Before filing a node, search its designation and serial: file with assetId to update a match, or without to create a new asset.',
    lookup: 'Read one EAM asset by its EAM ID, live.',
  },
  ui: {
    lookup: { exception: 'agents resolve an EAM ID they were given; people pick from search' },
  },
});

export const filingOperations = {
  file: operation('filing.file', 'command', {
    input: z.strictObject({ nodeId: recordId, assetId: z.string().min(1).max(64).optional() }),
    output: filingSchema,
    permission: { action: 'file', resourceType: 'Filing' },
    description:
      'File a node with its accepted attributes and the photos they were read from into the EAM: update assetId, or create an asset when it is absent. The receipt proves the local request; the EAM accepts or rejects it later (filing.list).',
    dependencies: ['filing', 'node'],
    forwards: 'eam',
    // The evidence photos are attached to the filing so the connector may send them.
    blobs: photoLimits,
  }),
  export: operation('filing.export', 'command', {
    input: z.strictObject({ nodeId: recordId }),
    output: filingSchema,
    permission: { action: 'file', resourceType: 'Filing' },
    description:
      'Export a node with its accepted attributes and the photos they were read from to the export directory the site names, as a folder of JSON and photos. The receipt proves the local request; filing.list shows when the folder is written. Independent of filing the node into the EAM.',
    dependencies: ['filing', 'node'],
    forwards: 'export',
    blobs: photoLimits,
  }),
  withdraw: operation('filing.withdraw', 'command', {
    input: z.strictObject({ id: recordId }),
    output: filingSchema,
    permission: { action: 'file', resourceType: 'Filing' },
    description:
      'Withdraw an accepted EAM filing: the EAM retires the asset it created, or restores the attributes it replaced on the asset it updated. Returns the withdrawal, itself a filing the EAM accepts or rejects later. Withdrawing again returns the same withdrawal; a rejected filing has nothing to withdraw and comes back unchanged. Refused with CONFLICT while the EAM has not answered the filing.',
    dependencies: ['filing', 'node'],
    forwards: 'eam',
  }),
  list: operation('filing.list', 'query', {
    input: z.strictObject({ nodeId: recordId.optional() }),
    output: z.strictObject({ items: z.array(filingSchema) }),
    permission: { action: 'read', resourceType: 'Filing' },
    description:
      'Filings and exports, newest first, with whether the EAM or the export directory accepted each and why it refused.',
    dependencies: ['filing'],
  }),
  status: eamTarget.status,
  sync: eamTarget.sync,
  settle: eamTarget.settle,
  exportStatus: exportTarget.status,
  exportSettle: exportTarget.settle,
} as const;
