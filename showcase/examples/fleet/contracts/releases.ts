import { z } from 'zod';
import {
  blobRefSchema,
  collectionGet,
  collectionList,
  defineCapability,
  defineCollection,
  jsonSchema,
} from '@tortoise/contracts';
import { releaseSchema } from '@tortoise/fleet-agent/contracts';
import { channelIdSchema } from './instances';

/** A release ID is also the instance's staging directory name. */
export const releaseIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

/** A published release: the signed bundle manifest and signature, its files held as blobs. */
export const releaseRecordSchema = z.strictObject({
  id: releaseIdSchema,
  version: releaseSchema.shape.version,
  application: z.string().max(128),
  platform: z.string().max(64),
  files: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  publishedAt: z.number().int().nonnegative(),
  publishedBy: z.string().max(128),
  manifest: releaseSchema.shape.manifest,
  signature: releaseSchema.shape.signature,
});
export type ReleaseRecord = z.output<typeof releaseRecordSchema>;

export const releases = defineCollection({
  type: 'release',
  resourceType: 'Release',
  item: releaseRecordSchema,
  label: { one: 'Release', many: 'Releases' },
});

/** A release channel and the release its instances should run. */
export const channelSchema = z.strictObject({
  id: channelIdSchema,
  release: releaseIdSchema,
  assignedAt: z.number().int().nonnegative(),
  assignedBy: z.string().max(128),
});
export type Channel = z.output<typeof channelSchema>;

export const channels = defineCollection({
  type: 'channel',
  resourceType: 'Channel',
  item: channelSchema,
  label: { one: 'Channel', many: 'Channels' },
});

/** The largest release file the fleet accepts. */
export const RELEASE_FILE_BYTES = 268_435_456;

export const releaseOperations = {
  releaseList: collectionList(releases, {
    id: 'release',
    description: 'List published releases, newest first. Search the ID, version and application.',
    search: true,
  }),
  releaseGet: collectionGet(releases, {
    id: 'release',
    description: 'Read one release with its signed manifest.',
  }),
  releasePublish: defineCapability({
    id: 'release.publish',
    kind: 'command',
    description:
      'Publish a signed bundle: its bundle.json as manifest, its bundle.sig as signature, and each file under files/ uploaded first as a blob. Every manifest file needs exactly one blob of its digest and size. Instances verify the signature against their own trusted keys before staging. Operators only; publishing an existing ID conflicts.',
    input: jsonSchema(
      z.strictObject({
        release: releaseSchema.extend({ id: releaseIdSchema }),
        files: z.array(blobRefSchema).min(1).max(1000),
      }),
    ),
    output: jsonSchema(releaseRecordSchema),
    permission: { action: 'write', resourceType: 'Release' },
    blobs: { maxBytes: RELEASE_FILE_BYTES, mediaTypes: ['application/octet-stream'] },
    dependencies: ['release'],
    ui: {
      exception:
        'Published by the build pipeline that signs the bundle, through HTTP or the CLI after uploading its files',
    },
  }),
  channelList: collectionList(channels, {
    id: 'channel',
    description: 'List release channels and the release each one assigns.',
  }),
  channelGet: collectionGet(channels, {
    id: 'channel',
    description: 'Read one release channel.',
    ui: { exception: 'The channel list shows every field; nothing opens one channel' },
  }),
  channelAssign: defineCapability({
    id: 'channel.assign',
    kind: 'command',
    description:
      'Point a release channel at a published release, creating the channel if needed. Instances on it stage that release on their next cycle. Operators only.',
    input: jsonSchema(z.strictObject({ id: channelIdSchema, release: releaseIdSchema })),
    output: jsonSchema(channelSchema),
    permission: { action: 'write', resourceType: 'Channel' },
    dependencies: ['channel', 'release'],
    ui: { binding: 'channel.assign' },
    audit: { fields: ['id', 'release'] },
  }),
} as const;
