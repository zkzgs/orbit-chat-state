import { test, expect, type Page } from '@playwright/test'

async function seedWorkspace(page: Page, count = 4) {
  await page.goto('/index.html')
  await page.evaluate(async (count) => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: { demoMode: true },
        conversations: [
          { id: 'parity-chat', title: '新对话', createdAt: 1, messages: [] },
        ],
        activeConversationId: 'parity-chat',
      }),
    )
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        { id: 'favorites-default', name: '默认收藏夹', isDefault: true },
      ]),
    )
    const canvas = document.createElement('canvas')
    canvas.width = 1672
    canvas.height = 941
    canvas.getContext('2d')!.fillRect(0, 0, canvas.width, canvas.height)
    const src = canvas.toDataURL('image/png')
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
      store.clear()
      for (let i = 0; i < count; i++) {
        const config = {
          model: 'gpt-image-2.5',
          sizeMode: 'ratio',
          resolution: '4K',
          ratio: '16:9',
          width: 3840,
          height: 2160,
          size: '3840x2160',
          quality: 'max',
          format: 'png',
          compression: 0,
          background: 'opaque',
          moderation: 'auto',
          count: 1,
          countMode: 'parallel',
          backgroundMode: 'prompt',
          compressReferences: true,
          referenceCompressionLimitMb: 1,
        }
        const createdAt = 1793633017000 - i * 60000
        const responseMeta = {
          source: 'https://aixor.cc/v1/images/edits',
          size: '1672x941',
          output_format: 'png',
          delivery: 'b64_json',
          moderationSent: true,
        }
        store.put({
          id: `parity-image-${i}`,
          type: 'image',
          src,
          createdAt,
          prompt: `主体拿着手机自拍, 手放在衣服上 ${i}`,
          config,
          responseMeta,
          width: 1672,
          height: 941,
        })
        store.put({
          id: `parity-batch-${i}`,
          batchId: `parity-batch-${i}`,
          type: 'generation-batch',
          taskId: `parity-task-${i}`,
          prompt: `主体拿着手机自拍, 手放在衣服上 ${i}`,
          config,
          responseMeta,
          imageIds: [`parity-image-${i}`],
          referenceImageIds: [],
          imageCount: 1,
          startedAt: createdAt - 42000,
          createdAt,
          completedAt: createdAt,
          durationMs: 42000,
        })
        store.put({
          id: `parity-task-${i}`,
          type: 'generation-task',
          status: 'success',
          batchId: `parity-batch-${i}`,
          prompt: `主体拿着手机自拍, 手放在衣服上 ${i}`,
          config,
          startedAt: createdAt - 42000,
          finishedAt: createdAt,
          referenceImageIds: [],
          requestPhases: [],
          responses: [],
          requestLog: { method: 'POST', contentType: 'multipart/form-data' },
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }, count)
  await page.reload()
  await expect(page.locator('.history-item')).toHaveCount(count)
}

async function referenceFile(page: Page, color: string) {
  const data = await page.evaluate((color) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 32
    const context = canvas.getContext('2d')!
    context.fillStyle = color
    context.fillRect(0, 0, 32, 32)
    return canvas.toDataURL().split(',')[1]
  }, color)
  return {
    name: `${color}.png`,
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  }
}

async function imageEvent(
  page: Page,
  selector: string,
  color: string,
  kind: 'paste' | 'drop',
) {
  const file = await referenceFile(page, color)
  await page.locator(selector).evaluate(
    (element, args) => {
      const transfer = new DataTransfer()
      transfer.items.add(
        new File(
          [Uint8Array.from(atob(args.data), (char) => char.charCodeAt(0))],
          'reference.png',
          { type: 'image/png' },
        ),
      )
      element.dispatchEvent(
        args.kind === 'paste'
          ? new ClipboardEvent('paste', {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            })
          : new DragEvent('drop', {
              dataTransfer: transfer,
              bubbles: true,
              cancelable: true,
            }),
      )
    },
    { data: file.buffer.toString('base64'), kind },
  )
}

