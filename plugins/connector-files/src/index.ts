/**
 * File exchange connectors: a system of record reached through shared folders. Server only,
 * except `./component`, which declares the folders as browser-safe data.
 */
export { fileExchange, type FileExchangeFolders } from './component';
export { fileDropPort, type Encoded, type FileDropOptions } from './drop';
export { folderFeed, type FileSource, type FolderFeedOptions } from './feed';
export {
  extensionOf,
  parseRecords,
  serializeRecords,
  type FileFormat,
  type FileRecord,
  type XmlNames,
} from './formats';
export { fileTargetPort } from './target';
