import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { transpileModule, ModuleKind, ScriptTarget } from 'typescript'

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII='

async function seed(page: Page, url: string, count = 3, large = false) {
  await page.goto(url)
  await expect(page.locator('#imageView')).toBeVisible()
  await page.evaluate(
    async ({ count, large, png }) => {
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            imagePromptTemplates: [
              {
                id: 'template',
                name: '模板',
                prompt: '中文',
                referenceImageIds: [`export-image-${count - 1}`],
                createdAt: 1,
                updatedAt: 1,
              },
            ],
          },
          conversations: [
            {
              id: 'export-chat',
              title: '导出测试',
              createdAt: 1,
              messages: [
                {
                  id: 'message',
                  role: 'user',
                  content: '中文🙂\n"反斜杠\\',
                  imageIds: ['export-image-0'],
                  createdAt: 1,
                },
              ],
            },
          ],
          activeConversationId: 'export-chat',
        }),
      )
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('orbit-chat-images-v1', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('generations', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('generations', 'readwrite')
          const store = tx.objectStore('generations')
          store.clear()
          for (let i = 0; i < count; i++) {
            const src =
              png + (large ? 'A'.repeat(2 * 1024 * 1024) : '') + 'A'.repeat(i)
            const config = {
              model: 'test-image',
              format: 'png',
              count: 1,
              quality: 'auto',
              requestType: 'edit',
            }
            const response = {
              status: 200,
              data: [{ b64_json: src.slice(src.indexOf(',') + 1) }],
              note: large
                ? 'a'.repeat(256 * 1024 - 1) + '🙂中文\n"\\\u0000'
                : '中文🙂\n"\\',
              optional: undefined,
              values: [null, undefined, false, 0, NaN],
            }
            store.put({
              id: `export-image-${i}`,
              type: 'image',
              src,
              name: `原图${i}`,
              createdAt: i + 1,
              config,
              width: 1,
              height: 1,
            })
            store.put({
              id: `export-batch-${i}`,
              batchId: `export-batch-${i}`,
              taskId: `export-task-${i}`,
              type: 'generation-batch',
              imageIds: [`export-image-${i}`],
              referenceImageIds: ['export-image-0'],
              imageCount: 1,
              prompt: `图片${i}`,
              config,
              responseMeta: { requestType: 'edit' },
              createdAt: i + 1,
              startedAt: i + 1,
              completedAt: i + 2,
              durationMs: 1,
            })
            store.put({
              id: `export-task-${i}`,
              batchId: `export-batch-${i}`,
              type: 'generation-task',
              status: 'success',
              prompt: `图片${i}`,
              config,
              referenceImageIds: ['export-image-0'],
              startedAt: i + 1,
              finishedAt: i + 2,
              requestPhases: [],
              responses: [{ requestIndex: 1, response, receivedAt: 1 }],
            })
          }
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    },
    { count, large, png },
  )
  await page.reload()
  await expect(page.locator('.history-item.success')).toHaveCount(count)
}

