import { expect, type Page } from '@playwright/test';

/** Steps the tool-store browser tests share: scans, badge enrollment, sign-in and new tools. */

/**
 * Type `code` as the counter's keyboard-wedge scanner does: one burst of keys ending with Enter.
 * Capitals go with Shift held, because the wedge decoder reads key codes and `keyboard.type` sends
 * capitals without Shift.
 */
export async function scan(page: Page, code: string) {
  for (const part of code.match(/[A-Z]+|[^A-Z]+/g) ?? []) {
    if (!/[A-Z]/.test(part)) {
      await page.keyboard.type(part);
      continue;
    }
    await page.keyboard.down('Shift');
    await page.keyboard.type(part);
    await page.keyboard.up('Shift');
  }
  await page.keyboard.press('Enter');
}

/** Leave nothing focused, so a scan reaches the page's scanner and no control. */
export const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

export const sections = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

/**
 * Enroll a badge on the Badges screen. The launch link signs the browser in as the workspace
 * owner, who enrolls badges; the person must be one of the application's default members.
 */
export async function enroll(page: Page, person: string, badge: string, pin: string) {
  await sections(page).getByRole('link', { name: 'Badges' }).click();
  await page.getByLabel('Person').fill(person);
  await page.getByLabel('Label', { exact: true }).fill(`Badge ${badge}`);
  await page.getByLabel('Badge', { exact: true }).fill(badge);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Enroll' }).click();
  await expect(page.getByRole('row', { name: `Badge ${badge} ${person}` })).toBeVisible();
}

/** At the signed-out terminal: the badge as a scanner burst, then the PIN on the keypad. */
export async function signIn(page: Page, badge: string, pin: string) {
  await expect(page.getByText('Scan your badge')).toBeVisible();
  await blur(page);
  await scan(page, badge);
  const pad = page.getByRole('group', { name: 'PIN' });
  for (const digit of pin) await pad.getByRole('button', { name: digit, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Add a tool on the Tools screen as the owner. */
export async function addTool(
  page: Page,
  assetTag: string,
  description: string,
  category: string,
  bin: string,
) {
  await page.getByRole('textbox', { name: 'Asset tag', exact: true }).fill(assetTag);
  await page.getByRole('textbox', { name: 'Description', exact: true }).fill(description);
  await page.getByLabel('Category', { exact: true }).selectOption(category);
  await page.getByRole('textbox', { name: 'Bin', exact: true }).fill(bin);
  await page.getByRole('button', { name: 'Create' }).click();
}
