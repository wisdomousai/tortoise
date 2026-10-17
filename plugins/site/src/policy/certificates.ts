import { X509Certificate } from 'node:crypto';
import type { Findings } from './findings';

/** Which policy file a certificate came from. */
export type CertificateSource = 'ingress-cert' | 'ingress-client-ca' | 'destination-ca';

/** Validity of one certificate the policy references; no key material. */
export interface CertificateValidity {
  readonly source: CertificateSource;
  /** The destination whose CA bundle holds it, for `destination-ca`. */
  readonly destination?: string;
  readonly subject: string;
  readonly fingerprint256: string;
  readonly notBefore: number;
  readonly notAfter: number;
}

/** A certificate this close to expiry is reported as a warning. */
export const certificateWarningMs = 30 * 86_400_000;

const pemBlock = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

/** Every certificate in a PEM file, in file order; undefined when any block does not parse. */
export function parseCertificates(
  pem: string,
  source: CertificateSource,
  destination?: string,
): CertificateValidity[] | undefined {
  const blocks = pem.match(pemBlock) ?? [];
  if (!blocks.length) return undefined;
  try {
    return blocks.map((block) => {
      const certificate = new X509Certificate(block);
      return {
        source,
        ...(destination ? { destination } : {}),
        subject: certificate.subject.replace(/\n/g, ', '),
        fingerprint256: certificate.fingerprint256,
        notBefore: Date.parse(certificate.validFrom),
        notAfter: Date.parse(certificate.validTo),
      };
    });
  } catch {
    return undefined;
  }
}

const labels: Record<CertificateSource, string> = {
  'ingress-cert': 'Ingress certificate',
  'ingress-client-ca': 'Ingress client CA',
  'destination-ca': 'CA bundle',
};
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

export interface CertificateProblem {
  readonly level: 'error' | 'warning';
  readonly code: 'CERTIFICATE_EXPIRED' | 'CERTIFICATE_NOT_YET_VALID' | 'CERTIFICATE_EXPIRING';
  readonly message: string;
  readonly destination?: string;
}

/**
 * Judge validity at `now`. The ingress certificate is the first block of its file (the leaf), so
 * it alone decides: outside its window is an error, near expiry a warning. A CA bundle is an error
 * only when none of its certificates is valid, because a bundle may carry an old CA beside its
 * replacement; each certificate in it that has expired or is near expiry is a warning.
 */
export function judgeCertificates(
  certificates: readonly CertificateValidity[],
  now: number,
  warningMs = certificateWarningMs,
): CertificateProblem[] {
  const groups = new Map<string, CertificateValidity[]>();
  for (const certificate of certificates) {
    const key = `${certificate.source}:${certificate.destination ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), certificate]);
  }
  const problems: CertificateProblem[] = [];
  for (const group of groups.values()) {
    const { source, destination } = group[0]!;
    const where = `${labels[source]}${destination ? ` for ${destination}` : ''}`;
    const add = (
      level: CertificateProblem['level'],
      code: CertificateProblem['code'],
      text: string,
    ) => problems.push({ level, code, message: text, ...(destination ? { destination } : {}) });
    const members = source === 'ingress-cert' ? group.slice(0, 1) : group;
    const valid = members.filter((item) => item.notBefore <= now && now < item.notAfter);
    if (!valid.length) {
      const leaf = members[0]!;
      if (leaf.notBefore > now && members.length === 1)
        add(
          'error',
          'CERTIFICATE_NOT_YET_VALID',
          `${where} (${leaf.subject}) is valid from ${day(leaf.notBefore)}`,
        );
      else
        add(
          'error',
          'CERTIFICATE_EXPIRED',
          `${where} has no valid certificate (${members.map((item) => `${item.subject} until ${day(item.notAfter)}`).join('; ')})`,
        );
      continue;
    }
    for (const item of members) {
      if (item.notAfter <= now)
        add(
          'warning',
          'CERTIFICATE_EXPIRED',
          `${where} holds ${item.subject}, expired ${day(item.notAfter)}`,
        );
      else if (item.notAfter - now < warningMs)
        add(
          'warning',
          'CERTIFICATE_EXPIRING',
          `${where} (${item.subject}) expires ${day(item.notAfter)}`,
        );
    }
  }
  return problems;
}

/** Report the judged problems as policy findings. */
export function checkCertificates(
  certificates: readonly CertificateValidity[],
  now: number,
  report: Findings,
) {
  for (const problem of judgeCertificates(certificates, now))
    (problem.level === 'error' ? report.error : report.warn)(
      problem.code,
      problem.message,
      problem.destination,
    );
}
