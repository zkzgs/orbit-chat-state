import { test, expect, type Page } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
async function seed(page: Page, url: string) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (r) =>
      r.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto(url)
  await page.evaluate(async () => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: { demoMode: true, chatStream: true },
        activeConversationId: 'a',
        conversations: ['a', 'b', 'c'].map((id, index) => ({
          id,
          title: '会话' + id.toUpperCase(),
          createdAt: 3 - index,
          messages: [
            {
              id: 'm-' + id,
              role: 'user',
              content: '问题' + id,
              imageIds: [id === 'c' ? 'unique' : 'shared'],
              createdAt: 1,
            },
          ],
        })),
      }),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('orbit-chat-images-v1')
      r.onupgradeneeded = () =>
        r.result.createObjectStore('generations', { keyPath: 'id' })
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('generations', 'readwrite')
      for (const [id, color] of [
        ['shared', 'red'],
        ['unique', 'blue'],
      ]) {
        const c = document.createElement('canvas')
        c.width = 32
        c.height = 32
        const ctx = c.getContext('2d')!
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 32, 32)
        tx.objectStore('generations').put({
          id,
          type: 'image',
          src: c.toDataURL(),
          createdAt: 1,
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload()
  await page.locator('[data-view="chat"]').click()
}
async function imageIds(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('orbit-chat-images-v1')
      r.onsuccess = () => resolve(r.result)
    })
    try {
      return await new Promise<string[]>((resolve) => {
        const r = db
          .transaction('generations')
          .objectStore('generations')
          .getAllKeys()
        r.onsuccess = () => resolve(r.result.map(String).sort())
      })
    } finally {
      db.close()
    }
  })
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  for (const width of [1440, 390])
    test(`${version} ${width}px 对话多选不跳转、全选/取消、确认批量删除与图片引用保护`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 })
      await seed(page, url)
      if (width === 390) await page.locator('#openSidebar').click()
      const originalUrl = page.url()
      await page.locator('#toggleConversationSelection').click()
      await expect(page.locator('#conversationSelectionBar')).toBeVisible()
      await expect(page.locator('#conversationDeleteSelected')).toBeDisabled()
      await expect(page.locator('.conversation-actions')).toHaveCount(0)
      await page
        .locator('.conversation-select-item')
        .filter({ hasText: '会话B' })
        .click()
      await expect(
        page.getByRole('checkbox', { name: '会话B', exact: true }),
      ).toBeChecked()
      expect(page.url()).toBe(originalUrl)
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话A',
      )
      await page.locator('#conversationSelectAll').click()
      await expect(page.locator('#conversationSelectionCount')).toHaveText(
        '3 项',
      )
      await expect(page.locator('#conversationSelectAll')).toHaveText(
        '取消全选',
      )
      await page.locator('#conversationSelectAll').click()
      await expect(page.locator('#conversationSelectionCount')).toHaveText(
        '0 项',
      )
      await page.keyboard.press('Escape')
      await expect(page.locator('#conversationSelectionBar')).toBeHidden()
      await page.locator('#toggleConversationSelection').click()
      await page.getByRole('checkbox', { name: '会话A', exact: true }).check()
      await page.getByRole('checkbox', { name: '会话C', exact: true }).check()
      mkdirSync('.cache/screens', { recursive: true })
      await page.screenshot({
        path: `.cache/screens/conversation-selection-${version}-${width}.png`,
        animations: 'disabled',
      })
      const bar = await page.locator('#conversationSelectionBar').boundingBox()
      expect(bar!.height).toBeLessThan(85)
      page.once('dialog', (d) => d.dismiss())
      await page.locator('#conversationDeleteSelected').click()
      await expect(page.locator('.conversation-select-item')).toHaveCount(3)
      await expect(page.locator('#conversationSelectionCount')).toHaveText(
        '2 项',
      )
      page.once('dialog', (d) => {
        expect(d.message()).toContain('2 个对话')
        return d.accept()
      })
      await page.locator('#conversationDeleteSelected').click()
      await expect(page.locator('.conversation-item')).toHaveCount(1)
      await expect(page.locator('.conversation-item.active')).toContainText(
        '会话B',
      )
      await expect.poll(() => imageIds(page)).toEqual(['shared'])
      await page.reload()
      await expect(page.locator('#chatView')).toBeVisible()
      await expect(page.locator('.message-image')).toHaveCount(1)
      if (width === 390) await page.locator('#openSidebar').click()
      await page.locator('#toggleConversationSelection').click()
      await page.locator('#conversationSelectAll').click()
      page.once('dialog', (d) => d.accept())
      await page.locator('#conversationDeleteSelected').click()
      await expect(page.locator('.conversation-item')).toHaveCount(1)
      await expect(page.locator('.conversation-item.active')).toContainText(
        '新对话',
      )
      await expect(page.locator('.message')).toHaveCount(0)
      await expect.poll(() => imageIds(page)).toEqual([])
    })
  test(`${version} 对话多选禁选正在生成的对话，全选和删除跳过它，完成可退出`, async ({
    page,
  }) => {
    await seed(page, url)
    await page.locator('#messageInput').fill('流式生成期间仍可批量管理其他对话')
    await page.locator('#sendButton').click()
    await page.locator('#toggleConversationSelection').click()
    await expect(
      page.getByRole('checkbox', { name: '会话A', exact: true }),
    ).toBeDisabled()
    await page.locator('#conversationSelectAll').click()
    await expect(page.locator('#conversationSelectionCount')).toHaveText('2 项')
    page.once('dialog', (d) => d.accept())
    await page.locator('#conversationDeleteSelected').click()
    await expect(page.locator('.conversation-item')).toHaveCount(1)
    await expect(page.locator('.conversation-item.active')).toContainText(
      '会话A',
    )
    await page.locator('#toggleConversationSelection').click()
    await page.locator('#conversationSelectionDone').click()
    await expect(page.locator('#conversationSelectionBar')).toBeHidden()
    if (
      (await page.locator('#sendButton').getAttribute('data-mode')) === 'stop'
    )
      await page.locator('#sendButton').click()
  })
}
