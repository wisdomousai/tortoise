import { ApplicationError } from '@agent-native/contracts';

/** A declared folder this deployment binds to a directory. */
export interface BoundFolder {
  readonly id: string;
  /** Absolute directory path, as the site policy names it. */
  readonly path: string;
  readonly access: 'read' | 'write' | 'read-write';
}

/**
 * The kernel port for exchange folders: shares that other systems drop files into or pick them
 * up from. Without a plugin that provides it, every folder is unavailable.
 *
 * Trust boundary: callers name a folder the catalog declares, never a path. The site policy
 * decides which directory a folder ID means, so connector code cannot read or write anywhere
 * else, and the compliance manifest lists every folder data crosses.
 */
export interface FolderPort {
  /** Rejects UNAVAILABLE when the folder is undeclared, unbound or disabled here. */
  folder(folderId: string): BoundFolder;
}

const reason = (folderId: string) =>
  `Folder ${folderId} is unavailable: this application composes no plugin that binds folders`;

/** No folders: the kernel has no policy to decide which directories mean what. */
export const noFolders: FolderPort = Object.freeze({
  folder(folderId: string): BoundFolder {
    throw new ApplicationError('UNAVAILABLE', reason(folderId));
  },
});
