/**
 * Readings and their provenance, shared by every source an observer watches: a screen read by
 * accessibility, OCR or a vision model, or an instrument read through a driver. A frame is one
 * sample of the source (a screen capture, a driver's state read); its digest identifies it.
 */

export type FieldValue = string | number | boolean | null;

/** What one extractor read for one field in one frame, before stability gating. */
export interface RawReading {
  readonly field: string;
  readonly value: FieldValue;
  /** 0–1. Deterministic sources report 1; model confidence is calibrated against golden frames. */
  readonly confidence: number;
}

/**
 * The model behind an extractor, recorded with every reading it produces. For a fine-tuned
 * model, the adapter and dataset digests trace a reading to the data the model was tuned on.
 */
export interface ModelIdentity {
  readonly id: string;
  readonly version?: string;
  /** Base weights. */
  readonly digest?: string;
  readonly adapterDigest?: string;
  readonly datasetDigest?: string;
}

/**
 * The device behind a reading that came through a driver: which driver read it and which
 * physical unit answered. Reported by the driver at its handshake, so a reading can be traced to
 * a serial number and firmware without trusting the host's configuration.
 */
export interface DeviceIdentity {
  readonly driver: string;
  readonly driverVersion?: string;
  readonly serial?: string;
  readonly firmware?: string;
}

/** A field value with the provenance every consumer needs to judge it. */
export interface Reading {
  readonly field: string;
  readonly value: FieldValue;
  readonly confidence: number;
  readonly extractor: string;
  readonly model?: ModelIdentity;
  readonly device?: DeviceIdentity;
  readonly observedAt: number;
  readonly frameDigest: string;
}

/**
 * Turns one frame into readings for the requested fields. Must not throw for a field it cannot
 * read; it omits the field or returns `null` with low confidence. Throws only when the extractor
 * itself is unusable. `Frame`, `Field` and `Modality` are the source's: a screen extractor takes
 * captures and screen fields, a driver extractor takes state reads and the contract's fields.
 */
export interface Extractor<Frame, Field, Modality extends string = string> {
  readonly id: string;
  readonly modality: Modality;
  readonly model?: ModelIdentity;
  readonly device?: DeviceIdentity;
  extract(
    frame: Frame,
    fields: readonly Field[],
    signal: AbortSignal,
  ): Promise<readonly RawReading[]>;
}

/** Clamp a reported confidence into 0–1, so a misbehaving extractor cannot claim certainty above 1. */
export const clampConfidence = (confidence: number) => Math.min(1, Math.max(0, confidence));
