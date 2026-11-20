import type { Page } from '@playwright/test'
export async function chooseDataScope(page: Page, scope: string) {
  const selected =
    scope === 'all'
      ? ['chat', 'image', 'config']
      : scope === 'workspace'
        ? ['chat', 'image']
        : scope.split('-')
  for (const key of ['chat', 'image', 'config'])
    await page
      .locator(`[data-data-scope="${key}"]`)
      .setChecked(selected.includes(key))
  await page.locator('#confirmDataScope').click()
}
