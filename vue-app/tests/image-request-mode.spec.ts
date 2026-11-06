import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

async function openWorkspace(page: Page, url: string) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          imageBaseUrl: 'https://mode.test/v1',
          imageApiKey: 'test-key',
          imageModel: 'gpt-image-2.6',
          demoMode: false,
        },
      }),
    )
  })
  await page.goto(url)
  await expect(page.locator('#imageView')).toBeVisible()
}

async function chooseMode(page: Page, label: string) {
  await page
    .getByRole('radiogroup', { name: '请求接口' })
    .getByRole('radio', { name: label, exact: true })
    .check()
}

async function referenceFile(page: Page, color: string) {
  const data = await page.evaluate((color) => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 16
    const context = canvas.getContext('2d')!
    context.fillStyle = color
    context.fillRect(0, 0, 16, 16)
    return canvas.toDataURL('image/png').split(',')[1]
  }, color)
  return {
    name: color + '.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  }
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  for (const width of [1440, 390]) {
    test(
      version +
        ' ' +
        width +
        'px 默认随有无参考图切换, 图片增删、替换及排序保留手动选择',
      async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 })
        await page.route('https://mode.test/**', (route) =>
          route.fulfill({ json: { data: [] } }),
        )
        await openWorkspace(page, url)
        const select = page.locator('#imageRequestType input:checked')
        const modeGroup = page.getByRole('radiogroup', { name: '请求接口' })
        await expect(modeGroup.getByRole('radio')).toHaveCount(2)
        expect(
          await modeGroup.evaluate((element) =>
            Boolean(element.closest('.reference-row')),
          ),
        ).toBe(true)
        await expect(
          page.locator('.image-controls #imageRequestType'),
        ).toHaveCount(0)
        await modeGroup
          .getByRole('radio', { name: '生图', exact: true })
          .focus()
        await page.keyboard.press('ArrowRight')
        await expect(
          modeGroup.getByRole('radio', { name: '改图', exact: true }),
        ).toBeChecked()
        await page.keyboard.press('ArrowLeft')
        const references = page.locator(
          '#imageReferencePreview .reference-preview-item',
        )
        await expect(select).toHaveValue('generation')
        await page
          .locator('#imageReferenceUpload')
          .setInputFiles(await referenceFile(page, 'red'))
        await expect(references).toHaveCount(1)
        await expect(select).toHaveValue('edit')
        await chooseMode(page, '生图')
        await page
          .locator('#imageReferenceUpload')
          .setInputFiles(await referenceFile(page, 'blue'))
        await expect(references).toHaveCount(2)
        await expect(select).toHaveValue('generation')
        const chooserPromise = page.waitForEvent('filechooser')
        await references
          .first()
          .locator('.replace-reference')
          .click({ force: true })
        const replacement = await referenceFile(page, 'green')
        await (await chooserPromise).setFiles(replacement)
        await expect(references.first().locator('img')).toHaveAttribute(
          'src',
          'data:image/png;base64,' + replacement.buffer.toString('base64'),
        )
        await expect(select).toHaveValue('generation')
        if (width > 780) {
          await page.locator('#imagePrompt').fill('主体 @图1, 背景 @图2')
          await references.first().dragTo(references.last())
          await expect(page.locator('#imagePrompt')).toHaveValue(
            '主体 @图2, 背景 @图1',
          )
          await expect(select).toHaveValue('generation')
        }
        await references
          .first()
          .locator('.remove-reference')
          .click({ force: true })
        await expect(references).toHaveCount(1)
        await expect(select).toHaveValue('generation')
        await chooseMode(page, '改图')
        await references
          .first()
          .locator('.remove-reference')
          .click({ force: true })
        await expect(references).toHaveCount(0)
        await expect(select).toHaveValue('generation')
        await page
          .locator('#imageReferenceUpload')
          .setInputFiles(await referenceFile(page, 'red'))
        await expect(select).toHaveValue('edit')
        page.once('dialog', (dialog) => dialog.accept())
        await page.locator('#clearImageReferences').click()
        await expect(select).toHaveValue('generation')
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true)
        const controls = await modeGroup.boundingBox()
        const uploads = await page
          .locator('.reference-upload-actions')
          .first()
          .boundingBox()
        expect(controls!.x).toBeGreaterThanOrEqual(uploads!.x + uploads!.width)
        await page
          .locator('.image-generator-panel')
          .screenshot({ path: test.info().outputPath('request-switch.png') })
      },
    )
  }

  test(
    version + ' 手动生图的失败任务保留接口, 恢复、重试及导入导出沿用原选择',
    async ({ page }) => {
      const requests: string[] = []
      await page.route('https://mode.test/**', (route) => {
        if (route.request().method() === 'OPTIONS')
          return route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-headers': '*',
            },
          })
        if (route.request().url().endsWith('/models'))
          return route.fulfill({ json: { data: [] } })
        expect(route.request().headers()['content-type']).toContain(
          'application/json',
        )
        expect(route.request().postDataJSON()).toMatchObject({
          model: 'gpt-image-2.6',
          reasoning_effort: 'medium',
          prompt: '基于参考图生成',
          image: [expect.stringMatching(/^data:image\/png;base64,/)],
        })
        requests.push(route.request().url())
        return route.fulfill({
          status: 400,
          json: { error: { message: '测试上游拒绝请求' } },
        })
      })
      await openWorkspace(page, url)
      await page
        .locator('#imageReferenceUpload')
        .setInputFiles(await referenceFile(page, 'red'))
      await page
        .locator('[aria-controls="imageReasoningEffort-custom-menu"]')
        .click()
      await page
        .locator('#imageReasoningEffort-custom-menu')
        .getByRole('option', { name: '中', exact: true })
        .click()
      await chooseMode(page, '生图')
      await page.locator('#imagePrompt').fill('基于参考图生成')
      await page.locator('#generateImage').click()
      await expect(page.locator('.generation-task-card.error')).toHaveCount(1)
      await page.locator('#closeToast').click()
      await page.locator('.generation-task-card.error').first().click()
      await expect(
        page
          .locator('#imageMetadata .metadata-card')
          .filter({
            has: page.locator('dt', { hasText: /^请求类型$/ }),
          })
          .locator('dd'),
      ).toHaveText('生图')
      await page.locator('#closeLightbox').click()
      await page
        .locator('[aria-controls="imageReasoningEffort-custom-menu"]')
        .click()
      await page
        .locator('#imageReasoningEffort-custom-menu')
        .getByRole('option', { name: '高', exact: true })
        .click()
      await chooseMode(page, '改图')
      await page
        .locator('[data-generation-action="reuse-task"]')
        .first()
        .click()
      await expect(page.locator('#imageRequestType input:checked')).toHaveValue(
        'generation',
      )
      await expect(
        page.locator('[aria-controls="imageReasoningEffort-custom-menu"]'),
      ).toContainText('中')
      await page
        .locator('[aria-controls="imageReasoningEffort-custom-menu"]')
        .click()
      await page
        .locator('#imageReasoningEffort-custom-menu')
        .getByRole('option', { name: '高', exact: true })
        .click()
      await chooseMode(page, '改图')
      await page
        .locator('[data-generation-action="retry-task"]')
        .first()
        .click()
      await expect(page.locator('.generation-task-card.error')).toHaveCount(2)
      expect(requests).toEqual(
        Array(2).fill('https://mode.test/v1/images/generations'),
      )
      await chooseMode(page, '生图')
      await page.locator('#topbarSettings').click()
      await page.locator('#exportWorkspace').click()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('[data-data-scope="workspace"]').click(),
      ])
      const buffer = await readFile((await download.path())!)
      const payload = JSON.parse(buffer.toString())
      expect(payload.imageDraft.config.requestType).toBe('generation')
      expect(payload.imageDraft.referenceImageIds).toHaveLength(1)
      for (const task of payload.imageTasks) {
        expect(task.config.requestType).toBe('generation')
        expect(task.config.reasoningEffort).toBe('medium')
        expect(task.requestLog.body.reasoning_effort).toBe('medium')
        expect(task.requestLog.endpoint).toBe(
          'https://mode.test/v1/images/generations',
        )
        expect(task.requestLog.contentType).toBe('application/json')
      }
      await page.locator('#cancelSettings').click()
      await chooseMode(page, '改图')
      await page.locator('#topbarSettings').click()
      page.on('dialog', (dialog) =>
        dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined),
      )
      await page.locator('#workspaceImportFile').setInputFiles({
        name: 'workspace.json',
        mimeType: 'application/json',
        buffer,
      })
      await expect(page.locator('#toast')).toContainText('覆盖导入')
      await page.locator('#cancelSettings').click()
      await expect(page.locator('#imageRequestType input:checked')).toHaveValue(
        'generation',
      )
      await expect(
        page.locator('#imageReferencePreview .reference-preview-item'),
      ).toHaveCount(1)
    },
  )
}
