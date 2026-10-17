export { claimCode, OsRequestError, parseRawOsRequest } from './parse';
export { matchOsRequest, type MatchOptions, type OsMatch, type OsRequestValues } from './match';
export { fillTemplate, resolveTarget } from './targets';
export { buildInstruction, openActionFor, openUrl, OsActionError } from './actions';
export {
  desktopOsConfig,
  nativeOsConfig,
  webManifestOs,
  webScheme,
  webShareTargetPath,
  type ExpoIntentFilter,
  type OsIdentity,
  type OsRegistrationOptions,
} from './registrations';
export {
  desktopArguments,
  pathName,
  receivedArguments,
  type DesktopArguments,
} from './desktop-arguments';
export {
  createDesktopShell,
  type DesktopShell,
  type DesktopShellClient,
  type DesktopShellDependencies,
} from './desktop';
export {
  fileHandlerFor,
  fileRequest,
  landingRequest,
  strictText,
  type BlobUpload,
} from './local-files';
export {
  createMobileShell,
  mobileInput,
  type MobileFileInfo,
  type MobileShare,
  type MobileShell,
  type MobileShellDependencies,
} from './mobile';
export { maxSharedItems, shareFileRequest, shareHandlerFor } from './shares';
export { describeProvenance } from './provenance';
export { associationFiles, type AssociationIdentity } from './associations';