test('共用同一份缓存时, 重构版历史、详情、参考图及设置与旧版一致', async ({
  page,
  context,
}) => {
  await seedWorkspace(page)
  const vue = await context.newPage()
  await vue.goto('/vue-app/dist/index.html')
  await expect(vue.locator('.history-item')).toHaveCount(4)

  await expect(vue.locator('.history-item-time')).toHaveText(
    await page.locator('.history-item-time').allTextContents(),
  )
  for (const current of [page, vue]) {
    await current.locator('.history-image-button').first().click()
    await expect(current.locator('#imageMetadata')).toContainText('1672')
    await expect(current.locator('#imageMetadata')).toContainText('PNG 不支持')
  }
  const metadata = async (current: Page) =>
    current.locator('#imageMetadata .metadata-card').evaluateAll((cards) =>
      cards.map((card) => ({
        label: card.querySelector('dt')?.textContent?.trim(),
        value: card
          .querySelector('dd')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim(),
        full: card.classList.contains('full'),
      })),
    )
  await expect.poll(async () => metadata(vue)).toEqual(await metadata(page))
  for (const current of [page, vue]) {
    await current.locator('#closeLightbox').click()
    await current.locator('#topbarSettings').click()
  }
  const strayText = async (current: Page) =>
    current
      .locator('#settingsBackdrop .field-label')
      .evaluateAll((labels) =>
        labels.flatMap((label) =>
          [...label.childNodes]
            .filter(
              (node) =>
                node.nodeType === Node.TEXT_NODE &&
                node.textContent?.trim() === '>',
            )
            .map((node) => node.textContent),
        ),
      )
  expect(await strayText(vue)).toEqual(await strayText(page))
})

test('收藏只更新目标记录, 不重写全库, 不覆盖另一个页面的新记录', async ({
  page,
  context,
}) => {
  await seedWorkspace(page, 18)
  const vue = await context.newPage()
  await vue.goto('/vue-app/dist/index.html')
  await expect(vue.locator('.history-item')).toHaveCount(18)
  await vue.evaluate(() => {
    const stats = { removedCards: 0 }
    Object.assign(window, { favoriteDomStats: stats })
    new MutationObserver((changes) => {
      for (const change of changes)
        for (const node of change.removedNodes)
          if (node instanceof Element)
            stats.removedCards += node.matches('.history-item')
              ? 1
              : node.querySelectorAll('.history-item').length
    }).observe(document.querySelector('#imageHistory')!, {
      childList: true,
      subtree: true,
    })
  })
  await vue.evaluate(() => {
    const writes = { clears: 0, ids: [] as string[] }
    Object.assign(window, { favoriteWrites: writes })
    const put = IDBObjectStore.prototype.put
    const clear = IDBObjectStore.prototype.clear
    IDBObjectStore.prototype.put = function (value, key) {
      writes.ids.push(value.id)
      return key === undefined
        ? put.call(this, value)
        : put.call(this, value, key)
    }
    IDBObjectStore.prototype.clear = function () {
      writes.clears++
      return clear.call(this)
    }
  })
  // 两页都已加载, 旧页面此时产生一条新记录, 新页面仍持有旧快照
  await page.locator('#imagePrompt').fill('另一个页面刚生成的图片')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item')).toHaveCount(19)
  await vue.locator('[data-history-action="favorite"]').first().click()
  await expect(vue.locator('#favoriteFolderBackdrop')).toBeVisible()
  await vue.locator('#saveFavoriteFolderChoices').click()
  await expect(vue.locator('#favoriteFolderBackdrop')).toBeHidden()
  const writes = await vue.evaluate(() => (window as any).favoriteWrites)
  const domStats = await vue.evaluate(() => (window as any).favoriteDomStats)
  expect(writes.clears).toBe(0)
  expect(writes.ids).toEqual(['parity-image-0'])
  expect(domStats.removedCards).toBe(0)
  await page.reload()
  await expect(page.locator('.history-item')).toHaveCount(19)
  await vue.reload()
  await expect(vue.locator('.history-item')).toHaveCount(19)
})

