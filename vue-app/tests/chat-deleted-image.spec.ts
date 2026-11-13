import { expect, test, type Page } from '@playwright/test'

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII='

async function seed(page: Page) {
  await page.route('**/__storage_seed', (route) =>
    route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
  )
  await page.goto('/__storage_seed')
  await page.evaluate((png) => {
    const src = 'data:image/png;base64,' + png
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          demoMode: true,
          chatBaseUrl: 'https://deleted.test/v1',
          chatApiKey: 'test',
          chatModel: 'test-chat',
        },
        conversations: [
          {
            id: 'chat',
            title: '引用生图',
            createdAt: 1,
            messages: [
              {
                id: 'user',
                role: 'user',
                content: '看这张图',
                imageIds: ['upload'],
                createdAt: 1,
              },
              {
                id: 'assistant',
                role: 'assistant',
                content: '已生成',
                imageIds: [],
                steps: [
                  {
                    type: 'image',
                    batchId: 'batch',
                  },
                ],
                createdAt: 2,
              },
            ],
          },
        ],
        activeConversationId: 'chat',
      }),
    )
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('generations', { keyPath: 'id' })
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('generations', 'readwrite')
        const store = tx.objectStore('generations')
        store.put({
          id: 'upload',
          type: 'image',
          src,
          name: '上传.png',
          createdAt: 1,
        })
        store.put({
          id: 'gen',
          type: 'image',
          src,
          name: '生成.png',
          createdAt: 2,
          batchId: 'batch',
          prompt: '一只猫',
          config: { model: 'test-image' },
        })
        store.put({
          id: 'batch',
          type: 'generation-batch',
          batchId: 'batch',
          taskId: 'task',
          prompt: '一只猫',
          config: { model: 'test-image' },
          imageIds: ['gen'],
          referenceImageIds: [],
          imageCount: 1,
          startedAt: 1,
          createdAt: 2,
          completedAt: 2,
          durationMs: 10,
        })
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
  }, tinyPng)
}

async function storedIds(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const names = [...db.objectStoreNames]
    const ids: string[] = []
    for (const name of names) {
      const records = await new Promise<any[]>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      for (const record of records) if (record?.id) ids.push(String(record.id))
    }
    db.close()
    return ids
  })
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
] as const) {
  test(`${version} 删除生图历史后对话显示已删除占位, 上传图保留且下一轮可发送`, async ({
    page,
  }) => {
    page.on('dialog', (dialog) => dialog.accept())
    await seed(page)
    await page.goto(url)
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-image[data-image-id="upload"]')).toBeVisible()
    await expect(page.locator('.message-image[data-image-id="gen"]')).toBeVisible()
    await expect(page.locator('.message-image-missing')).toHaveCount(0)

    await page.locator('[data-view="image"]').click()
    const remove = page.locator('[data-history-action="delete"]').first()
    await expect(remove).toBeVisible({ timeout: 15000 })
    await remove.click()
    await expect
      .poll(async () => storedIds(page))
      .not.toEqual(expect.arrayContaining(['gen', 'batch']))
    await expect.poll(async () => storedIds(page)).toEqual(expect.arrayContaining(['upload']))

    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-image[data-image-id="upload"]')).toBeVisible()
    await expect(page.locator('.message-image[data-image-id="gen"]')).toHaveCount(0)
    await expect(page.locator('.message-image-missing')).toHaveText(['已删除'])

    await page.locator('#messageInput').fill('下一轮还在')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.user').last()).toContainText('下一轮还在')
    await expect(page.locator('.message-error')).toHaveCount(0)
    await expect(page.locator('.message.assistant').last()).toBeVisible({
      timeout: 15000,
    })
  })
}
