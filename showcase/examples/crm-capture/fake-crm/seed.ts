/** CRM-side records, with the CRM's own field names; the port maps them for the application. */
export interface CrmAccountRecord {
  Id: string;
  Name: string;
  Industry: string;
  BillingCity: string;
  Region__c: string;
  /** CRM user who owns the account; sharing gives owners and public accounts to a user. */
  OwnerId: string;
  Public: boolean;
}
export interface CrmContactRecord {
  Id: string;
  Name: string;
  Title: string;
  Email: string;
  AccountId: string;
}
export const crmUsers: Record<string, string> = { ann: 'Ann Keller', ben: 'Ben Ortiz' };

const account = (
  Id: string,
  Name: string,
  Industry: string,
  BillingCity: string,
  Region__c: string,
  OwnerId: string,
  Public = false,
): CrmAccountRecord => ({ Id, Name, Industry, BillingCity, Region__c, OwnerId, Public });
const contact = (Id: string, Name: string, Title: string, AccountId: string): CrmContactRecord => ({
  Id,
  Name,
  Title,
  Email: `${Name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`,
  AccountId,
});

/** Demo fixture: ann owns the north and west, ben the south; three accounts are public. */
export function demoSeed() {
  return {
    accounts: [
      account('001A1', 'Acme Robotics', 'Manufacturing', 'Hamburg', 'north', 'ann'),
      account('001A2', 'Acme Logistics', 'Transport', 'Bremen', 'north', 'ann'),
      account('001A3', 'Alpine Foods', 'Food', 'Munich', 'south', 'ben'),
      account('001A4', 'Apex Medical', 'Healthcare', 'Stuttgart', 'south', 'ben', true),
      account('001A5', 'Baltic Shipyards', 'Manufacturing', 'Kiel', 'north', 'ann'),
      account('001A6', 'Rhine Chemicals', 'Chemicals', 'Cologne', 'west', 'ann'),
      account('001A7', 'Ruhr Steel', 'Metals', 'Dortmund', 'west', 'ben'),
      account('001A8', 'Black Forest Tools', 'Manufacturing', 'Freiburg', 'south', 'ben'),
      account('001A9', 'Elbe Energy', 'Utilities', 'Dresden', 'north', 'ben', true),
      account('001B1', 'Moselle Wines', 'Food', 'Trier', 'west', 'ann', true),
    ],
    contacts: [
      contact('003C1', 'Maria Schulz', 'Head of Purchasing', '001A1'),
      contact('003C2', 'Jonas Weber', 'Plant Manager', '001A1'),
      contact('003C3', 'Lena Fischer', 'Fleet Director', '001A2'),
      contact('003C4', 'Paul Bauer', 'CFO', '001A3'),
      contact('003C5', 'Sofia Wagner', 'Procurement Lead', '001A4'),
      contact('003C6', 'Felix Becker', 'Operations Manager', '001A5'),
      contact('003C7', 'Hanna Hoffmann', 'Buyer', '001A6'),
      contact('003C8', 'Lukas Koch', 'Maintenance Lead', '001A7'),
      contact('003C9', 'Emma Richter', 'CEO', '001A8'),
      contact('003D1', 'Noah Klein', 'Energy Trader', '001A9'),
      contact('003D2', 'Mia Wolf', 'Sommelier', '001B1'),
    ],
  };
}
