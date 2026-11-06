import { test, expect } from '@playwright/test'

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' GIF/SVG 改图保留多图顺序和四档思考, 拒绝 SVG 源文件',
    async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.addInitScript(() => {
        localStorage.setItem(
          'orbit-chat-state-v1',
          JSON.stringify({
            settings: {
              demoMode: false,
              imageBaseUrl: 'https://edits.test/v1',
              imageApiKey: 'test-key',
              imageModel: 'gpt-image-2.6',
              reasoningEffort: 'high',
            },
          }),
        )
      })
      const uploads: FormData[] = []
      await page.route('https://edits.test/**', async (route) => {
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
        expect(request.url()).toBe('https://edits.test/v1/images/edits')
        expect(request.headers()['content-type']).toContain(
          'multipart/form-data',
        )
        uploads.push(
          await new Response(new Uint8Array(request.postDataBuffer()!), {
            headers: { 'Content-Type': request.headers()['content-type'] },
          }).formData(),
        )
        return route.fulfill({
          status: 400,
          json: { error: { message: '测试上游拒绝请求' } },
        })
      })
      await page.goto(url)
      await expect(page.locator('#imageView')).toBeVisible()
      await expect(
        page.locator('[aria-controls="imageReasoningEffort-custom-menu"]'),
      ).toContainText('自动')
      const sources = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 16
        canvas.height = 16
        const context = canvas.getContext('2d')!
        context.fillStyle = 'red'
        context.fillRect(0, 0, 16, 16)
        const png = canvas.toDataURL('image/png')
        context.fillStyle = 'blue'
        context.fillRect(0, 0, 16, 16)
        return [png, canvas.toDataURL('image/webp')]
      })
      const files = sources.map((source, index) => ({
        name: index ? 'second.webp' : 'first.png',
        mimeType: index ? 'image/webp' : 'image/png',
        buffer: Buffer.from(source.split(',')[1], 'base64'),
      }))
      await page.locator('#imageReferenceUpload').setInputFiles(files)
      await expect(
        page.locator('#imageReferencePreview .reference-preview-item'),
      ).toHaveCount(2)
      await expect(
        page.getByRole('radio', { name: '改图', exact: true }),
      ).toBeChecked()
      for (const [index, effort] of [
        'auto',
        'low',
        'medium',
        'high',
      ].entries()) {
        const format = index % 2 ? 'svg' : 'gif'
        await page.locator('[aria-controls="imageFormat-custom-menu"]').click()
        await page
          .locator('#imageFormat-custom-menu')
          .getByRole('option', { name: format.toUpperCase(), exact: true })
          .click()
        await page
          .locator('[aria-controls="imageReasoningEffort-custom-menu"]')
          .click()
        await expect(
          page.locator('#imageReasoningEffort-custom-menu').getByRole('option'),
        ).toHaveCount(4)
        await page
          .locator('#imageReasoningEffort-custom-menu')
          .getByRole('option', {
            name: ['自动', '低', '中', '高'][index],
            exact: true,
          })
          .click()
        const prompt =
          '保持两张参考图的颜色, ' +
          (format === 'gif' ? '9帧, 每帧130毫秒, 无缝循环' : '重新绘制 SVG')
        await page.locator('#imagePrompt').fill(prompt)
        await page.locator('#generateImage').click()
        await expect(page.locator('.generation-task-card.error')).toHaveCount(
          index + 1,
        )
        await page.locator('#closeToast').click()
        await page.locator('.generation-task-card.error').first().click()
        await expect(
          page
            .locator('#imageMetadata .metadata-card')
            .filter({
              has: page.locator('dt', { hasText: /^请求类型$/ }),
            })
            .locator('dd'),
        ).toHaveText('改图')
        await page.locator('#closeLightbox').click()
        expect(uploads).toHaveLength(index + 1)
        const form = uploads[index]
        expect(form.get('model')).toBe('gpt-image-2.6')
        expect(form.get('prompt')).toBe(prompt)
        expect(form.get('output_format')).toBe(format)
        expect(form.get('response_format')).toBe('url')
        expect(form.get('reasoning_effort')).toBe(
          effort === 'auto' ? null : effort,
        )
        const images = form.getAll('image[]') as File[]
        expect(images.map((image) => image.name)).toEqual(
          files.map((file) => file.name),
        )
        for (const [i, image] of images.entries()) {
          expect(image.type).toBe(files[i].mimeType)
          expect(Buffer.from(await image.arrayBuffer())).toEqual(
            files[i].buffer,
          )
        }
        for (const field of [
          'mask',
          'reference_images',
          'frame_count',
          'frame_duration_ms',
          'input_fidelity',
        ])
          expect(form.has(field)).toBe(false)
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true)
      await page
        .locator('.image-generator-panel')
        .screenshot({ path: test.info().outputPath('image-edits-mobile.png') })
      page.once('dialog', (dialog) => dialog.accept())
      await page.locator('#clearImageReferences').click()
      await page.locator('#imageReferenceUpload').setInputFiles({
        name: 'source.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>',
        ),
      })
      await expect(
        page.locator('#imageReferencePreview .reference-preview-item'),
      ).toHaveCount(1)
      await page.locator('#generateImage').click()
      await expect(page.locator('#toast')).toContainText(
        'GIF/SVG 改图仅支持 PNG、JPEG 或 WebP 参考图',
      )
      await expect(page.locator('.generation-task-card.error')).toHaveCount(5)
      expect(uploads).toHaveLength(4)
      expect(errors).toEqual([])
    },
  )
}
