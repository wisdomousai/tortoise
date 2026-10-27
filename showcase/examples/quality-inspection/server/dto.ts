import {
  progress,
  type Defect,
  type InspectionResult,
  type Synchronized,
  type InspectionLot,
} from '../domain';
import { compact, type Context } from './context';

/** The forwarding effect is internal; DTOs and decisions never expose its id. */
export const withoutEffect = <T extends Synchronized>({ effectId: _effectId, ...value }: T) =>
  value;
export const resultDto = (ctx: Context, result: InspectionResult, changed = false) => ({
  ...withoutEffect(result),
  revision: ctx.getRevision(`result:${result.id}`) + Number(changed),
});
export const defectDto = (ctx: Context, defect: Defect, changed = false) => ({
  ...withoutEffect(defect),
  revision: ctx.getRevision(`defect:${defect.id}`) + Number(changed),
});
export function lotSummary(ctx: Context, lot: InspectionLot, changed = false) {
  const { next: _next, ...counts } = progress(ctx.state, lot);
  return compact({
    id: lot.id,
    revision: ctx.getRevision(`lot:${lot.id}`) + Number(changed),
    plant: lot.plant,
    material: lot.material,
    materialText: lot.materialText,
    batch: lot.batch,
    quantity: lot.quantity,
    unit: lot.unit,
    status: lot.status,
    ...counts,
  });
}
