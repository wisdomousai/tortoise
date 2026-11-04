import { ApplicationError } from '@tortoise/contracts';
import { parseBundleManifest } from '@tortoise/bundle/manifest';
import {
  collectionGetHandler,
  collectionListHandler,
  records,
  type HandlerContribution,
} from '@tortoise/runtime';
import { operations } from '../contracts';
import { channels, releases, type Channel, type ReleaseRecord } from '../contracts/releases';
import type { AppState } from '../domain';
import { handler, now, type Services } from './context';

type ReleaseList = typeof operations.releaseList;
type ReleaseGet = typeof operations.releaseGet;
type ChannelList = typeof operations.channelList;
type ChannelGet = typeof operations.channelGet;
const visible = () => true;
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Publishing a release and pointing channels at it. The fleet checks that the manifest is a bundle
 * manifest and that the uploaded blobs are exactly its files; it does not judge the signature,
 * which each site checks against its own trusted keys before it stages anything.
 */
export function releaseHandlers(): HandlerContribution<AppState, Services>[] {
  return [
    collectionListHandler<AppState, Services, ReleaseList, ReleaseRecord>(
      releases,
      operations.releaseList,
      {
        store: (state) => state.releases,
        visible,
        order: (a, b) => b.publishedAt - a.publishedAt || byId(a, b),
        searchText: (release) => [release.id, release.version, release.application].join(' '),
      },
    ),
    collectionGetHandler<AppState, Services, ReleaseGet, ReleaseRecord>(
      releases,
      operations.releaseGet,
      { store: (state) => state.releases, visible },
    ),
    collectionListHandler<AppState, Services, ChannelList, Channel>(
      channels,
      operations.channelList,
      { store: (state) => state.channels, visible, order: byId },
    ),
    collectionGetHandler<AppState, Services, ChannelGet, Channel>(channels, operations.channelGet, {
      store: (state) => state.channels,
      visible,
    }),
    handler(operations.releasePublish, (input, ctx) => {
      const { release } = input;
      let manifest;
      try {
        manifest = parseBundleManifest(release.manifest);
      } catch (error) {
        throw new ApplicationError('INVALID_INPUT', (error as Error).message);
      }
      const uploaded = new Map(input.files.map((file) => [file.digest, file]));
      if (uploaded.size !== input.files.length || uploaded.size !== manifest.files.length)
        throw new ApplicationError('INVALID_INPUT', 'Upload exactly one blob per manifest file');
      for (const file of manifest.files) {
        const blob = uploaded.get(`sha256:${file.sha256}`);
        if (!blob || blob.size !== file.size)
          throw new ApplicationError('INVALID_INPUT', `No blob matches ${file.path}`);
      }
      const record = records(ctx, releases, ctx.state.releases).insert(release.id, {
        id: release.id,
        version: release.version,
        application: manifest.application,
        platform: manifest.platform,
        files: manifest.files.length,
        bytes: manifest.files.reduce((sum, file) => sum + file.size, 0),
        publishedAt: now(ctx),
        publishedBy: ctx.context.principalId,
        manifest: release.manifest,
        signature: release.signature,
      });
      for (const file of input.files) ctx.attach(releases.resource(release.id), file);
      return record;
    }),
    handler(operations.channelAssign, (input, ctx) => {
      records(ctx, releases, ctx.state.releases).getExisting(input.release);
      return records(ctx, channels, ctx.state.channels).set(input.id, {
        id: input.id,
        release: input.release,
        assignedAt: now(ctx),
        assignedBy: ctx.context.principalId,
      });
    }),
  ];
}
