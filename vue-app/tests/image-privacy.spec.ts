import { test, expect, type Page } from '@playwright/test'

async function seed(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('#imageView')).toBeVisible()
  await page.evaluate(async () => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: { demoMode: true },
        activeConversationId: 'privacy-chat',
        conversations: [
          {
            id: 'privacy-chat',
            title: '图片隐私测试',
            createdAt: 1,
            messages: [
              {
                id: 'privacy-message',
                role: 'user',
                content: '查看图片',
                imageIds: ['privacy-image-0'],
                createdAt: 1,
              },
            ],
          },
        ],
      }),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1')
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
        for (let i = 0; i < 2; i++) {
          const config = {
            model: 'test-image',
            requestType: 'generation',
            sizeMode: 'auto',
            ratio: 'auto',
            quality: 'auto',
            format: 'png',
            count: 1,
          }
          const canvas = document.createElement('canvas')
          canvas.width = 320
          canvas.height = 240
          const context = canvas.getContext('2d')!
          context.fillStyle = i ? '#b1575f' : '#39958a'
          context.fillRect(0, 0, 320, 240)
          context.fillStyle = '#ffffff'
          context.fillRect(80, 60, 160, 120)
          store.put({
            id: `privacy-image-${i}`,
            type: 'image',
            src: canvas.toDataURL(),
            createdAt: i + 1,
            width: 320,
            height: 240,
            prompt: `图片 ${i + 1}`,
            config,
          })
          store.put({
            id: `privacy-batch-${i}`,
            batchId: `privacy-batch-${i}`,
            type: 'generation-batch',
            prompt: `图片 ${i + 1}`,
            config,
            imageIds: [`privacy-image-${i}`],
            referenceImageIds: [],
            responseMeta: {},
            imageCount: 1,
            startedAt: i + 1,
            createdAt: i + 1,
            completedAt: i + 1,
            durationMs: 0,
          })
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
    } finally {
      db.close()
    }
  })
  await page.reload()
  await expect(page.locator('.history-item.success')).toHaveCount(2)
}

async function chooseMode(page: Page, label: string) {
  await page.locator('[aria-controls="imagePrivacyMode-custom-menu"]').click()
  await page
    .locator('#imagePrivacyMode-custom-menu')
    .getByRole('option', { name: label, exact: true })
    .click()
}