test('聊天提示分隔点和接口链接间距与旧版一致', async ({ page, context }) => {
  await page.goto('/index.html')
  const vue = await context.newPage()
  await vue.goto('/vue-app/dist/index.html')
  const measure = async (current: Page) => {
    await current.locator('[data-view="chat"]').click()
    return current.locator('.composer-footnote').evaluate((element) => {
      const separator =
        element.querySelector('.composer-footnote-separator') ||
        element.querySelector('span')!
      const link = element.querySelector('#openSettingsFromFootnote')!
      const range = new Range()
      range.selectNodeContents(separator)
      const point = range.getBoundingClientRect()
      const copy =
        element.querySelector('.composer-footnote-copy') || element.firstChild!
      return {
        text: `${copy.textContent.trimEnd()} · ${link.textContent.trim()}`,
        dotLeft: point.left,
        dotRight: point.right,
        linkLeft: link.getBoundingClientRect().left,
      }
    })
  }
  const old = await measure(page)
  const next = await measure(vue)
  expect(next.text).toBe(old.text)
  expect(Math.abs(next.dotLeft - old.dotLeft)).toBeLessThan(1)
  expect(Math.abs(next.dotRight - old.dotRight)).toBeLessThan(1)
  expect(Math.abs(next.linkLeft - old.linkLeft)).toBeLessThan(1)
})

test('移动端长历史先呈现列表, 视口外图片延迟加载', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedWorkspace(page, 32)
  await page.goto('/vue-app/dist/index.html')
  await expect(page.locator('.history-item')).toHaveCount(32)
  const images = page.locator('#imageHistory img')
  await expect(images).toHaveCount(32)
  await expect
    .poll(() =>
      images.evaluateAll(
        (items) =>
          items.filter((image) => image.hasAttribute('data-image-id')).length,
      ),
    )
    .toBe(32)
  await images.first().scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      images.evaluateAll(
        (items) =>
          items.filter((image) => !image.hasAttribute('data-image-id')).length,
      ),
    )
    .toBeGreaterThan(0)
  await expect
    .poll(() =>
      images.first().evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1672)
  await expect
    .poll(() =>
      images.evaluateAll(
        (items) =>
          items.filter((image) => image.hasAttribute('data-image-id')).length,
      ),
    )
    .toBeGreaterThan(0)
  await images.last().scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      images.last().evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1672)
})

test('合并导入替换同一条记录的图片后, 缩略图同步更新', async ({ page }) => {
  await seedWorkspace(page, 1)
  await page.goto('/vue-app/dist/index.html')
  const image = page.locator('#imageHistory img')
  await expect(image).toHaveAttribute('src', /^data:image\/png/)
  const blue = `data:image/png;base64,${(await referenceFile(page, 'blue')).buffer.toString('base64')}`
  const payload = await page.evaluate(async (src) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onsuccess = () => resolve(request.result)
    })
    const records = await new Promise<any[]>((resolve) => {
      const request = db
        .transaction('generations')
        .objectStore('generations')
        .getAll()
      request.onsuccess = () => resolve(request.result)
    })
    db.close()
    return {
      version: 12,
      scope: 'image',
      images: records
        .filter((record) => record.type === 'image')
        .map((record) => ({ ...record, src })),
      imageHistory: records.filter(
        (record) => record.type === 'generation-batch',
      ),
      imageTasks: records.filter((record) => record.type === 'generation-task'),
    }
  }, blue)
  await page.locator('#topbarSettings').click()
  page.on('dialog', (dialog) =>
    dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
  )
  await page.locator('#workspaceImportFile').setInputFiles({
    name: 'image.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(payload)),
  })
  await expect(page.locator('#toast')).toContainText('合并导入')
  await page.locator('#cancelSettings').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await expect
    .poll(async () => (await image.getAttribute('src')) === blue)
    .toBe(true)
  await page.reload()
  await expect
    .poll(async () => (await image.getAttribute('src')) === blue)
    .toBe(true)
})