async function exportScope(page: Page, scope: string) {
  await page.locator('#settings-tab-data').click()
  await page.locator('#exportWorkspace').click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(`[data-data-scope="${scope}"]`).click(),
  ])
  const contents = await readFile((await download.path())!, 'utf8')
  return { download, contents, payload: JSON.parse(contents) }
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 分块导出保持五种范围、共享图片及原始响应, 可重新导入`, async ({
    page,
  }) => {
    await seed(page, url)
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined),
    )
    await page.locator('#topbarSettings').click()
    let workspaceFile = ''
    for (const scope of ['chat', 'image', 'workspace', 'config', 'all']) {
      const { download, contents, payload } = await exportScope(page, scope)
      expect(payload.scope).toBe(scope)
      expect(download.suggestedFilename()).toMatch(/\.json$/)
      const ids = payload.images.map((image: any) => image.id).sort()
      expect(ids).toEqual(
        scope === 'config'
          ? ['export-image-2']
          : scope === 'chat'
            ? ['export-image-0']
            : ['export-image-0', 'export-image-1', 'export-image-2'],
      )
      expect(new Set(ids).size).toBe(ids.length)
      for (const image of payload.images)
        expect(image.src).toBe(
          png + 'A'.repeat(Number(image.id.split('-').at(-1))),
        )
      if (['chat', 'workspace', 'all'].includes(scope))
        expect(payload.conversations[0].messages[0].content).toBe(
          '中文🙂\n"反斜杠\\',
        )
      if (['image', 'workspace', 'all'].includes(scope)) {
        expect(payload.imageHistory).toHaveLength(3)
        expect(payload.imageTasks).toHaveLength(3)
        for (const task of payload.imageTasks) {
          expect(task.responses[0].response.note).toBe('中文🙂\n"\\')
          expect(task.responses[0].response).not.toHaveProperty('optional')
          expect(task.responses[0].response.values).toEqual([
            null,
            null,
            false,
            0,
            null,
          ])
          expect(task.referenceImageIds).toEqual(['export-image-0'])
        }
      }
      expect(Boolean(payload.apiConfig)).toBe(['config', 'all'].includes(scope))
      if (scope === 'workspace') workspaceFile = contents
    }
    await page.locator('#settings-tab-data').click()
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'workspace.json',
      mimeType: 'application/json',
      buffer: Buffer.from(workspaceFile),
    })
    await expect(page.locator('#toast')).toContainText('覆盖导入')
    await page.locator('#cancelSettings').click()
    await expect(page.locator('.history-item.success')).toHaveCount(3)
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message.user')).toContainText('中文🙂')
    await expect(page.locator('.message-image')).toHaveCount(1)
  })

  test(`${version} 大备份不构造整体 JSON 字符串, 导出期间响应事件且禁止重复导出`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('crash', () => errors.push('页面崩溃'))
    await seed(page, url, 12, true)
    await page.locator('#topbarSettings').click()
    await page.evaluate(() => {
      const stats = { maxString: 0, ticks: 0 }
      Object.assign(window, { exportStats: stats })
      const stringify = JSON.stringify
      JSON.stringify = function (...args: Parameters<typeof JSON.stringify>) {
        const result = stringify(...args)
        stats.maxString = Math.max(stats.maxString, result?.length || 0)
        if (result?.length > 2 * 1024 * 1024)
          throw new Error('禁止一次序列化大记录或整个备份')
        return result
      } as typeof JSON.stringify
      window.setInterval(() => stats.ticks++, 4)
    })
    let downloads = 0
    page.on('download', () => downloads++)
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const downloaded = page.waitForEvent('download')
    await page
      .locator('[data-data-scope="workspace"]')
      .evaluate((button: HTMLButtonElement) => button.click())
    await expect(page.locator('#exportWorkspace')).toBeDisabled()
    await expect(page.locator('#exportWorkspace')).toHaveText('导出中')
    await page
      .locator('#exportWorkspace')
      .evaluate((button: HTMLButtonElement) => button.click())
    const download = await downloaded
    const contents = await readFile((await download.path())!, 'utf8')
    expect(contents.length).toBeGreaterThan(48 * 1024 * 1024)
    const payload = JSON.parse(contents)
    expect(payload.images).toHaveLength(12)
    expect(payload.imageHistory).toHaveLength(12)
    expect(payload.imageTasks).toHaveLength(12)
    for (const image of payload.images) {
      const i = Number(image.id.split('-').at(-1))
      expect(image.src).toBe(png + 'A'.repeat(2 * 1024 * 1024 + i))
      const task = payload.imageTasks.find(
        (task: any) => task.id === `export-task-${i}`,
      )
      expect(task.responses[0].response.data[0].b64_json).toBe(
        image.src.split(',')[1],
      )
      expect(task.responses[0].response.note).toBe(
        'a'.repeat(256 * 1024 - 1) + '🙂中文\n"\\\u0000',
      )
    }
    const stats = await page.evaluate(() => (window as any).exportStats)
    expect(stats.maxString).toBeLessThan(2 * 1024 * 1024)
    expect(stats.ticks).toBeGreaterThan(5)
    expect(downloads).toBe(1)
    await expect(page.locator('#exportWorkspace')).toBeEnabled()
    await expect(page.locator('#exportWorkspace')).toHaveText('导出')
    expect(errors).toEqual([])
  })

  test(`${version} 分块文件超过单个字符串上限仍完整生成, 导出快照不受后续修改影响`, async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto(url)
    const source = await readFile('src/utils/json-export.ts', 'utf8')
    const module = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2022,
      },
    }).outputText
    const result = await page.evaluate(
      async ({ version, module }) => {
        let create: (value: unknown) => Promise<Blob>
        if (version === 'HTML') create = (window as any).createJsonBlob
        else {
          const url = URL.createObjectURL(
            new Blob([module], { type: 'text/javascript' }),
          )
          try {
            create = (await import(url)).createJsonBlob
          } finally {
            URL.revokeObjectURL(url)
          }
        }
        const src = 'A'.repeat(1024 * 1024)
        const value = { images: Array(540).fill({ src }) }
        const pending = create(value)
        value.images.length = 0
        const blob = await pending
        return {
          size: blob.size,
          head: await blob.slice(0, 20).text(),
          tail: await blob.slice(-20).text(),
          type: blob.type,
        }
      },
      { version, module },
    )
    const expectedSize =
      '{"images":['.length +
      540 * (1024 * 1024 + '{"src":""}'.length) +
      539 +
      ']}'.length
    expect(result.size).toBe(expectedSize)
    expect(result.head).toBe('{"images":[{"src":"A')
    expect(result.tail).toBe('A'.repeat(16) + '"}]}')
    expect(result.type).toBe('application/json')
  })

  test(`${version} 导出失败可重试, 取消敏感范围确认不会生成文件`, async ({
    page,
  }) => {
    await seed(page, url)
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    page.once('dialog', (dialog) => dialog.dismiss())
    await page.locator('[data-data-scope="all"]').click()
    await expect(page.locator('#exportWorkspace')).toBeEnabled()
    await page.evaluate(() => {
      const create = URL.createObjectURL
      let fail = true
      URL.createObjectURL = (blob: Blob | MediaSource) => {
        if (fail && blob instanceof Blob && blob.type === 'application/json') {
          fail = false
          throw new Error('模拟下载失败')
        }
        return create.call(URL, blob)
      }
    })
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    await page.locator('[data-data-scope="workspace"]').click()
    await expect(page.locator('#toast')).toContainText('导出失败: 模拟下载失败')
    await expect(page.locator('#exportWorkspace')).toBeEnabled()
    await page.locator('#closeToast').click()
    const { payload } = await exportScope(page, 'workspace')
    expect(payload.images).toHaveLength(3)
    await expect(page.locator('#toast')).toContainText('全部工作区已导出')
  })
}
