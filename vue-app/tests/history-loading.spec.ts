import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

async function seed(page: Page) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto('/vue-app/dist/index.html')
  await page.evaluate(async () => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: { demoMode: true },
      }),
    )
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        {
          id: 'favorite',
          name: '收藏夹',
          isDefault: true,
          coverImageId: 'batch-000-1',
        },
      ]),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1')
      request.onupgradeneeded = () =>
        request.result.createObjectStore('generations', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('generations', 'readwrite')
      const store = tx.objectStore('generations')
      store.clear()
      for (let index = 0; index < 32; index++) {
        const id = `batch-${String(index).padStart(3, '0')}`
        const config = { model: 'test', count: 1, size: '1024x1024' }
        store.put({
          id: `${id}-1`,
          type: 'image',
          createdAt: index + 1,
          src:
            'data:image/svg+xml,' +
            encodeURIComponent(
              '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/></svg>',
            ),
          favoriteFolderIds: index === 0 ? ['favorite'] : [],
        })
        store.put({
          id,
          type: 'generation-batch',
          batchId: id,
          taskId: '',
          config,
          imageIds: [`${id}-1`],
          referenceImageIds: [],
          imageCount: 1,
          prompt: `图片 ${index}`,
          createdAt: index + 1,
          startedAt: index + 1,
          durationMs: 100,
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  for (const width of [1440, 390]) {
    test(`${version} ${width}px 历史未读完先展示卡片并加载可见图片`, async ({
      page,
    }) => {
      await seed(page)
      await page.setViewportSize({ width, height: 844 })
      await page.addInitScript(() => {
        const state = window as unknown as {
          historyPaused: boolean
          historyReleased: boolean
          firstHistoryImage?: Element | null
        }
        const original = IDBCursor.prototype.continue
        IDBCursor.prototype.continue = function (key?: IDBValidKey) {
          if (
            this.source instanceof IDBObjectStore &&
            this.source.name === 'generations' &&
            this.key === 'batch-026'
          ) {
            state.historyPaused = true
            const cursor = this
            // 保持读取事务有效, 人为暂停后半段, 证明首屏不依赖全库读取。
            const hold = () => {
              const keepAlive = (cursor.source as IDBObjectStore).count()
              keepAlive.onsuccess = () => {
                if (state.historyReleased) original.call(cursor, key)
                else hold()
              }
            }
            hold()
          } else original.call(this, key)
        }
      })
      await page.goto(url)
      await page.waitForFunction(() => (window as any).historyPaused)
      const cards = page.locator('#imageHistory > .history-item')
      await expect(cards.first()).toBeVisible()
      expect(await cards.count()).toBeLessThan(32)
      await expect(cards.first()).toContainText('图片 31')
      const image = cards.first().locator('img')
      await image.scrollIntoViewIfNeeded()
      await expect(image).toHaveAttribute('data-image-id', 'batch-031-1')
      await expect(image).toHaveJSProperty('naturalWidth', 32)
      await page.evaluate(() => {
        ;(window as any).firstHistoryImage = document.querySelector(
          '#imageHistory > .history-item img',
        )
      })
      await page.locator('#imagePrompt').fill('加载时仍能输入')
      await expect(page.locator('#imagePrompt')).toHaveValue('加载时仍能输入')
      await page.evaluate(() => {
        ;(window as any).historyReleased = true
      })
      await expect(page.locator('#imageHistoryTitle .history-count')).toHaveText('32')
      expect(await cards.count()).toBeLessThan(32)
      expect(
        await page.evaluate(
          () =>
            (window as any).firstHistoryImage ===
            document.querySelector('#imageHistory > .history-item img'),
        ),
      ).toBe(true)
      await page.locator('#imageHistory').evaluate((list) => { const scroller = innerWidth <= 780 ? list.closest('.content-stage')! : list; scroller.scrollTop = scroller.scrollHeight })
      const offscreen = cards.last().locator('img')
      await expect(cards.last()).toContainText('图片 0')
      await offscreen.scrollIntoViewIfNeeded()
      await expect(offscreen).toHaveAttribute('data-image-id', 'batch-000-1')
      await expect(offscreen).toHaveJSProperty('naturalWidth', 32)
      const folders = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('orbit-image-favorite-folders-v1')!),
      )
      expect(folders[0].coverImageId).toBe('batch-000-1')
    })
  }
}
