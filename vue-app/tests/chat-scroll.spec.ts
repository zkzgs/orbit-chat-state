import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function open(page: Page, url: string, image = false) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.addInitScript(
    ({ image }) => {
      if (localStorage.getItem('orbit-chat-state-v1')) return
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: { demoMode: false, chatApiKey: '', imageApiKey: '' },
          activeConversationId: 'a',
          conversations: ['a', 'b'].map((id) => ({
            id,
            title: '对话' + id,
            createdAt: 1,
            messages: Array.from({ length: 30 }, (_, index) => ({
              id: id + index,
              role: index % 2 ? 'assistant' : 'user',
              content:
                '第 ' +
                index +
                ' 条消息\n\n' +
                '用于检查对话滚动位置的内容。'.repeat(12) +
                (image && index === 29
                  ? '\n\n![延迟图片](https://scroll.test/image.svg)'
                  : ''),
              imageIds: [],
              createdAt: index + 1,
            })),
          })),
        }),
      )
    },
    { image },
  )
  await page.goto(url + '#/chat?c=a', { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#chatView')).toBeVisible()
}
async function gap(page: Page) {
  return page
    .locator('.content-stage')
    .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  for (const mobile of [false, true])
    test(
      version +
        ' ' +
        (mobile ? '手机' : '桌面') +
        ' 刷新已有对话后滚到底部, 切换对话和工作区行为一致',
      async ({ page }) => {
        if (mobile) await page.setViewportSize({ width: 390, height: 740 })
        await open(page, url)
        await expect.poll(() => gap(page)).toBeLessThan(3)
        await page.locator('.content-stage').evaluate((el) => {
          el.scrollTop = 0
        })
        await expect(page.locator('#scrollChatBottom')).toBeVisible()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect.poll(() => gap(page)).toBeLessThan(3)
        if (mobile) await page.locator('#openSidebar').click()
        await page
          .locator('.conversation-item')
          .filter({ hasText: '对话b' })
          .click()
        await expect.poll(() => gap(page)).toBeLessThan(3)
        await page.locator('.content-stage').evaluate((el) => {
          el.scrollTop = 0
        })
        await page.locator('[data-view="image"]').click()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(page.locator('#imageView')).toBeVisible()
        await page.locator('[data-view="chat"]').click()
        await expect.poll(() => gap(page)).toBeLessThan(3)
      },
    )

  for (const reading of [false, true])
    test(
      version +
        ' 首次加载的图片延迟显示, ' +
        (reading ? '阅读历史时不强制滚底' : '仍跟随到底部'),
      async ({ page }) => {
        let release!: () => void
        const ready = new Promise<void>((resolve) => {
          release = resolve
        })
        await page.route('https://scroll.test/image.svg', async (route) => {
          await ready
          await route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1200"><rect width="600" height="1200" fill="blue"/></svg>',
          })
        })
        await open(page, url, true)
        await expect.poll(() => gap(page)).toBeLessThan(3)
        const stage = page.locator('.content-stage')
        const before = await stage.evaluate((el) => el.scrollHeight)
        if (reading) {
          await stage.evaluate((el) => {
            el.scrollTop = 0
          })
          await expect(page.locator('#scrollChatBottom')).toBeVisible()
        }
        release()
        await expect
          .poll(() =>
            page
              .locator('.markdown-inline-image')
              .evaluate((el: HTMLImageElement) => el.naturalHeight),
          )
          .toBe(1200)
        await expect
          .poll(() => stage.evaluate((el) => el.scrollHeight))
          .toBeGreaterThan(before)
        if (reading)
          await expect
            .poll(() => stage.evaluate((el) => el.scrollTop))
            .toBeLessThan(3)
        else await expect.poll(() => gap(page)).toBeLessThan(3)
      },
    )
}