test('生图与润色的缩略图、右键引用、粘贴和拖入保持旧版行为', async ({
  page,
  context,
}) => {
  await seedWorkspace(page)
  const vue = await context.newPage()
  await vue.goto('/vue-app/dist/index.html')
  for (const current of [page, vue]) {
    await current
      .locator('#imageReferenceUpload')
      .setInputFiles([
        await referenceFile(current, 'red'),
        await referenceFile(current, 'blue'),
      ])
    await expect(current.locator('.reference-preview-index')).toHaveText([
      '1',
      '2',
    ])
    await expect(current.locator('#imageRequestMode')).toHaveText(
      '当前请求：图片编辑 · 2 张参考图',
    )
    const input = current.locator('#imagePrompt')
    await input.fill('前 后')
    await input.evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(2, 2),
    )
    await current
      .locator('#imageReferencePreview .reference-preview-item')
      .nth(1)
      .click({ button: 'right' })
    await expect(input).toHaveValue('前 @图2后')
    await expect(
      input.locator('..').locator('.image-mention-menu'),
    ).toBeHidden()
    await current.locator('#polishImagePrompt').click()
    await expect(current.locator('#polishGenerationReferenceHint')).toHaveText(
      '2 张参考图',
    )
    const source = current.locator('#polishSourcePrompt')
    await source.fill('内容 ')
    const generation = current.locator(
      '#polishGenerationReferencePreview .polish-reference-item',
    )
    await generation.first().click({ button: 'right' })
    await expect(source).toHaveValue('内容 ')
    await expect(current.locator('.toast').last()).toContainText('请先勾选')
    await current.locator('#polishUseGenerationReferences').check()
    await generation.first().click({ button: 'right' })
    await expect(source).toHaveValue('内容 @生成参考图1')
    const instruction = current.locator('#polishInstruction')
    await instruction.fill('要求 ')
    await generation.nth(1).click({ button: 'right' })
    await expect(instruction).toHaveValue('要求 @生成参考图2')
    await imageEvent(current, '#polishInstruction', 'green', 'paste')
    await expect(
      current.locator('#polishReferencePreview .polish-reference-item'),
    ).toHaveCount(1)
    await current
      .locator('#polishReferencePreview .polish-reference-item')
      .click({ button: 'right' })
    await expect(instruction).toHaveValue('要求 @生成参考图2@润色参考图1')
    await imageEvent(current, '#polishSourcePrompt', 'orange', 'drop')
    await expect(generation).toHaveCount(3)
    await imageEvent(current, '#polishSourcePrompt', 'purple', 'paste')
    await expect(generation).toHaveCount(4)
    await imageEvent(current, '#polishInstruction', 'yellow', 'drop')
    await expect(
      current.locator('#polishReferencePreview .polish-reference-item'),
    ).toHaveCount(2)
  }
})

test('历史与详情的编辑输出只追加图片, 保留当前关键词、参数和参考图', async ({
  page,
  context,
}) => {
  await seedWorkspace(page)
  const vue = await context.newPage()
  await vue.goto('/vue-app/dist/index.html')
  for (const current of [page, vue]) {
    await current
      .locator('#imageReferenceUpload')
      .setInputFiles(await referenceFile(current, 'red'))
    await current.locator('#imagePrompt').fill('保留当前 @图1')
    await current.locator('[data-history-action="edit"]').first().click()
    await expect(current.locator('#imagePrompt')).toHaveValue('保留当前 @图1')
    await expect(current.locator('#imageQuality')).toHaveValue('auto')
    await expect(
      current.locator('#imageReferencePreview .reference-preview-item'),
    ).toHaveCount(2)
    await current
      .locator('#imageReferencePreview .remove-reference')
      .nth(1)
      .click({ force: true })
    await current.locator('.history-image-button').first().click()
    await current.locator('#lightboxEdit').click()
    await expect(current.locator('#imageLightbox')).toBeHidden()
    await expect(current.locator('#imagePrompt')).toHaveValue('保留当前 @图1')
    await expect(current.locator('#imageQuality')).toHaveValue('auto')
    await expect(
      current.locator('#imageReferencePreview .reference-preview-item'),
    ).toHaveCount(2)
  }
})

