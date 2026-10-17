export { OsRequestError, parseRawOsRequest } from './parse';
export { matchOsRequest, type MatchOptions, type OsMatch, type OsRequestValues } from './match';
export { fillTemplate, resolveTarget } from './targets';
export { buildInstruction, openUrl, OsActionError } from './actions';
export {
  desktopOsConfig,
  nativeOsConfig,
  webManifestOs,
  webScheme,
  type ExpoIntentFilter,
  type OsIdentity,
  type OsRegistrationOptions,
} from './registrations';
