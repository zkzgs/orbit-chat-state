import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// 两帧 GIF, 验证缓存与下载没有把动画转成静态图片
const gif = Buffer.from(
  '47494638396101000100800000ff00000000ff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
  'hex',
)
const svg = Buffer.from(
  '\uFEFF<?xml version="1.0" encoding="UTF-8"?>\n<!-- generated vector -->\n<!DOCTYPE svg>\n<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24"><rect width="32" height="24" fill="red"/><text x="1" y="16">图</text></svg>',
)
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII=',
  'base64',
)

async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<Record<string, any>[]>((resolve, reject) => {
        const request = db
          .transaction('generations')
          .objectStore('generations')
          .getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
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
  for (const format of ['gif', 'svg']) {
    for (const mode of [
      'base64',
      'url',
      'reference-edit',
      'reference-edit-url',
      'fallback-edit',
      'reference-generation',
      'fallback-generation',
    ]) {
      test(
        version +
          ' ' +
          format.toUpperCase() +
          ' ' +
          mode +
          ' 保留原文件并支持预览、下载与导入导出',
        async ({ page }) => {
          const bytes = format === 'gif' ? gif : svg
          const mime = format === 'gif' ? 'image/gif' : 'image/svg+xml'
          const hasReferences = !['base64', 'url'].includes(mode)
          const requestType = [
            'reference-edit',
            'reference-edit-url',
            'fallback-edit',
          ].includes(mode)
            ? 'edit'
            : 'generation'
          const reasoningEffort = requestType === 'edit' ? 'medium' : 'auto'
          const errors: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          await page.addInitScript((fallback) => {
            if (!localStorage.getItem('orbit-chat-state-v1'))
              localStorage.setItem(
                'orbit-chat-state-v1',
                JSON.stringify({
                  settings: {
                    demoMode: false,
                    imageBaseUrl: 'https://formats.test/v1',
                    imageApiKey: 'test-key',
                    imageModel: 'gpt-image-2.6',
                    imageCountMode: 'parallel',
                  },
                }),
              )
            if (fallback)
              Object.defineProperty(window, 'Worker', { value: undefined })
          }, mode.startsWith('fallback'))
          const uploads: { url: string; contentType: string; body: Buffer }[] =
            []
          await page.route('https://formats.test/**', async (route) => {
            const request = route.request()
            if (request.method() === 'OPTIONS')
              return route.fulfill({
                status: 204,
                headers: {
                  'access-control-allow-origin': '*',
                  'access-control-allow-headers': '*',
                },
              })
            if (request.url().endsWith('/models'))
              return route.fulfill({
                json: { data: [{ id: 'gpt-image-2.6' }] },
              })
            if (request.url().includes('/result'))
              return route.fulfill({
                body: bytes,
                contentType: mime + '; charset=utf-8',
                headers: { 'access-control-allow-origin': '*' },
              })
            uploads.push({
              url: request.url(),
              contentType: request.headers()['content-type'],
              body: request.postDataBuffer()!,
            })
            return route.fulfill({
              json: {
                model: 'gpt-image-2.6',
                data: [
                  mode.endsWith('url')
                    ? { url: 'https://formats.test/result' }
                    : { b64_json: bytes.toString('base64') },
                ],
              },
            })
          })
          await page.goto(url)
          await expect(page.locator('#imageView')).toBeVisible()
          await expect(page.locator('#imageExperimentalFormat')).toHaveCount(0)
          await page
            .locator('[aria-controls="imageFormat-custom-menu"]')
            .click()
          await page
            .locator('#imageFormat-custom-menu')
            .getByRole('option', { name: format.toUpperCase(), exact: true })
            .click()
          if (hasReferences) {
            await page.locator('#imageReferenceUpload').setInputFiles({
              name: 'reference.png',
              mimeType: 'image/png',
              buffer: png,
            })
            await expect(
              page.locator('#imageReferencePreview .reference-preview-item'),
            ).toHaveCount(1)
            await expect(
              page.locator('#imageRequestType input:checked'),
            ).toHaveValue('edit')
            if (requestType === 'generation') {
              await page
                .getByRole('radiogroup', { name: '请求接口' })
                .getByRole('radio', { name: '生图', exact: true })
                .check()
            }
          }
          if (reasoningEffort !== 'auto') {
            await page
              .locator('[aria-controls="imageReasoningEffort-custom-menu"]')
              .click()
            await page
              .locator('#imageReasoningEffort-custom-menu')
              .getByRole('option', { name: '中', exact: true })
              .click()
          }
          await page.locator('#imagePrompt').fill('生成 ' + format)
          await page.locator('#generateImage').click()
          await expect(page.locator('.history-item.success')).toHaveCount(1)
          expect(uploads).toHaveLength(1)
          const upload = uploads[0]
          expect(
            upload.url.endsWith(
              requestType === 'edit' ? '/images/edits' : '/images/generations',
            ),
          ).toBe(true)
          if (requestType === 'edit' && hasReferences) {
            expect(upload.contentType).toContain('multipart/form-data')
            expect(upload.body.toString()).toContain(
              'name="model"\r\n\r\ngpt-image-2.6',
            )
            expect(upload.body.toString()).toContain(
              'name="image"; filename="reference.png"',
            )
            expect(upload.body.toString()).toContain(
              'name="output_format"\r\n\r\n' + format,
            )
            expect(upload.body.toString()).toContain(
              'name="reasoning_effort"\r\n\r\nmedium',
            )
            expect(upload.body.toString()).toContain(
              'name="response_format"\r\n\r\nurl',
            )
            expect(upload.body.includes(png)).toBe(true)
            expect(upload.body.toString()).not.toContain(
              'name="output_compression"',
            )
          } else {
            expect(upload.contentType).toContain('application/json')
            const body = JSON.parse(upload.body.toString())
            expect(body.model).toBe('gpt-image-2.6')
            expect(body.prompt).toBe('生成 ' + format)
            expect(body.n).toBe(1)
            expect(body.output_format).toBe(format)
            expect(body.response_format).toBe('url')
            expect(body).not.toHaveProperty('reasoning_effort')
            expect(body).not.toHaveProperty('output_compression')
            expect(body).not.toHaveProperty('requestType')
            if (hasReferences)
              expect(body.image).toEqual([
                'data:image/png;base64,' + png.toString('base64'),
              ])
            else expect(body).not.toHaveProperty('image')
          }
          for (const field of [
            'reference_images',
            'frame_count',
            'frame_duration_ms',
            'input_fidelity',
            'experimentalFormat',
            'mask',
          ]) {
            expect(upload.body.toString()).not.toContain('"' + field + '"')
          }
          await page.locator('.history-image-button').first().click()
          await expect(page.locator('#imageLightbox')).toBeVisible()
          await expect(
            page
              .locator('#imageMetadata .metadata-card')
              .filter({
                has: page.locator('dt', { hasText: /^请求类型$/ }),
              })
              .locator('dd'),
          ).toHaveText(requestType === 'edit' ? '改图' : '生图')
          await expect
            .poll(() =>
              page
                .locator('#lightboxImage')
                .evaluate((image: HTMLImageElement) => image.naturalWidth),
            )
            .toBe(format === 'gif' ? 1 : 32)
          await expect(page.locator('#imageMetadata')).toContainText(
            format.toUpperCase() + ' 不支持',
          )
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('#lightboxDownload').click(),
          ])
          expect(download.suggestedFilename().endsWith('.' + format)).toBe(true)
          expect(await readFile((await download.path())!)).toEqual(bytes)
          await page.locator('#closeLightbox').click()
          await expect
            .poll(
              async () =>
                (await records(page)).filter(
                  (record) => record.type === 'generation-batch',
                ).length,
            )
            .toBe(1)
          const generated = (await records(page)).find(
            (record) =>
              record.type === 'image' && record.src.startsWith('data:' + mime),
          )!
          expect(generated).toBeTruthy()
          expect(generated.config.requestType).toBe(requestType)
          expect(generated.config.reasoningEffort).toBe(reasoningEffort)
          expect(generated.responseMeta.requestType).toBe(requestType)
          const task = (await records(page)).find(
            (record) => record.type === 'generation-task',
          )!
          expect(task.config.requestType).toBe(requestType)
          expect(task.requestLog.endpoint).toBe(upload.url)
          expect(upload.contentType).toContain(task.requestLog.contentType)
          expect(task.requestLog.body.response_format).toBe('url')
          if (reasoningEffort !== 'auto')
            expect(task.requestLog.body.reasoning_effort).toBe(reasoningEffort)
          expect(Buffer.from(generated.src.split(',')[1], 'base64')).toEqual(
            bytes,
          )
          await page.reload()
          await expect(page.locator('.history-item.success')).toHaveCount(1)
          await expect(
            page.locator('[aria-controls="imageFormat-custom-menu"]'),
          ).toContainText(format.toUpperCase())
          await page.locator('#topbarSettings').click()
          await page.locator('#settings-tab-data').click()
          await page.locator('#exportWorkspace').click()
          const [exportDownload] = await Promise.all([
            page.waitForEvent('download'),
            page.locator('[data-data-scope="workspace"]').click(),
          ])
          const exported = await readFile((await exportDownload.path())!)
          expect(exported.toString()).toContain(generated.src)
          if (!hasReferences)
            expect(
              JSON.parse(exported.toString()).imageDraft.config.requestType,
            ).toBe(requestType)
          page.on('dialog', (dialog) =>
            dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined),
          )
          await page.locator('#settings-tab-data').click()
          await page.locator('#workspaceImportFile').setInputFiles({
            name: 'workspace.json',
            mimeType: 'application/json',
            buffer: exported,
          })
          await expect(page.locator('#toast')).toContainText('覆盖导入')
          await page.locator('#cancelSettings').click()
          await expect(page.locator('.history-item.success')).toHaveCount(1)
          const restored = (await records(page)).find(
            (record) => record.id === generated.id,
          )!
          expect(restored.src).toBe(generated.src)
          await page
            .getByRole('radiogroup', { name: '请求接口' })
            .getByRole('radio', {
              name: requestType === 'edit' ? '生图' : '改图',
              exact: true,
            })
            .check()
          await page.locator('[data-history-action="config"]').first().click()
          await expect(
            page.locator('#imageRequestType input:checked'),
          ).toHaveValue(requestType)
          await expect(
            page.locator('[aria-controls="imageReasoningEffort-custom-menu"]'),
          ).toContainText(reasoningEffort === 'auto' ? '自动' : '中')
          expect(errors).toEqual([])
        },
      )
    }
  }

  for (const fallback of [false, true]) {
    test(
      version +
        (fallback ? ' 主线程降级' : ' Worker') +
        ' 生图 JSON 按顺序上传压缩副本, 缓存保留原图',
      async ({ page }) => {
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        await page.addInitScript((fallback) => {
          localStorage.setItem(
            'orbit-chat-state-v1',
            JSON.stringify({
              settings: {
                demoMode: false,
                imageBaseUrl: 'https://formats.test/v1',
                imageApiKey: 'test-key',
                imageModel: 'custom-image-model',
                compressRequestImages: true,
                requestImageCompressionLimitMb: 0.1,
              },
            }),
          )
          if (fallback)
            Object.defineProperty(window, 'Worker', { value: undefined })
        }, fallback)
        const uploads: { contentType: string; body: Record<string, any> }[] = []
        await page.route('https://formats.test/**', (route) => {
          const request = route.request()
          if (request.method() === 'OPTIONS')
            return route.fulfill({
              status: 204,
              headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
              },
            })
          if (request.url().endsWith('/models'))
            return route.fulfill({ json: { data: [] } })
          expect(request.url()).toBe(
            'https://formats.test/v1/images/generations',
          )
          uploads.push({
            contentType: request.headers()['content-type'],
            body: request.postDataJSON(),
          })
          return route.fulfill({
            json: { data: [{ b64_json: gif.toString('base64') }] },
          })
        })
        await page.goto(url)
        await expect(page.locator('#imageView')).toBeVisible()
        const original = await page.evaluate(() => {
          const canvas = document.createElement('canvas')
          canvas.width = 640
          canvas.height = 480
          const context = canvas.getContext('2d')!
          const image = context.createImageData(canvas.width, canvas.height)
          let seed = 1
          for (let i = 0; i < image.data.length; i += 4) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
            image.data[i] = seed & 255
            image.data[i + 1] = (seed >>> 8) & 255
            image.data[i + 2] = (seed >>> 16) & 255
            image.data[i + 3] = 255
          }
          context.putImageData(image, 0, 0)
          return canvas.toDataURL('image/png')
        })
        await page.locator('#imageReferenceUpload').setInputFiles([
          {
            name: 'large.png',
            mimeType: 'image/png',
            buffer: Buffer.from(original.split(',')[1], 'base64'),
          },
          { name: 'small.png', mimeType: 'image/png', buffer: png },
        ])
        await expect(
          page.locator('#imageReferencePreview .reference-preview-item'),
        ).toHaveCount(2)
        await page
          .getByRole('radiogroup', { name: '请求接口' })
          .getByRole('radio', { name: '生图', exact: true })
          .check()
        await page.locator('#imagePrompt').fill('主体 @图1, 背景 @图2')
        await page.locator('#generateImage').click()
        await expect(page.locator('.history-item.success')).toHaveCount(1)
        expect(uploads).toHaveLength(1)
        const { contentType, body } = uploads[0]
        expect(contentType).toContain('application/json')
        expect(body.model).toBe('custom-image-model')
        expect(body.prompt).toBe('主体 [image 1], 背景 [image 2]')
        expect(body.image).toHaveLength(2)
        expect(body.image[0]).toMatch(/^data:image\/webp;base64,/)
        expect(
          Buffer.from(body.image[0].split(',')[1], 'base64').length,
        ).toBeLessThanOrEqual(0.1 * 1048576)
        expect(body.image[1]).toBe(
          'data:image/png;base64,' + png.toString('base64'),
        )
        const dimensions = await page.evaluate(async (source) => {
          const blob = await (await fetch(source)).blob()
          const bitmap = await createImageBitmap(blob)
          const dimensions = { width: bitmap.width, height: bitmap.height }
          bitmap.close()
          return dimensions
        }, body.image[0])
        expect(dimensions).toEqual({ width: 640, height: 480 })
        const stored = await records(page)
        const task = stored.find((record) => record.type === 'generation-task')!
        expect(task.requestLog.contentType).toBe('application/json')
        expect(task.requestLog.body.model).toBe('custom-image-model')
        expect(task.requestLog.body.image[0]).toMatchObject({
          compressed: true,
          submittedType: 'image/webp',
          originalWidth: 640,
          originalHeight: 480,
          submittedWidth: 640,
          submittedHeight: 480,
        })
        expect(
          stored.find((record) => record.id === task.referenceImageIds[0]).src,
        ).toBe(original)
        expect(errors).toEqual([])
      },
    )
  }
}