async function enable(page: Page, mode: string) {
  await page.locator('#topbarSettings').click()
  await page.locator('#settings-tab-display').click()
  if (!(await page.locator('#imagePrivacyEnabled').isChecked()))
    await page
      .locator('.toggle-row')
      .filter({ has: page.locator('#imagePrivacyEnabled') })
      .click()
  await chooseMode(page, mode)
  await page.locator('#saveSettings').click()
  await page.mouse.move(0, 0)
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 隐私遮罩默认关闭, 取消不生效, 保存和刷新保留范围`, async ({
    page,
  }) => {
    await seed(page, url)
    const images = page.locator('.history-image-button img')
    await expect(images.first()).toHaveCSS('filter', 'none')
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-display').click()
    await expect(page.locator('#imagePrivacyEnabled')).not.toBeChecked()
    await page
      .locator('.toggle-row')
      .filter({ has: page.locator('#imagePrivacyEnabled') })
      .click()
    await chooseMode(page, '生图列表')
    await expect(page.locator('#imageHistory')).toHaveCSS('filter', 'none')
    await page.locator('#cancelSettings').click()
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-display').click()
    await expect(page.locator('#imagePrivacyEnabled')).not.toBeChecked()
    await expect(
      page.locator('[aria-controls="imagePrivacyMode-custom-menu"]'),
    ).toContainText('单张图片')
    await page.locator('#cancelSettings').click()
    await enable(page, '生图列表')
    await expect(page.locator('#imageHistory')).toHaveCSS(
      'filter',
      'blur(18px)',
    )
    await page.reload()
    await expect(page.locator('#imageHistory')).toHaveCSS(
      'filter',
      'blur(18px)',
    )
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-display').click()
    await expect(page.locator('#imagePrivacyEnabled')).toBeChecked()
    await expect(
      page.locator('[aria-controls="imagePrivacyMode-custom-menu"]'),
    ).toContainText('生图列表')
    await page
      .locator('.toggle-row')
      .filter({ has: page.locator('#imagePrivacyEnabled') })
      .click()
    await page.locator('#saveSettings').click()
    await expect(page.locator('#imageHistory')).toHaveCSS('filter', 'none')
    await expect(images.first()).toHaveCSS('filter', 'none')
  })

  test(`${version} 单图遮罩仅显示鼠标所在图片, 对话、参考图和预览同步生效`, async ({
    page,
  }) => {
    await seed(page, url)
    await enable(page, '单张图片')
    const images = page.locator('.history-image-button img')
    await expect(images.first()).toHaveCSS('filter', 'blur(18px)')
    await expect(images.nth(1)).toHaveCSS('filter', 'blur(18px)')
    await images.first().hover()
    await expect(images.first()).toHaveCSS('filter', 'none')
    await expect(images.nth(1)).toHaveCSS('filter', 'blur(18px)')
    await page.locator('#imageHistory').screenshot({
      path: test.info().outputPath('single-hover.png'),
    })
    await page.mouse.move(0, 0)
    await expect(images.first()).toHaveCSS('filter', 'blur(18px)')
    await page.locator('[data-history-action="config"]').first().click()
    await page.locator('#imageReferenceUpload').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    const reference = page.locator('#imageReferencePreview img')
    await expect(reference).toHaveCSS('filter', 'blur(18px)')
    await reference.hover()
    await expect(reference).toHaveCSS('filter', 'none')
    await page.locator('[data-view="chat"]').click()
    const chatImage = page.locator('.message-image')
    await expect(chatImage).toHaveCSS('filter', 'blur(18px)')
    await chatImage.hover()
    await expect(chatImage).toHaveCSS('filter', 'none')
    await page.mouse.move(0, 0)
    await expect(chatImage).toHaveCSS('filter', 'blur(18px)')
    await chatImage.click()
    const preview = page.locator('#lightboxImage')
    await expect(preview).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(preview).toHaveCSS('filter', 'blur(18px)')
    await preview.hover()
    await expect(preview).toHaveCSS('filter', 'none')
    await page.mouse.move(0, 0)
    await expect(preview).toHaveCSS('filter', 'blur(18px)')
  })

  test(`${version} 列表遮罩移入整体显示, 移出立即恢复, 对话不受影响`, async ({
    page,
  }) => {
    await seed(page, url)
    await enable(page, '生图列表')
    const list = page.locator('#imageHistory')
    await expect(list).toHaveCSS('filter', 'blur(18px)')
    await list.screenshot({ path: test.info().outputPath('list-covered.png') })
    await list.hover({ position: { x: 5, y: 5 } })
    await expect(list).toHaveCSS('filter', 'none')
    await list.screenshot({ path: test.info().outputPath('list-revealed.png') })
    await page.locator('#imagePrompt').hover()
    await expect(list).toHaveCSS('filter', 'blur(18px)')
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-image')).toHaveCSS('filter', 'none')
    await page.locator('.message-image').click()
    await expect(page.locator('#lightboxImage')).toBeVisible()
    await expect(page.locator('#lightboxImage')).toHaveCSS('filter', 'none')
    await page.keyboard.press('Escape')
    await page.locator('[data-view="image"]').click()
    await expect(list).toHaveCSS('filter', 'blur(18px)')
  })

  test(`${version} 手机触摸环境两种遮罩均不生效`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    try {
      const page = await context.newPage()
      await seed(page, 'http://127.0.0.1:4178' + url)
      for (const mode of ['单张图片', '生图列表']) {
        await enable(page, mode)
        await expect(page.locator('#imageHistory')).toHaveCSS('filter', 'none')
        await expect(
          page.locator('.history-image-button img').first(),
        ).toHaveCSS('filter', 'none')
        await page.locator('[data-view="chat"]').click()
        await expect(page.locator('.message-image')).toHaveCSS('filter', 'none')
        await page.locator('[data-view="image"]').click()
      }
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-display').click()
      await page.locator('#saveSettings').screenshot({
        path: test.info().outputPath('mobile-save-button.png'),
      })
    } finally {
      await context.close()
    }
  })
}
