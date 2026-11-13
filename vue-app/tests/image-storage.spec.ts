import { readBackup } from './helpers/backup'
import { expect, test, type Page } from '@playwright/test'
import { createImageStorage } from '../src/storage/image-assets.js'
import { readFile } from 'node:fs/promises'

async function seedLegacy(page: Page) {
  await page.route('**/__storage_seed', (route) =>
    route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
  )
  await page.goto('/__storage_seed')
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = 800
    const context = canvas.getContext('2d')!
    context.fillStyle = '#538a67'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const src = canvas.toDataURL('image/png')
    localStorage.setItem('unrelated-setting', 'keep')
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          demoMode: false,
          chatBaseUrl: 'https://storage.test/v1',
          chatApiKey: 'test',
          chatModel: 'test-chat',
          compressRequestImages: false,
          imagePromptTemplates: [
            {
              id: 'template',
              name: '旧模板',
              prompt: '共享参考图',
              referenceImageIds: ['shared'],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        conversations: [
          {
            id: 'chat',
            title: '共享图片',
            createdAt: 1,
            messages: [
              {
                id: 'user',
                role: 'user',
                content: '原来的图片',
                imageIds: ['shared'],
                createdAt: 1,
              },
            ],
          },
        ],
        activeConversationId: 'chat',
      }),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('generations', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('generations', 'readwrite')
      const store = tx.objectStore('generations')
      store.put({
        id: 'shared',
        type: 'image',
        src,
        name: '原图.png',
        createdAt: 1,
      })
      store.put({
        id: 'batch',
        type: 'generation-batch',
        batchId: 'batch',
        taskId: '',
        prompt: '旧图片',
        config: {
          model: 'old-model',
          count: 1,
          format: 'png',
          size: '1600x800',
        },
        imageIds: ['shared'],
        referenceImageIds: ['shared'],
        imageCount: 1,
        startedAt: 1,
        createdAt: 1,
        durationMs: 10,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
    return src
  })
}

async function stored(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const read = (name: string) =>
      new Promise<any[]>((resolve, reject) => {
        const request = db.transaction(name).objectStore(name).getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    const records = await read('generations')
    const assets = await read('image-assets')
    const thumbnails = await read('image-thumbnails')
    const result = {
      version: db.version,
      records,
      assets: await Promise.all(
        assets.map(async (item) => ({
          id: item.id,
          size: item.blob.size,
          data: await new Promise((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result)
            reader.readAsDataURL(item.blob)
          }),
        })),
      ),
      thumbnails: thumbnails.map((item) => ({
        id: item.id,
        type: item.blob.type,
        size: item.blob.size,
      })),
    }
    db.close()
    return result
  })
}

test('Blob 地址同图复用, 预览请求复用缩略图, 失效后释放地址', async ({
  page,
}) => {
  await page.route('**/__blob_test', (route) =>
    route.fulfill({ body: '<html></html>', contentType: 'text/html' }),
  )
  await page.goto('/__blob_test')
  const result = await page.evaluate(async (source) => {
    const create = new Function('return (' + source + ')')()
    const created: string[] = [],
      revoked: string[] = []
    const originalCreate = URL.createObjectURL.bind(URL)
    const originalRevoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const value = originalCreate(blob)
      created.push(value)
      return value
    }
    URL.revokeObjectURL = (url) => {
      revoked.push(url)
      originalRevoke(url)
    }
    const storage = create({
      dbName: 'orbit-blob-test',
      storeName: 'records',
      fetch: (url: string) => fetch(url),
      thumbnail: async (blob: Blob) => blob,
    })
    try {
      const src = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
      storage.retain({ id: 'image', src })
      const values = await Promise.all(
        Array.from({ length: 20 }, () =>
          storage.acquire('orbit-image:image', true),
        ),
      )
      const unique = new Set(values.map((v: any) => v.src)).size
      await storage.previewDataUrl('orbit-image:image')
      const beforeOriginal = created.length
      const original = await storage.acquire('orbit-image:image', false)
      values.forEach((v: any) => v.release())
      await storage.writeRecords([], [], true)
      const keptWhileUsed = !revoked.includes(original.src)
      original.release()
      return {
        unique,
        beforeOriginal,
        created: created.length,
        revoked: revoked.length,
        keptWhileUsed,
      }
    } finally {
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      ;(await storage.open()).close()
      indexedDB.deleteDatabase('orbit-blob-test')
    }
  }, createImageStorage.toString())
  expect(result).toEqual({
    unique: 1,
    beforeOriginal: 1,
    created: 2,
    revoked: 2,
    keptWhileUsed: true,
  })
})

