import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
for (const [version, host, file] of [
  ['HTML', '/index.html', pathToFileURL(path.resolve('../index.html')).href],
  [
    'Vue',
    '/vue-app/dist/index.html',
    pathToFileURL(path.resolve('dist/index.html')).href,
  ],
])
  for (const [transport, url] of [
    ['host', host],
    ['file', file],
  ])
    test(`${version} ${transport} hash模块/会话刷新、手动切换、未知路由和历史不刷屏`, async ({
      page,
    }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      for (const [url, file] of [
        [
          'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
          'node_modules/selecto/dist/selecto.min.js',
        ],
        [
          'https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.6.0/dist/panzoom.min.js',
          'node_modules/@panzoom/panzoom/dist/panzoom.min.js',
        ],
      ])
        await page.route(url, (r) =>
          r.fulfill({
            body: readFileSync(file),
            contentType: 'application/javascript',
            headers: { 'access-control-allow-origin': '*' },
          }),
        )
      await page.addInitScript(() => {
        if (!localStorage.getItem('orbit-chat-state-v1'))
          localStorage.setItem(
            'orbit-chat-state-v1',
            JSON.stringify({
              settings: { demoMode: true },
              activeConversationId: 'a',
              conversations: [
                { id: 'a', title: '会话A', createdAt: 1, messages: [] },
                { id: 'b 中文&x', title: '会话B', createdAt: 2, messages: [] },
              ],
            }),
          )
      })
      const b = 'b 中文&x'
      await page.goto(url + '#/chat?' + new URLSearchParams({ c: b }))
      await expect(page.locator('#chatView')).toBeVisible()
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话B',
      )
      await page.reload()
      await expect(page.locator('#chatView')).toBeVisible()
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话B',
      )
      const length = await page.evaluate(() => history.length)
      await page
        .locator('.conversation-item')
        .filter({ hasText: '会话A' })
        .click()
      await expect
        .poll(() =>
          page.evaluate(() =>
            new URLSearchParams(location.hash.split('?')[1]).get('c'),
          ),
        )
        .toBe('a')
      await page.locator('[data-view="image"]').click()
      await expect(page).toHaveURL(/#\/image$/)
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('#chatView')).toBeVisible()
      expect(await page.evaluate(() => history.length)).toBe(length)
      await page.reload()
      await expect(page.locator('#chatView')).toBeVisible()
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话A',
      )
      await page.evaluate((b) => {
        location.hash = '/chat?' + new URLSearchParams({ c: b })
      }, b)
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话B',
      )
      await page.evaluate(() => {
        location.hash = '/chat?c=missing'
      })
      await expect
        .poll(() =>
          page.evaluate(() =>
            new URLSearchParams(location.hash.split('?')[1]).get('c'),
          ),
        )
        .toBe(b)
      await page.evaluate(() => {
        location.hash = '/unknown?c=a'
      })
      await expect(page.locator('#imageView')).toBeVisible()
      await expect(page).toHaveURL(/#\/image$/)
      await page.reload()
      await expect(page.locator('#imageView')).toBeVisible()
      await page.evaluate(() => {
        location.hash = '/chat'
      })
      await expect(page.locator('#chatView')).toBeVisible()
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话B',
      )
      expect(errors).toEqual([])
    })