for (const viewport of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`${viewport.width}px 下主要列表、参考图和设置的布局与旧版一致`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize(viewport)
    await seedWorkspace(page)
    const vue = await context.newPage()
    await vue.setViewportSize(viewport)
    await vue.goto('/vue-app/dist/index.html')
    for (const current of [page, vue]) {
      await current.addStyleTag({
        content:
          '*, *::before, *::after { animation: none !important; transition: none !important; }',
      })
      await current
        .locator('#imageReferenceUpload')
        .setInputFiles(await referenceFile(current, 'red'))
      await expect(current.locator('.history-item')).toHaveCount(4)
    }
    async function compare(selectors: string[]) {
      for (const selector of selectors) {
        const read = (current: Page) =>
          current
            .locator(selector)
            .first()
            .evaluate((element) => {
              const bounds = element.getBoundingClientRect()
              const style = getComputedStyle(element)
              return {
                bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
                font: style.font,
                border: style.border,
                background: style.backgroundColor,
              }
            })
        const before = await read(page)
        const after = await read(vue)
        for (const [index, value] of before.bounds.entries())
          expect(Math.abs(after.bounds[index] - value), selector).toBeLessThan(
            1,
          )
        expect({ ...after, bounds: [] }, selector).toEqual({
          ...before,
          bounds: [],
        })
      }
    }
    await compare([
      '#imageHistoryTitle',
      '.history-filterbar .custom-select-trigger',
      '.history-item',
      '.history-item-batch',
      '#imageRequestMode',
      '.reference-preview-item',
      '.reference-preview-index',
    ])
    for (const [tag, current] of [
      ['old', page],
      ['vue', vue],
    ] as const)
      await current.screenshot({
        path: test.info().outputPath(`history-${tag}.png`),
      })
    for (const current of [page, vue])
      await current.locator('#topbarSettings').click()
    await compare(['#settingsBackdrop .settings-modal', '#saveSettings'])
    for (const [tag, current] of [
      ['old', page],
      ['vue', vue],
    ] as const)
      await current.screenshot({
        path: test.info().outputPath(`settings-${tag}.png`),
      })
  })
}

test('有大图和原始响应的共享缓存中反复收藏, 不整库序列化或清库', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000)
  await seedWorkspace(page, 12)
  const payloadSize = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 768
    const context = canvas.getContext('2d')!
    const pixels = context.createImageData(768, 768)
    let random = 17
    for (let i = 0; i < pixels.data.length; i += 4) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      pixels.data[i] = random & 255
      pixels.data[i + 1] = (random >>> 8) & 255
      pixels.data[i + 2] = (random >>> 16) & 255
      pixels.data[i + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    const src = canvas.toDataURL()
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('generations', 'readwrite')
      const store = tx.objectStore('generations')
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const record = cursor.value
        if (record.type === 'image') {
          record.src = src
          record.width = record.height = 768
        }
        if (record.type === 'generation-task')
          record.responses = [
            {
              requestIndex: 1,
              response: { data: [{ b64_json: src.split(',')[1] }] },
              receivedAt: 1,
            },
          ]
        cursor.update(record)
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
    })
    db.close()
    return src.length
  })
  expect(payloadSize).toBeGreaterThan(1_000_000)
  await page.reload()
  const vue = await context.newPage()
  const errors: string[] = []
  vue.on('pageerror', (error) => errors.push(error.message))
  vue.on('crash', () => errors.push('页面崩溃'))
  await vue.goto('/vue-app/dist/index.html')
  await expect(vue.locator('.history-item')).toHaveCount(12)
  await vue.evaluate(() => {
    const stats = { clears: 0, writes: 0, jsonBytes: 0 }
    Object.assign(window, { favoriteMemory: stats })
    const stringify = JSON.stringify
    JSON.stringify = function (...args: Parameters<typeof JSON.stringify>) {
      const value = stringify(...args)
      stats.jsonBytes += value?.length || 0
      return value
    } as typeof JSON.stringify
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (record) {
      stats.writes++
      return put.call(this, record)
    }
    const clear = IDBObjectStore.prototype.clear
    IDBObjectStore.prototype.clear = function () {
      stats.clears++
      return clear.call(this)
    }
  })
  for (let i = 0; i < 4; i++) {
    await vue.locator('[data-history-action="favorite"]').first().click()
    await vue.locator('#saveFavoriteFolderChoices').click()
    await expect(vue.locator('#favoriteFolderBackdrop')).toBeHidden()
    await vue.locator('[data-history-library="favorites"]').click()
    await vue.locator('.favorite-folder-open').click()
    await expect(vue.locator('.history-item')).toHaveCount(1)
    await vue.locator('[data-history-library="history"]').click()
    await expect(vue.locator('.history-item')).toHaveCount(12)
  }
  const stats = await vue.evaluate(() => (window as any).favoriteMemory)
  expect(stats.clears).toBe(0)
  expect(stats.writes).toBe(4)
  expect(stats.jsonBytes).toBeLessThan(payloadSize)
  expect(errors).toEqual([])
})
