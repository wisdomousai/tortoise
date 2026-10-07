import { GROUP_SEPARATOR, parseGs1, type Gs1Result } from './gs1';
import type { ScannerProfile, ScannerTransport } from './profile';
import { parseAim, type Symbology } from './symbology';

/** One completed scan, normalized and decoded. It is input data, never trusted for authority. */
export interface ScanEvent {
  /** Exactly what the source delivered, after key-code decoding for wedge sources. */
  readonly raw: string;
  /** Payload without prefix, suffix and AIM identifier; group separators restored to ASCII 29. */
  readonly data: string;
  readonly symbology?: Symbology;
  readonly aimId?: string;
  /** Parsed when the symbology says GS1, or the payload parses as a valid element string. */
  readonly gs1?: Gs1Result;
  readonly source: ScannerTransport;
  readonly profileId: string;
  readonly deviceId?: string;
  /** Milliseconds on the source's clock (event time stamp or performance.now()). */
  readonly at: number;
}

/** Normalize raw scanner output with a profile. Pure; every source funnels through here. */
export function decodeScan(
  raw: string,
  profile: ScannerProfile,
  meta: { readonly at: number; readonly deviceId?: string; readonly symbology?: Symbology },
): ScanEvent {
  let text = raw;
  if (profile.prefix && text.startsWith(profile.prefix)) text = text.slice(profile.prefix.length);
  if (profile.suffix && text.endsWith(profile.suffix)) text = text.slice(0, -profile.suffix.length);
  const { aim, data: payload } = profile.aimIds ? parseAim(text) : { data: text };
  const data = profile.groupSeparator
    ? payload.split(profile.groupSeparator).join(GROUP_SEPARATOR)
    : payload;
  const symbology = aim?.symbology ?? meta.symbology;
  let gs1: Gs1Result | undefined;
  // Without an AIM identifier, accept only a fully valid parse so plain numbers are not misread.
  if (aim?.gs1 || data.startsWith('(') || data.includes(GROUP_SEPARATOR)) gs1 = parseGs1(data);
  else if (/^\d{16,}/.test(data)) {
    const candidate = parseGs1(data);
    if (candidate.valid) gs1 = candidate;
  }
  return {
    raw,
    data,
    ...(symbology ? { symbology } : {}),
    ...(aim ? { aimId: aim.id } : {}),
    ...(gs1 ? { gs1 } : {}),
    source: profile.transport,
    profileId: profile.id,
    ...(meta.deviceId ? { deviceId: meta.deviceId } : {}),
    at: meta.at,
  };
}