for (const [version, url, other] of [
  ['HTML', '/index.html', '/vue-app/dist/index.html'],
  ['Vue', '/vue-app/dist/index.html', '/index.html'],
]) {
  test(`${version} 旧图片迁移为 Blob, 缩略图展示, 原图预览与聊天请求, 双入口共享`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const original = await seedLegacy(page)
    const requests: any[] = []
    await page.route('https://storage.test/v1/chat/completions', (route) => {
      requests.push(route.request().postDataJSON())
      return route.fulfill({
        json: { choices: [{ message: { content: '收到原图' } }] },
      })
    })
    await page.goto(url)
    const thumbnail = page.locator('.history-image-button img').first()
    await expect(thumbnail).toHaveJSProperty('naturalWidth', 640)
    await expect(thumbnail).toHaveJSProperty('naturalHeight', 320)
    await expect.poll(async () => (await stored(page)).assets.length).toBe(1)
    const data = await stored(page)
    expect(data.version).toBe(2)
    expect(data.records.find((record) => record.id === 'shared').src).toBe('')
    expect(data.assets[0].data).toBe(original)
    expect(data.thumbnails[0].type).toBe('image/webp')
    await page.locator('.history-image-button').first().click()
    await expect(page.locator('#lightboxImage')).toHaveJSProperty(
      'naturalWidth',
      1600,
    )
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('#lightboxDownload').click(),
    ])
    expect(await readFile((await download.path())!)).toEqual(
      Buffer.from(original.split(',')[1], 'base64'),
    )
    await page.locator('#lightboxCopyChat').click()
    await page.locator('#messageInput').fill('继续看这张图片')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant')).toContainText('收到原图')
    expect(requests).toHaveLength(1)
    const imageParts = requests[0].messages.flatMap((message: any) =>
      Array.isArray(message.content)
        ? message.content.filter((part: any) => part.type === 'image_url')
        : [],
    )
    expect(imageParts).toHaveLength(1)
    expect(
      imageParts.every((part: any) =>
        part.image_url.url.startsWith('data:image/webp;base64,'),
      ),
    ).toBe(true)
    expect(JSON.stringify(requests)).not.toContain('orbit-image:')
    expect((await stored(page)).assets).toHaveLength(1)
    await page.goto(other)
    await expect(
      page.locator('.history-image-button img').first(),
    ).toHaveJSProperty('naturalWidth', 640)
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-image').first()).toHaveJSProperty(
      'naturalWidth',
      1600,
    )
    await expect(page.locator('.message.assistant')).toContainText('收到原图')
    expect(errors).toEqual([])
  })

  test(`${version} 删除生图记录后仍保留聊天引用图片`, async ({ page }) => {
    await seedLegacy(page)
    await page.evaluate(async () => {
      const state = JSON.parse(localStorage.getItem('orbit-chat-state-v1')!)
      state.conversations[0].messages[0].role = 'assistant'
      state.conversations[0].messages[0].content = 'AI 生成的图片'
      localStorage.setItem('orbit-chat-state-v1', JSON.stringify(state))
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('orbit-chat-images-v1')
        request.onsuccess = () => resolve(request.result)
      })
      await new Promise<void>((resolve) => {
        const tx = db.transaction('generations', 'readwrite')
        const store = tx.objectStore('generations')
        const request = store.get('shared')
        request.onsuccess = () =>
          store.put({
            ...request.result,
            batchId: 'batch',
            prompt: 'AI 生成的图片',
            config: { model: 'image-model', format: 'png', count: 1 },
          })
        tx.oncomplete = () => resolve()
      })
      db.close()
    })
    await page.goto(url)
    await page.locator('[data-view="image"]').click()
    const card = page.locator('#imageHistory .history-item').first()
    await card.hover()
    page.once('dialog', (dialog) => dialog.accept())
    await card.locator('[data-history-action="delete"]').click()
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(0)
    await expect
      .poll(async () => (await stored(page)).assets.length)
      .toBe(1)

    await page.locator('[data-view="chat"]').click()
    const messageImage = page.locator('.message-image-button').first()
    await expect(messageImage.locator('img')).toHaveJSProperty(
      'naturalWidth',
      1600,
    )
    await messageImage.click()
    await expect(page.locator('#imageLightbox')).toBeVisible()
    await expect(page.locator('#lightboxImage')).toHaveJSProperty(
      'naturalWidth',
      1600,
    )
  })

  test(`${version} 切换手机宽度后多张聊天原图保留尺寸且可稳定打开`, async ({
    page,
  }) => {
    await seedLegacy(page)
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1024
      canvas.getContext('2d')!.fillRect(0, 0, 1024, 1024)
      const src = canvas.toDataURL()
      const state = JSON.parse(localStorage.getItem('orbit-chat-state-v1')!)
      state.settings.chatImageTools = state.settings.chatStream = true
      state.conversations[0].messages = [
        {
          id: 'u1',
          role: 'user',
          content: '生成图片',
          imageIds: [],
          createdAt: 1,
        },
        {
          id: 'a1',
          role: 'assistant',
          content: '生成结果',
          imageIds: ['shared'],
          createdAt: 2,
        },
        {
          id: 'u2',
          role: 'user',
          content: '使用两张参考图',
          imageIds: ['shared', 'second'],
          createdAt: 3,
        },
        {
          id: 'a2',
          role: 'assistant',
          content: '已生成两张图片\n\n- 图一\n- 图二',
          imageIds: ['shared', 'second'],
          createdAt: 4,
        },
      ]
      localStorage.setItem('orbit-chat-state-v1', JSON.stringify(state))
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('orbit-chat-images-v1')
        request.onsuccess = () => resolve(request.result)
      })
      await new Promise<void>((resolve) => {
        const tx = db.transaction('generations', 'readwrite')
        for (const id of ['shared', 'second'])
          tx.objectStore('generations').put({
            id,
            type: 'image',
            src,
            name: '原图',
            createdAt: 1,
          })
        tx.oncomplete = () => resolve()
      })
      db.close()
    })
    await page.goto(url)
    await page.locator('[data-view="chat"]').click()
    const stage = page.locator('.content-stage')
    await stage.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    const last = page.locator('.message.assistant .message-image').last()
    await expect(last).toHaveJSProperty('naturalWidth', 1024)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(() =>
        page
          .locator('#sidebar')
          .evaluate((el) => el.getBoundingClientRect().right),
      )
      .toBeLessThan(1)
    await stage.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(last).toHaveJSProperty('naturalWidth', 1024)
    const positions = await last.evaluate(
      (el) =>
        new Promise<number[]>((resolve) => {
          const values: number[] = []
          const sample = () => {
            values.push(el.getBoundingClientRect().y)
            if (values.length < 45) requestAnimationFrame(sample)
            else resolve(values)
          }
          requestAnimationFrame(sample)
        }),
    )
    expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2)
    await last.click()
    await expect(page.locator('#chatImageViewer')).toBeVisible()
    await expect(page.locator('#viewerImage')).toHaveJSProperty(
      'naturalWidth',
      1024,
    )
  })

  test(`${version} 图片右键使用原图, 聊天可引用待发送图片`, async ({
    page,
  }) => {
    const requests: any[] = []
    await page.route('https://storage.test/v1/**', async (route) => {
      if (route.request().url().endsWith('/models'))
        return route.fulfill({ json: { data: [] } })
      requests.push(route.request().postDataJSON())
      return route.fulfill({
        json: { choices: [{ message: { content: '图片已分析' } }] },
      })
    })
    await seedLegacy(page)
    await page.goto(url)

    const historyImage = page.locator('.history-image-button img').first()
    await expect(historyImage).toHaveAttribute('data-image-id', 'shared')
    await historyImage.click({ button: 'right' })
    const actions = await historyImage
      .locator('xpath=ancestor::article')
      .locator('.history-actions button')
      .evaluateAll((buttons) =>
        buttons.map(
          (button) =>
            button.getAttribute('aria-label') ||
            (button as HTMLElement).dataset.tooltip ||
            button.textContent,
        ),
      )
    await expect(
      page.locator('.image-context-menu [role="menuitem"]'),
    ).toHaveText(actions as string[])
    await page.getByRole('menuitem', { name: '编辑输出' }).click()
    await expect(
      page.locator('#imageReferencePreview .reference-preview-item'),
    ).toHaveCount(1)

    await page.locator('[data-view="chat"]').click()
    const chatImage = page.locator('.message-image').first()
    await expect(chatImage).toHaveAttribute('data-image-id', 'shared')
    await chatImage.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '查看原图' }).click()
    await expect(page.locator('#viewerImage:visible, #lightboxImage:visible')).toHaveJSProperty(
      'naturalWidth',
      1600,
    )
    await page.locator('#closeImageViewer:visible, #closeLightbox:visible').click()
    await chatImage.click({ button: 'right' })
    await page.getByRole('menuitem', { name: '引用图片' }).click()
    await expect(page.locator('#messageInput')).toHaveValue('@图1 ')
    await expect(page.locator('#attachmentPreview img')).toHaveCount(0)

    await page.locator('#imageUpload').setInputFiles({
      name: 'current-turn.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.locator('.attachment-item')).toHaveCount(1)
    const input = page.locator('#messageInput')
    await input.fill('分析 @')
    const mentions = page.locator('.image-mention-option')
    await expect(mentions).toHaveCount(2)
    await mentions.nth(1).click()
    await expect(input).toHaveValue('分析 @图2')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant')).toContainText('图片已分析')

    expect(requests).toHaveLength(1)
    const userMessage = requests[0].messages
      .filter((message: any) => message.role === 'user')
      .at(-1)
    expect(userMessage.content[0].text).toMatch(/^分析 \[图片 ID: .+\]$/)
    expect(
      userMessage.content.filter((part: any) => part.type === 'image_url'),
    ).toHaveLength(1)
  })

  test(`${version} 导出含原图, 导入去重, 分范围清理保留共享引用并回收文件`, async ({
    page,
  }) => {
    const original = await seedLegacy(page)
    await page.goto(url)
    await expect(
      page.locator('.history-image-button img').first(),
    ).toHaveJSProperty('naturalWidth', 640)
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
    )
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-data-scope="workspace"]').click(),
    ])
    const backup = await readFile((await download.path())!)
    const payload = readBackup(backup)
    expect(payload.images).toHaveLength(1)
    expect(payload.images[0].src).toBe(original)
    expect(payload.conversations[0].messages[0].imageIds).toEqual(['shared'])
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'backup.json',
      mimeType: 'application/json',
      buffer: backup,
    })
    await expect(page.locator('#toast')).toContainText('合并导入')
    await expect(page.locator('#importProgress')).toBeHidden()
    expect((await stored(page)).assets).toHaveLength(1)
    async function clear(scope: string) {
      if (!(await page.locator('#settingsBackdrop').isVisible()))
        await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-data').click()
      await page.locator('#resetLocalData').click()
      await page.locator(`[data-data-scope="${scope}"]`).click()
      await expect(page.locator('#settingsBackdrop')).toBeHidden()
    }
    await clear('image')
    expect((await stored(page)).assets).toHaveLength(1)
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-image')).toHaveJSProperty(
      'naturalWidth',
      1600,
    )
    await clear('config')
    expect((await stored(page)).assets).toHaveLength(1)
    await clear('chat')
    const remaining = await stored(page)
    expect(remaining.records).toEqual([])
    expect(remaining.assets).toEqual([])
    expect(remaining.thumbnails).toEqual([])
    expect(
      await page.evaluate(() => localStorage.getItem('unrelated-setting')),
    ).toBe('keep')
  })

  test(`${version} 上传图片的 ID 可交给 Agent 改图, 本轮发送预览而历史只留 ID`, async ({
    page,
  }) => {
    const original = await seedLegacy(page)
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('orbit-chat-state-v1')!)
      state.conversations[0].messages = []
      Object.assign(state.settings, {
        chatImageTools: true,
        chatStream: false,
        imageBaseUrl: 'https://storage.test/v1',
        imageApiKey: 'test',
        imageModel: 'test-image',
      })
      localStorage.setItem('orbit-chat-state-v1', JSON.stringify(state))
    })
    const requests: any[] = []
    let edited: Buffer | undefined
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII='
    await page.route('https://storage.test/v1/**', async (route) => {
      const request = route.request()
      if (request.url().endsWith('/models'))
        return route.fulfill({ json: { data: [] } })
      if (request.url().endsWith('/images/edits')) {
        const form = await new Response(request.postDataBuffer()!, {
          headers: { 'Content-Type': request.headers()['content-type'] },
        }).formData()
        const file = form.get('image[]') || form.get('image')
        edited = Buffer.from(await (file as File).arrayBuffer())
        return route.fulfill({ json: { data: [{ b64_json: png }] } })
      }
      const body = request.postDataJSON()
      requests.push(body)
      const message =
        body.tools && body.messages.at(-1).role !== 'tool'
          ? {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'edit-upload',
                  type: 'function',
                  function: {
                    name: 'generate_image',
                    arguments: JSON.stringify({
                      prompt: '根据参考图修改颜色',
                      reference_image_ids: ['shared'],
                    }),
                  },
                },
              ],
            }
          : { role: 'assistant', content: '已完成' }
      return route.fulfill({ json: { choices: [{ message }] } })
    })
    await page.goto(url)
    await page.locator('[data-view="chat"]').click()
    await page.locator('#imageUpload').setInputFiles({
      name: '我上传的原图.png',
      mimeType: 'image/png',
      buffer: Buffer.from(original.split(',')[1], 'base64'),
    })
    await page.locator('#messageInput').fill('修改这张图的颜色')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '已完成',
    )
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
    expect(edited).toEqual(Buffer.from(original.split(',')[1], 'base64'))
    const first = requests[0].messages.at(-1).content
    expect(
      first.some((part: any) => part.text?.includes('图片 ID: shared')),
    ).toBe(true)
    const preview = first.find((part: any) => part.type === 'image_url')
      .image_url.url
    const dimensions = await page.evaluate(async (source) => {
      const bitmap = await createImageBitmap(await (await fetch(source)).blob())
      const size = [bitmap.width, bitmap.height]
      bitmap.close()
      return size
    }, preview)
    expect(dimensions).toEqual([640, 320])
    await expect(
      page.locator('.message.user .message-image').first(),
    ).toHaveJSProperty('naturalWidth', 1600)
    await page.locator('#chatImageTools').uncheck()
    await page.locator('#messageInput').fill('继续聊')
    await page.locator('#sendButton').click()
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
    const previous = requests.at(-1).messages
    expect(JSON.stringify(previous)).toContain('图片 ID: shared')
    expect(JSON.stringify(previous)).not.toContain('image_url')
    await page
      .locator('.message.user .message-image')
      .first()
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: '引用图片' }).click()
    await page.locator('#sendButton').click()
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
    const last = requests.at(-1).messages.at(-1).content
    expect(last[0].text).toContain('[图片 ID: shared]')
    expect(last.filter((part: any) => part.type === 'image_url')).toHaveLength(
      1,
    )
    expect(
      (await stored(page)).assets.find((item) => item.id === 'shared')?.data,
    ).toBe(original)
  })

  for (const width of [1440, 390])
    test(`${version} ${width}px 千条记录仅渲染可见区域, 滚动后可继续查看原图`, async ({
      page,
    }) => {
      await seedLegacy(page)
      await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const request = indexedDB.open('orbit-chat-images-v1')
          request.onsuccess = () => resolve(request.result)
        })
        await new Promise<void>((resolve) => {
          const tx = db.transaction('generations', 'readwrite')
          const store = tx.objectStore('generations')
          store.delete('batch')
          for (let index = 0; index < 1000; index++)
            store.put({
              id: 'batch-' + index,
              type: 'generation-batch',
              batchId: 'batch-' + index,
              taskId: '',
              prompt: '记录 ' + index,
              config: { model: 'test', count: 1, size: '1600x800' },
              imageIds: ['shared'],
              referenceImageIds: [],
              imageCount: 1,
              startedAt: index + 1,
              createdAt: index + 1,
              durationMs: 10,
            })
          tx.oncomplete = () => resolve()
        })
        db.close()
      })
      await page.setViewportSize({ width, height: 844 })
      await page.goto(url)
      await expect(
        page.locator('#imageHistoryTitle .history-count'),
      ).toHaveText('1000')
      await expect(page.locator('.history-item').first()).toContainText(
        '记录 999',
      )
      expect(await page.locator('.history-item').count()).toBeLessThan(40)
      const scroller = page.locator(
        width === 390 ? '.content-stage' : '#imageHistory',
      )
      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await expect(page.locator('.history-item').last()).toContainText('记录 0')
      expect(await page.locator('.history-item').count()).toBeLessThan(40)
      await page.locator('.history-image-button').last().click()
      await expect(page.locator('#lightboxImage')).toHaveJSProperty(
        'naturalWidth',
        1600,
      )
    })
}
