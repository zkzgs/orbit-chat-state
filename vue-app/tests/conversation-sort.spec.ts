import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' 对话默认按更新时间排序, 可切换为创建时间',
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
      await page.evaluate(() => {
        const create = (id: string, createdAt: number, updatedAt: number) => ({
          id,
          title: id,
          createdAt,
          messages: [
            {
              id: id + '-message',
              role: 'user',
              content: id,
              createdAt: updatedAt,
              imageIds: [],
            },
          ],
        })
        localStorage.setItem(
          'orbit-chat-state-v1',
          JSON.stringify({
            settings: { demoMode: true },
            activeConversationId: 'created-first',
            conversations: [
              create('created-first', 300, 300),
              create('updated-first', 100, 500),
              create('middle', 200, 400),
            ],
          }),
        )
      })
      await page.reload()
      await page.locator('[data-view="chat"]').click()
      const titles = page.locator('#conversationList .conversation-title')
      await expect(titles).toHaveText([
        'updated-first',
        'middle',
        'created-first',
      ])

      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-chat-policy').click()
      await page
        .locator('#conversationSort')
        .selectOption('created', { force: true })
      await page.locator('#saveSettings').click()
      await expect(titles).toHaveText([
        'created-first',
        'middle',
        'updated-first',
      ])
      await page.reload()
      await page.locator('[data-view="chat"]').click()
      await expect(titles).toHaveText([
        'created-first',
        'middle',
        'updated-first',
      ])
    },
  )
}
