import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' 输入在工作区切换时保留, 持久化开关控制刷新恢复',
    async ({ page }) => {
      await page.route(
        'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
        (route) =>
          route.fulfill({
            body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
            contentType: 'application/javascript',
          }),
      )
      await page.goto(url)
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-display').click()
      await expect(page.locator('#themeSetting')).toHaveValue('system')
      await expect(page.locator('#imagePrivacyEnabled')).not.toBeChecked()
      await expect(page.locator('#imagePrivacyMode')).toBeDisabled()
      await page.locator('#imagePrivacyEnabled').check({ force: true })
      await expect(page.locator('#imagePrivacyMode')).toBeEnabled()
      await page.locator('#imagePrivacyEnabled').uncheck({ force: true })
      await page.locator('#cancelSettings').click()
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('#chatStream')).toBeChecked()
      await page.locator('[data-view="image"]').click()
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-habits').click()
      await expect(page.locator('#persistInputContent')).toBeChecked()
      await page.locator('#cancelSettings').click()

      await page.locator('#imagePrompt').fill('切换工作区后保留的生图关键词')
      await page.locator('[data-view="chat"]').click()
      await page.locator('#messageInput').fill('切换工作区后保留的对话草稿')
      await page.locator('[data-view="image"]').click()
      await expect(page.locator('#imagePrompt')).toHaveValue(
        '切换工作区后保留的生图关键词',
      )
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('#messageInput')).toHaveValue(
        '切换工作区后保留的对话草稿',
      )

      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-habits').click()
      await page.locator('#persistInputContent').check({ force: true })
      await page.locator('#saveSettings').click()
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('orbit-input-drafts-v1')),
        )
        .toContain('切换工作区后保留的生图关键词')
      await page.reload()
      await expect(page.locator('#imagePrompt')).toHaveValue(
        '切换工作区后保留的生图关键词',
      )
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('#messageInput')).toHaveValue(
        '切换工作区后保留的对话草稿',
      )

      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-habits').click()
      await page.locator('#persistInputContent').uncheck({ force: true })
      await page.locator('#saveSettings').click()
      await expect(page.locator('#imagePrompt')).toHaveValue(
        '切换工作区后保留的生图关键词',
      )
      await expect(page.locator('#messageInput')).toHaveValue(
        '切换工作区后保留的对话草稿',
      )
      await expect
        .poll(() =>
          page.evaluate(() => localStorage.getItem('orbit-input-drafts-v1')),
        )
        .toBeNull()
      await page.reload()
      await expect(page.locator('#imagePrompt')).toHaveValue('')
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('#messageInput')).toHaveValue('')
    },
  )
}
