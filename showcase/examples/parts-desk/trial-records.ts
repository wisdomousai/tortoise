import { LOCAL_OWNER, LOCAL_WORKSPACE, type EmbeddedInstance } from '@agent-native/host';
import type { Part } from './contracts/part';

/**
 * Trial records for a development workspace: three utilities, six transformers of three models
 * and 24 parts across every category and assembly, some out of stock. TR-40417 and TR-40471
 * share the start TR-404, so a find for it is ambiguous. Every record goes through its create
 * command as the workspace owner, under a fixed idempotency key: on a workspace that has them,
 * each command replays its stored receipt and the seed adds nothing. Names and phone numbers are
 * made up.
 */
const utilities = [
  { account: 'U1042', name: 'Stadtwerke Nordhafen', phone: '+49 40 5550 1042' },
  { account: 'U2117', name: 'Alpental Energie', phone: '+43 512 5550 2117' },
  { account: 'U3308', name: 'Rheinmark Netz', phone: '+49 221 5550 3308' },
];

const models = {
  'PTX-40': { ratingMva: 40, voltage: '110/20 kV', tapChanger: 'VR-400 vacuum, 17 positions' },
  'PTX-63': { ratingMva: 63, voltage: '132/33 kV', tapChanger: 'VR-400 vacuum, 19 positions' },
  'PTX-100': { ratingMva: 100, voltage: '220/110 kV', tapChanger: 'OR-600 oil, 27 positions' },
};

type Unit = [
  serial: string,
  account: string,
  model: keyof typeof models,
  substation: string,
  yearInService: number,
];
const units: Unit[] = [
  ['TR-40417', 'U1042', 'PTX-40', 'Nordhafen Ost', 2009],
  ['TR-40471', 'U2117', 'PTX-40', 'Innbrücke', 2011],
  ['TR-63102', 'U1042', 'PTX-63', 'Hafenkreuz', 2013],
  ['TR-63155', 'U3308', 'PTX-63', 'Kalkberg', 2015],
  ['TR-10008', 'U3308', 'PTX-100', 'Rheinufer Nord', 2016],
  ['TR-10023', 'U2117', 'PTX-100', 'Brennerweg', 2019],
];

const all = Object.keys(models);
type Row = [
  partNumber: string,
  description: string,
  category: Part['category'],
  assembly: Part['assembly'],
  fits: string[],
  unitPrice: number,
  stock: number,
  leadTimeDays: number,
];
// prettier-ignore
const catalog: Row[] = [
  ['BSH-145-1250', 'HV bushing 145 kV 1250 A, OIP', 'bushing', 'hv-bushings', ['PTX-40', 'PTX-63'], 1_480_000, 2, 84],
  ['BSH-245-1600', 'HV bushing 245 kV 1600 A, RIP', 'bushing', 'hv-bushings', ['PTX-100'], 3_150_000, 0, 140],
  ['BSH-24-3150', 'LV bushing 24 kV 3150 A', 'bushing', 'lv-bushings', ['PTX-40'], 198_000, 4, 28],
  ['BSH-36-2000', 'LV bushing 36 kV 2000 A', 'bushing', 'lv-bushings', ['PTX-63'], 235_000, 6, 28],
  ['BSH-123-2000', 'LV bushing 123 kV 2000 A, RIP', 'bushing', 'lv-bushings', ['PTX-100'], 960_000, 1, 98],
  ['BSH-N36-800', 'Neutral bushing 36 kV 800 A', 'bushing', 'lv-bushings', all, 115_000, 3, 21],
  ['OLTC-DIV-400', 'Diverter switch insert 400 A', 'tap-changer', 'tap-changer', ['PTX-40', 'PTX-63'], 1_890_000, 1, 120],
  ['OLTC-DIV-600', 'Diverter switch insert 600 A', 'tap-changer', 'tap-changer', ['PTX-100'], 2_440_000, 0, 150],
  ['OLTC-CNT-SET', 'Selector contact set', 'tap-changer', 'tap-changer', all, 320_000, 5, 35],
  ['OLTC-MDU-230', 'Motor drive unit 230 V', 'tap-changer', 'tap-changer', all, 745_000, 2, 60],
  ['OLTC-SHAFT-40', 'Drive shaft with bevel gear', 'tap-changer', 'tap-changer', ['PTX-40'], 86_000, 0, 30],
  ['OLTC-POS-IND', 'Tap position indicator', 'tap-changer', 'tap-changer', all, 54_000, 7, 14],
  ['GSK-TC-40', 'Tank cover gasket, nitrile', 'gasket', 'tank-cover', ['PTX-40'], 69_000, 12, 10],
  ['GSK-TC-63', 'Tank cover gasket, nitrile', 'gasket', 'tank-cover', ['PTX-63'], 82_000, 0, 14],
  ['GSK-TC-100', 'Tank cover gasket, nitrile', 'gasket', 'tank-cover', ['PTX-100'], 114_000, 3, 14],
  ['GSK-CON-SET', 'Conservator gasket set', 'gasket', 'conservator', all, 31_000, 20, 7],
  ['GSK-BSH-145', 'Bushing flange gasket 145 kV', 'gasket', 'hv-bushings', ['PTX-40', 'PTX-63'], 9_500, 40, 7],
  ['GSK-BSH-245', 'Bushing flange gasket 245 kV', 'gasket', 'hv-bushings', ['PTX-100'], 14_000, 0, 21],
  ['RLY-BCH-50', 'Buchholz relay DN 50', 'relay', 'protection', ['PTX-40'], 98_000, 0, 21],
  ['RLY-BCH-80', 'Buchholz relay DN 80', 'relay', 'protection', ['PTX-63', 'PTX-100'], 129_000, 4, 21],
  ['RLY-WTI-150', 'Winding temperature indicator with contacts', 'relay', 'protection', all, 208_000, 3, 42],
  ['RLY-SPR-01', 'Sudden pressure relay', 'relay', 'tank-cover', all, 165_000, 2, 35],
  ['RLY-OSR-25', 'Tap changer oil surge relay', 'relay', 'tap-changer', all, 112_000, 1, 28],
  ['RLY-OLV-MAG', 'Magnetic oil level relay', 'relay', 'conservator', all, 76_000, 0, 28],
];

/** Create the trial records that the workspace does not have yet. */
export async function seedTrialRecords(application: EmbeddedInstance['application']) {
  const owner = { workspaceId: LOCAL_WORKSPACE, principalId: LOCAL_OWNER };
  const create = async (operation: string, key: string, input: object) =>
    (await application.invokeRaw({ operation, input, idempotencyKey: `trial-${key}` }, owner))
      .result as { id: string };
  const customerIds: Record<string, string> = {};
  for (const utility of utilities)
    customerIds[utility.account] = (await create('customer.create', utility.account, utility)).id;
  for (const [serial, account, model, substation, yearInService] of units)
    await create('transformer.create', serial, {
      serial,
      customerId: customerIds[account],
      model,
      ...models[model],
      substation,
      yearInService,
    });
  for (const [
    partNumber,
    description,
    category,
    assembly,
    fits,
    unitPrice,
    stock,
    leadTimeDays,
  ] of catalog)
    await create('part.create', partNumber, {
      partNumber,
      description,
      category,
      assembly,
      fits,
      unitPrice,
      stock,
      leadTimeDays,
    });
}
