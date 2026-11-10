import { test, expect, type Page } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const preferenceIds = [
  'deleteRetriedRecordOnSuccess',
  'clearInputAfterSubmit',
  'alwaysShowRetryButton',
]
async function seed(
  page: Page,
  url: string,
  mode = 'success',
  settings: Record<string, unknown> = {},
) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.route('https://habits.test/v1/models', (route) =>
    route.fulfill({ json: { data: [{ id: 'test-image' }] } }),
  )
  await page.goto(url)
  const png = await page.evaluate(
    async ({ mode, settings }) => {
      const config = {
        model: 'test-image',
        requestType: mode === 'failed-reference' ? 'edit' : 'generation',
        count: mode === 'partial' ? 2 : 1,
        size: 'auto',
        quality: 'auto',
        format: 'png',
        compression: 'auto',
        background: 'auto',
        moderation: 'auto',
        reasoningEffort: 'auto',
        countMode: mode === 'partial' ? 'parallel' : 'parameter',
        backgroundMode: 'parameter',
        compressReferences: false,
        referenceCompressionLimitMb: 1,
      }
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            demoMode: false,
            imageApiKey: 'test-only',
            imageBaseUrl: 'https://habits.test/v1',
            imagePromptTemplates: ['shared', 'failed-shared'].includes(mode)
              ? [
                  {
                    id: 'template',
                    name: '共享参考图',
                    prompt: '参考',
                    referenceImageIds: ['old-image'],
                    createdAt: 1,
                    updatedAt: 1,
                  },
                ]
              : [],
            ...settings,
          },
          conversations: Array.from({ length: 14 }, (_, i) => ({
            id: `chat-${i}`,
            title: `对话 ${i + 1}`,
            createdAt: i + 1,
            messages:
              i === 0 && ['shared', 'failed-shared'].includes(mode)
                ? [
                    {
                      id: 'message',
                      role: 'user',
                      content: '共享图片',
                      imageIds: ['old-image'],
                      createdAt: 1,
                    },
                  ]
                : [],
          })),
          activeConversationId: 'chat-0',
        }),
      )
      localStorage.setItem(
        'orbit-image-favorite-folders-v1',
        JSON.stringify([
          {
            id: 'saved',
            name: '保留收藏',
            isDefault: true,
            hidden: mode === 'hidden',
          },
        ]),
      )
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('orbit-chat-images-v1', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('generations', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('generations', 'readwrite'),
          store = tx.objectStore('generations')
        store.clear()
        const failed = [
          'failed',
          'failed-again',
          'task-favorite',
          'partial',
          'off',
          'failed-shared',
          'failed-reference',
          'network',
        ].includes(mode)
        store.put({
          id: 'old-task',
          type: 'generation-task',
          status: failed
            ? 'error'
            : mode === 'partial-existing'
              ? 'partial'
              : 'success',
          batchId: failed ? '' : 'old-batch',
          title: '原始提示词',
          prompt: '原始提示词',
          detail: '历史记录',
          config,
          startedAt: 1,
          finishedAt: 2,
          referenceImageIds:
            mode === 'failed-reference' ? ['old-reference'] : [],
          responses: [],
          favoriteFolderIds: mode === 'task-favorite' ? ['saved'] : [],
        })
        if (!failed || mode === 'failed-shared') {
          const imageIds =
            mode === 'hidden' ? ['old-image', 'old-visible'] : ['old-image']
          for (const id of imageIds)
            store.put({
              id,
              type: 'image',
              src:
                'data:image/svg+xml,' +
                encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="red"/><text>${id}</text></svg>`,
                ),
              batchId: 'old-batch',
              taskId: 'old-task',
              prompt: '原始提示词',
              createdAt: 1,
              favoriteFolderIds:
                id === 'old-image' && ['favorite', 'hidden'].includes(mode)
                  ? ['saved']
                  : [],
            })
          store.put({
            id: 'old-batch',
            batchId: 'old-batch',
            taskId: 'old-task',
            type: 'generation-batch',
            imageIds,
            imageCount: imageIds.length,
            referenceImageIds: [],
            config,
            prompt: '原始提示词',
            createdAt: 1,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          })
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 8
      canvas.getContext('2d')!.fillStyle = 'teal'
      canvas.getContext('2d')!.fillRect(0, 0, 8, 8)
      if (mode === 'failed-reference') {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('orbit-chat-images-v1', 1)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('generations', 'readwrite')
          tx.objectStore('generations').put({
            id: 'old-reference',
            type: 'image',
            src: canvas.toDataURL('image/png'),
            createdAt: 1,
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        db.close()
      }
      return canvas.toDataURL('image/png').split(',')[1]
    },
    { mode, settings },
  )
  await page.reload()
  await expect(
    page.locator('#imageHistory [data-task-id="old-task"]').first(),
  ).toBeVisible()
  return png
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const items = await new Promise<any[]>((resolve, reject) => {
      const request = db
        .transaction('generations')
        .objectStore('generations')
        .getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return items
  })
}
async function openHabits(page: Page) {
  await page.locator('#topbarSettings').click()
  await page.locator('#settings-tab-habits').click()
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 习惯配置默认值、取消保存持久化、无重复 tooltip、侧栏计数及桌面手机截图`, async ({
    page,
  }) => {
    await seed(page, url)
    await expect(
      page.locator('#imageHistory [data-generation-action="retry-task"]'),
    ).toHaveCount(0)
    mkdirSync('/workspace/screens', { recursive: true })
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.reload()
      await openHabits(page)
      await expect(page.locator('#deleteRetriedRecordOnSuccess')).toBeChecked()
      await expect(page.locator('#clearInputAfterSubmit')).toBeChecked()
      await expect(page.locator('#alwaysShowRetryButton')).not.toBeChecked()
      await page.locator('#settings-tab-habits').hover()
      await expect(page.locator('.custom-tooltip.show')).toHaveCount(0)
      await expect(page.locator('#settings-tab-habits')).not.toHaveAttribute(
        'data-tooltip',
      )
      await page.locator('#closeSettings').hover()
      await expect(page.locator('.custom-tooltip.show')).toHaveText('关闭设置')
      await page.mouse.move(1, 1)
      await page.screenshot({
        path: `/workspace/screens/settings-habits-${version}-${width}.png`,
        animations: 'disabled',
      })
      const save = await page.locator('#saveSettings').boundingBox()
      expect(save!.x).toBeGreaterThan(width / 2)
      await page.locator('#cancelSettings').click()
      await page.locator('[data-view="chat"]').click()
      if (width === 390) await page.locator('#openSidebar').click()
      const label = page.locator('.conversation-heading-label')
      await expect(label).toContainText('最近对话')
      await expect(label.locator('#conversationCount')).toHaveText('14')
      expect(
        await page
          .locator('#conversationCount')
          .evaluate((el) => el.parentElement!.className),
      ).toBe('conversation-heading-label')
      const box = await label.boundingBox(),
        toggle = await page
          .locator('#toggleConversationSelection')
          .boundingBox()
      expect(toggle!.x).toBeGreaterThan(box!.x + box!.width)
      expect(
        Math.abs(box!.y + box!.height / 2 - toggle!.y - toggle!.height / 2),
      ).toBeLessThan(2)
      await page.locator('#openSidebar').blur()
      await page.mouse.move(width - 2, 50)
      await page.screenshot({
        path: `/workspace/screens/settings-sidebar-${version}-${width}.png`,
        animations: 'disabled',
      })
      if (width === 390) await page.locator('#closeSidebar').click()
      await page.locator('[data-view="image"]').click()
    }
    await openHabits(page)
    await page.locator('#clearInputAfterSubmit').uncheck({ force: true })
    await page.locator('#cancelSettings').click()
    await openHabits(page)
    await expect(page.locator('#clearInputAfterSubmit')).toBeChecked()
    for (const id of preferenceIds)
      await page
        .locator(`#${id}`)
        .setChecked(id === 'alwaysShowRetryButton', { force: true })
    await page.locator('#saveSettings').click()
    await expect(
      page.locator('#imageHistory [data-generation-action="retry-task"]'),
    ).toHaveCount(1)
    await page.reload()
    await openHabits(page)
    for (const id of preferenceIds)
      await expect(page.locator(`#${id}`)).toBeChecked({
        checked: id === 'alwaysShowRetryButton',
      })
  })
  test(`${version} 习惯配置导出导入和旧配置覆盖默认值`, async ({ page }) => {
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined),
    )

    await seed(page, url, 'success', {
      deleteRetriedRecordOnSuccess: false,
      clearInputAfterSubmit: false,
      alwaysShowRetryButton: true,
    })
    await openHabits(page)
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const downloadPromise = page.waitForEvent('download')
    await page.locator('[data-data-scope="config"]').click()
    const payload = JSON.parse(
      await readFile((await (await downloadPromise).path())!, 'utf8'),
    )
    expect(payload.apiConfig.settings).toMatchObject({
      deleteRetriedRecordOnSuccess: false,
      clearInputAfterSubmit: false,
      alwaysShowRetryButton: true,
    })
    // Change persisted settings first, then round-trip through the actual file importer.
    await page.locator('#settings-tab-habits').click()
    await page.locator('#clearInputAfterSubmit').check({ force: true })
    await page.locator('#saveSettings').click()
    await openHabits(page)
    await page.locator('#settings-tab-data').click()
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'settings.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload)),
    })
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('orbit-chat-state-v1')!).settings
              .clearInputAfterSubmit,
        ),
      )
      .toBe(false)
    await page.locator('#cancelSettings').click()
    await openHabits(page)
    for (const id of preferenceIds)
      await expect(page.locator(`#${id}`)).toBeChecked({
        checked: id === 'alwaysShowRetryButton',
      })
    for (const id of preferenceIds) delete payload.apiConfig.settings[id]
    await page.locator('#settings-tab-data').click()
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'legacy.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload)),
    })
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('orbit-chat-state-v1')!).settings
              .clearInputAfterSubmit,
        ),
      )
      .toBe(true)
    await page.locator('#cancelSettings').click()
    await openHabits(page)
    await expect(page.locator('#deleteRetriedRecordOnSuccess')).toBeChecked()
    await expect(page.locator('#alwaysShowRetryButton')).not.toBeChecked()
  })
  for (const clear of [true, false])
    test(`${version} 普通生图提交清空提示词=${clear}，参考图保留`, async ({
      page,
    }) => {
      const png = await seed(page, url, 'success', {
        clearInputAfterSubmit: clear,
      })
      let submitted = ''
      await page.route('https://habits.test/v1/**', (route) => {
        if (route.request().url().endsWith('/models'))
          return route.fulfill({ json: { data: [{ id: 'test-image' }] } })
        submitted = route.request().postData() || ''
        return route.fulfill({ json: { data: [{ b64_json: png }] } })
      })
      // Validation failure is not a submission and must never clear the text.
      await page.locator('#imagePrompt').fill('失效的 @图99')
      await page.locator('#generateImage').click()
      await expect(page.locator('#imagePrompt')).toHaveValue('失效的 @图99')
      expect(submitted).toBe('')
      await page.locator('#imageReferenceUpload').setInputFiles({
        name: 'ref.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      })
      await expect(page.locator('#imageReferencePreview img')).toHaveCount(1)
      await page.locator('#imagePrompt').fill('主体 @图1')
      await page.locator('#generateImage').click()
      await expect(page.locator('#imagePrompt')).toHaveValue(
        clear ? '' : '主体 @图1',
      )
      await expect
        .poll(
          async () =>
            (await records(page)).filter(
              (r) =>
                r.type === 'generation-task' &&
                r.id !== 'old-task' &&
                r.status === 'success',
            ).length,
        )
        .toBe(1)
      expect(submitted).toContain('[image 1]')
      await expect(page.locator('#imageReferencePreview img')).toHaveCount(1)
    })
  for (const mode of [
    'success',
    'failed',
    'failed-again',
    'partial',
    'partial-existing',
    'off',
    'favorite',
    'hidden',
    'task-favorite',
    'shared',
    'failed-shared',
    'failed-reference',
    'network',
  ])
    test(`${version} 重试记录清理与收藏共享资源保护: ${mode}`, async ({
      page,
    }) => {
      const png = await seed(page, url, mode, {
        alwaysShowRetryButton: true,
        deleteRetriedRecordOnSuccess: mode !== 'off',
      })
      let releaseResponse!: () => void
      const responseGate = new Promise<void>((resolve) => {
        releaseResponse = resolve
      })
      let calls = 0,
        sentPrompt = '',
        sentReference: unknown
      await page.route('https://habits.test/v1/**', async (route) => {
        if (route.request().url().endsWith('/models'))
          return route.fulfill({ json: { data: [{ id: 'test-image' }] } })
        if (mode === 'failed-reference') {
          const body = route.request().postData() || ''
          expect(body).toContain('name="image"')
          expect(body).toContain('原始提示词')
          sentPrompt = '原始提示词'
        } else {
          const body = route.request().postDataJSON()
          sentPrompt = body.prompt
          sentReference = body.image
        }
        calls++
        const requestIndex = calls
        await responseGate
        if (mode === 'network') return route.abort('failed')
        return route.fulfill(
          mode === 'failed-again' || (mode === 'partial' && requestIndex === 2)
            ? { status: 400, json: { error: { message: '重试测试失败' } } }
            : { json: { data: [{ b64_json: png }] } },
        )
      })
      await page.locator('#imageReferenceUpload').setInputFiles({
        name: 'draft-ref.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      })
      await expect(page.locator('#imageReferencePreview img')).toHaveCount(1)
      await page.locator('#imagePrompt').fill('不应被重试覆盖的未提交草稿')
      await page
        .locator(
          '#imageHistory [data-task-id="old-task"] [data-generation-action="retry-task"]',
        )
        .first()
        .click()
      const keep = [
        'success',
        'partial-existing',
        'off',
        'favorite',
        'hidden',
        'task-favorite',
        'shared',
      ].includes(mode)
      try {
        await expect.poll(() => calls).toBeGreaterThan(0)
        await expect
          .poll(async () =>
            (await records(page)).some((item) => item.id === 'old-task'),
          )
          .toBe(keep)
        await expect(
          page.locator('#imageHistory > [data-task-id="old-task"]'),
        ).toHaveCount(keep ? 1 : 0)
        await expect(
          page.locator('#imageHistory .generation-task-card.running'),
        ).toHaveCount(1)
        if (mode === 'failed-reference')
          expect(
            (await records(page)).some((item) => item.id === 'old-reference'),
          ).toBe(true)
      } finally {
        releaseResponse()
      }
      const status = ['failed-again', 'network'].includes(mode)
        ? 'error'
        : mode === 'partial'
          ? 'partial'
          : 'success'
      await expect
        .poll(
          async () =>
            (await records(page)).filter(
              (r) =>
                r.type === 'generation-task' &&
                r.id !== 'old-task' &&
                r.status === status,
            ).length,
        )
        .toBe(1)
      await expect
        .poll(async () =>
          (await records(page)).some((r) => r.id === 'old-task'),
        )
        .toBe(keep)
      const items = await records(page)
      if (!keep) {
        expect(items.some((r) => r.id === 'old-batch')).toBe(false)
        await expect(
          page.locator('#imageHistory [data-task-id="old-task"]'),
        ).toHaveCount(0)
      }
      if (['shared', 'failed-shared'].includes(mode))
        expect(items.some((r) => r.id === 'old-image')).toBe(true)
      if (['favorite', 'hidden'].includes(mode))
        expect(
          items.find((r) => r.id === 'old-image').favoriteFolderIds,
        ).toEqual(['saved'])
      if (mode === 'task-favorite')
        expect(
          items.find((r) => r.id === 'old-task').favoriteFolderIds,
        ).toEqual(['saved'])
      expect(sentPrompt).toBe('原始提示词')
      expect(sentReference).toBeUndefined()
      await expect(page.locator('#imagePrompt')).toHaveValue(
        '不应被重试覆盖的未提交草稿',
      )
      await expect(page.locator('#imageReferencePreview img')).toHaveCount(1)
      if (mode === 'failed-again') {
        const previousTask = items.find(
          (item) => item.id !== 'old-task' && item.type === 'generation-task',
        )
        await page
          .locator(
            `#imageHistory [data-task-id="${previousTask.id}"] [data-generation-action="retry-task"]`,
          )
          .first()
          .click()
        await expect
          .poll(
            async () =>
              (await records(page)).filter(
                (item) =>
                  item.type === 'generation-task' && item.status === 'error',
              ).length,
          )
          .toBe(1)
        await expect
          .poll(async () =>
            (await records(page)).some((item) => item.id === previousTask.id),
          )
          .toBe(false)
        await expect(
          page.locator('#imageHistory > [data-task-id]'),
        ).toHaveCount(1)
      }
      await page.reload()
      expect((await records(page)).some((r) => r.id === 'old-task')).toBe(keep)
    })

  test(`${version} 重试校验未通过时保留旧失败记录`, async ({ page }) => {
    await seed(page, url, 'failed', { deleteRetriedRecordOnSuccess: true })
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('orbit-chat-images-v1', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('generations', 'readwrite')
        const store = tx.objectStore('generations')
        const request = store.get('old-task')
        request.onsuccess = () => {
          const task = request.result
          task.config.background = 'transparent'
          task.config.format = 'jpeg'
          store.put(task)
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    })
    await page.reload()
    let requests = 0
    page.on('request', (request) => {
      if (request.url().includes('/images/')) requests++
    })
    await page
      .locator('#imageHistory [data-generation-action="retry-task"]')
      .first()
      .click()
    await expect(page.locator('#toast')).toContainText(
      '透明背景只支持 PNG 或 WebP 格式',
    )
    await expect(
      page.locator('#imageHistory > [data-task-id="old-task"]'),
    ).toHaveCount(1)
    expect(
      (await records(page)).filter((item) => item.type === 'generation-task'),
    ).toHaveLength(1)
    expect(requests).toBe(0)
  })

  test(`${version} 新请求记录无法写入缓存时保留旧失败记录`, async ({
    page,
  }) => {
    const png = await seed(page, url, 'failed', {
      alwaysShowRetryButton: true,
      deleteRetriedRecordOnSuccess: true,
    })
    await page.evaluate(() => {
      const store = IDBObjectStore.prototype as any
      const put = store.put
      store.put = function (value: any, ...args: any[]) {
        if (value?.type === 'generation-task' && value.id !== 'old-task')
          throw new DOMException('storage full', 'QuotaExceededError')
        return put.call(this, value, ...args)
      }
    })
    await page.route('https://habits.test/v1/**', (route) => {
      if (route.request().url().endsWith('/models'))
        return route.fulfill({ json: { data: [{ id: 'test-image' }] } })
      return route.fulfill({
        json: { data: [{ b64_json: png }] },
      })
    })
    await page
      .locator(
        '#imageHistory [data-task-id="old-task"] [data-generation-action="retry-task"]',
      )
      .first()
      .click()
    await expect(page.locator('#toast')).toContainText(
      version === 'Vue'
        ? '新请求记录未能保存到本地，旧记录已保留'
        : '本地存储未完成，已保留旧记录',
    )
    expect(
      (await records(page)).some((record) => record.id === 'old-task'),
    ).toBe(true)
  })
}
