import { test, expect } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
])
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ])
    test(`${version} ${width}px hero仅在生成记录空态显示`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.route(
        'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
        (r) =>
          r.fulfill({
            body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
            contentType: 'application/javascript',
          }),
      )
      await page.addInitScript(() => {
        if (!localStorage.getItem('orbit-chat-state-v1'))
          localStorage.setItem(
            'orbit-chat-state-v1',
            JSON.stringify({ settings: { demoMode: true } }),
          )
      })
      await page.goto(url)
      await expect(
        page.locator('.image-generator-column .image-copy'),
      ).toHaveCount(0)
      await expect(page.locator('#imageHistory .image-copy')).toBeVisible()
      mkdirSync('.cache/screens', { recursive: true })
      await page.screenshot({
        path: `.cache/screens/image-empty-${version}-${width}.png`,
        animations: 'disabled',
        fullPage: true,
      })
      if (width === 390) {
        await page.locator('#imageHistory .image-copy').scrollIntoViewIfNeeded()
        await page.screenshot({
          path: `.cache/screens/image-empty-${version}-${width}-history.png`,
          animations: 'disabled',
        })
      }
      await page.locator('[data-history-library="favorites"]').click()
      await expect(page.locator('#imageHistory .image-copy')).toHaveCount(0)
      await page.locator('.favorite-folder-card').first().click()
      await expect(page.locator('#imageHistory .image-copy')).toHaveCount(0)
      await page.locator('[data-history-library="history"]').click()
      await page.locator('#imagePrompt').fill('第一张图片')
      await page.locator('#generateImage').click()
      await expect(page.locator('#imageHistory .history-empty')).toBeHidden()
      await expect(page.locator('#imageHistory .history-item')).toHaveCount(1)
      await expect(page.locator('#imageHistory .history-empty')).toBeHidden()
    })
