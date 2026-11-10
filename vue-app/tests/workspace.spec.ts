import { test, expect, type Dialog, type Page } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readFile } from 'node:fs/promises'

async function openWorkspace(
  page: Page,
  settings = {},
  url = '/vue-app/dist/index.html',
) {
  await page.addInitScript((settings) => {
    if (!localStorage.getItem('orbit-chat-state-v1')) {
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings,
          contextMode: 'client',
          conversations: [
            {
              id: 'conversation-test',
              title: '新对话',
              createdAt: 1,
              messages: [],
            },
          ],
          activeConversationId: 'conversation-test',
        }),
      )
    }
  }, settings)
  await page.goto(url)
  await expect(page.locator('#imageView')).toBeVisible()
}

async function chooseCustomSelect(page: Page, id: string, label: string) {
  await page.locator(`#${id}-custom-trigger`).click()
  await page
    .locator(`#${id}-custom-menu`)
    .getByRole('option', { name: label, exact: true })
    .click()
}

test('单 HTML 可通过 file:// 打开, 不请求外部前端资源', async ({ page }) => {
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await openWorkspace(
    page,
    {},
    pathToFileURL(path.resolve('dist/index.html')).href,
  )
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('单 HTML 验证')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toContainText('单 HTML 验证')
  expect(errors).toEqual([])
  expect(requests).toEqual([])
})

test('聊天支持演示回复、修改、切换会话和刷新恢复', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('第一条消息')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toContainText('第一条消息')
  await page
    .locator('.message.user .message-action', { hasText: '修改' })
    .click()
  await expect(page.locator('#messageInput')).toHaveValue('第一条消息')
  await page.locator('#messageInput').fill('修改后的消息')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toContainText('修改后的消息')
  await expect(page.locator('.message')).toHaveCount(2)
  await page.locator('#newChatButton').click()
  await expect(page.locator('.message')).toHaveCount(0)
  await page.locator('.conversation-item', { hasText: '第一条消息' }).click()
  await expect(page.locator('.message')).toHaveCount(2)
  await page.reload()
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message.assistant')).toContainText('修改后的消息')
})

test('模型候选列表统一使用应用样式, 支持过滤和键盘选择', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: { chatModel: 'gpt-6.1-sol' },
        connectionProfiles: {
          chat: [
            {
              id: 'chat-profile',
              name: '测试接口',
              baseUrl: 'https://orbit.test/v1',
              apiKey: '',
              model: 'gpt-6.1-sol',
              models: [
                'codex-auto-review',
                'gpt-5.6-sol',
                'gpt-6.1-sol',
                'gpt-6-sol',
              ],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
          image: [],
        },
        activeConnectionProfiles: { chat: 'chat-profile', image: '' },
        conversations: [
          { id: 'model-test', title: '新对话', createdAt: 1, messages: [] },
        ],
        activeConversationId: 'model-test',
      }),
    )
  })
  await page.goto('/vue-app/dist/index.html')
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('#chatModelQuick')).toHaveValue('gpt-6.1-sol')
  const quickInput = page.locator('#chatModelQuick')
  await quickInput.click()
  const quickMenu = page.locator('#chatModelQuick-options')
  await expect(quickMenu).toHaveCSS('background-color', 'rgb(22, 34, 53)')
  await expect(quickMenu.getByRole('option')).toHaveText([
    'codex-auto-review',
    'gpt-5.6-sol',
    'gpt-6-sol',
    'gpt-6.1-sol',
  ])
  await quickInput.fill('6.1')
  await expect(quickMenu.getByRole('option')).toHaveText(['gpt-6.1-sol'])
  await quickInput.press('ArrowDown')
  await quickInput.press('Enter')
  await expect(quickInput).toHaveValue('gpt-6.1-sol')

  await page.locator('#topbarSettings').click()
  const settingsInput = page.locator('#chatModel')
  await settingsInput.click()
  await expect(
    page.locator('#chatModel-options').getByRole('option'),
  ).toHaveText(['codex-auto-review', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-6.1-sol'])
})

test('根目录单文件模型菜单、聊天请求状态和手机弹窗正常', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('https://chat.test/v1/**', async (route) => {
    if (route.request().url().endsWith('/models'))
      return route.fulfill({
        json: {
          data: [
            { id: 'gpt-6.1-sol' },
            { id: 'codex-auto-review' },
            { id: 'gpt-6-sol' },
            { id: 'gpt-5.6-sol' },
          ],
        },
      })
    await new Promise((resolve) => setTimeout(resolve, 350))
    return route.fulfill({
      json: { choices: [{ message: { content: '请求状态已恢复' } }] },
    })
  })
  await openWorkspace(
    page,
    {
      chatBaseUrl: 'https://chat.test/v1',
      chatApiKey: 'test-key',
      chatModel: 'gpt-6-sol',
    },
    '/index.html',
  )
  await page.locator('[data-view="chat"]').click()
  await page.locator('#chatModelQuick').focus()
  const modelOption = page.locator(
    '[data-model-dropdown="chat"][data-model-input="chatModelQuick"] .model-option',
  )
  await expect(modelOption).toHaveText([
    'codex-auto-review',
    'gpt-5.6-sol',
    'gpt-6-sol',
    'gpt-6.1-sol',
  ])

  await page.locator('#messageInput').fill('检查请求状态')
  await page.locator('#sendButton').click()
  await expect(page.locator('#connectionText')).toHaveText('请求中')
  await expect(page.locator('.message.assistant')).toContainText(
    '请求状态已恢复',
  )
  await expect(page.locator('#connectionText')).toHaveText('已连接')

  await page.locator('#topbarSettings').click()
  await page.setViewportSize({ width: 390, height: 680 })
  const saveButton = page.locator('#saveSettings')
  const saveBox = await saveButton.boundingBox()
  const viewportHeight = await page.evaluate(() => visualViewport.height)
  expect(saveBox).not.toBeNull()
  expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(viewportHeight + 1)
  expect(errors).toEqual([])
})

test('流式输出可以暂停并保留部分内容', async ({ page }) => {
  await openWorkspace(page, { chatStream: true })
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('请输出一段完整的演示内容')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant .message-text')).not.toBeEmpty()
  await expect(page.locator('#sendButton')).toHaveAttribute('data-mode', 'stop')
  await page.locator('#sendButton').click()
  await expect(page.locator('#sendButton')).toHaveAttribute('data-mode', 'send')
  await expect(page.locator('.message.assistant .message-text')).not.toBeEmpty()
})

test('真实请求协议保留模型、上下文、思考参数和流式解析', async ({ page }) => {
  let request: Record<string, unknown> = {}
  await page.route('https://orbit.test/v1/**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        },
      })
    if (route.request().url().endsWith('/models'))
      return route.fulfill({ json: { data: [{ id: 'test-model' }] } })
    request = route.request().postDataJSON()
    return route.fulfill({
      headers: {
        'content-type': 'text/event-stream',
        'access-control-allow-origin': '*',
      },
      body: 'data: {"choices":[{"delta":{"reasoning_content":"思考内容"}}]}\n\ndata: {"choices":[{"delta":{"content":"流式"}}]}\n\ndata: {"choices":[{"delta":{"content":"回复"}}]}\n\ndata: [DONE]\n\n',
    })
  })
  await openWorkspace(page, {
    chatBaseUrl: 'https://orbit.test/v1',
    chatApiKey: 'test-key',
    chatModel: 'test-model',
    chatStream: true,
    reasoningEffort: 'high',
    systemPrompt: '测试系统提示词',
  })
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('接口请求验证')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant .message-text')).toHaveText(
    '流式回复',
  )
  await expect(page.locator('.message-reasoning-content')).toHaveText(
    '思考内容',
  )
  expect(request).toMatchObject({
    model: 'test-model',
    stream: true,
    reasoning_effort: 'high',
    messages: [
      { role: 'system', content: '测试系统提示词' },
      { role: 'user', content: '接口请求验证' },
    ],
  })
})

test('演示生图、图片详情、收藏、搜索和 IndexedDB 恢复', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('清晨的山间湖泊')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.locator('.history-image-button').click()
  await expect(page.locator('#imageLightbox')).toBeVisible()
  await expect(page.locator('#lightboxPrompt')).toContainText('清晨的山间湖泊')
  await page.locator('#closeLightbox').click()
  await page.locator('[data-history-action="favorite"]').click()
  await page.locator('#saveFavoriteFolderChoices').click()
  await expect(page.locator('[data-history-action="favorite"]')).toHaveClass(
    /is-favorite/,
  )
  await page.locator('[data-history-library="favorites"]').click()
  await page.locator('.favorite-folder-open').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.locator('#historySearch').fill('没有匹配的关键词')
  await expect(page.locator('.history-item:visible')).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.history-item')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('尺寸设置和提示词模板保留参数及内容', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#imageSizeButton').click()
  await expect(page.locator('#imageSizeBackdrop')).toBeVisible()
  await page.locator('[data-size-mode="custom"]').click()
  await page.locator('#imageWidth').fill('1536')
  await page.locator('#imageHeight').fill('1024')
  await page.locator('#saveImageSize').click()
  await expect(page.locator('#imageSizeButton')).toContainText('1536')
  await page.locator('#imagePrompt').fill('用于模板的关键词')
  page.once('dialog', (dialog) => dialog.accept('测试关键词模板'))
  await page.locator('#saveImagePromptTemplate').click()
  await expect(
    page.locator('#imagePromptTemplateSelect option:checked'),
  ).toHaveText('测试关键词模板')
  await page.reload()
  await expect(page.locator('#imagePrompt')).toHaveValue('用于模板的关键词')
})

test('同一来源可以读取原页面保存的数据', async ({ page }) => {
  await page.goto('/index.html')
  await page.evaluate(() =>
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: { chatModel: 'legacy-model' },
        contextMode: 'single',
        activeConversationId: 'legacy-conversation',
        conversations: [
          {
            id: 'legacy-conversation',
            title: '旧页面对话',
            createdAt: 1,
            messages: [
              {
                id: 'legacy-message',
                role: 'user',
                content: '原有消息',
                createdAt: 1,
                imageIds: [],
              },
            ],
          },
        ],
      }),
    ),
  )
  await page.goto('/vue-app/dist/index.html')
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message-text')).toHaveText('原有消息')
  await expect(page.locator('#chatModelQuick')).toHaveValue('legacy-model')
  await expect(page.locator('[data-context="single"]')).toHaveClass(/active/)
})

test('移动端两个工作区及设置不出现横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openWorkspace(page)
  await expect(page.locator('#generateImage')).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.locator('[data-view="chat"]').click()
  await page.locator('#openSidebar').click()
  await expect(page.locator('#sidebar')).toHaveClass(/open/)
  await page.locator('#openSettings').click()
  await expect(page.locator('#settingsBackdrop')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          getComputedStyle(document.querySelector('#settingsBackdrop')!)
            .height ===
          `${Math.min(innerHeight, visualViewport?.height || innerHeight)}px`,
      ),
    )
    .toBe(true)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('图片 Worker 保留原始像素, 压缩提交副本并解析生图响应', async ({
  page,
}) => {
  let upload = Buffer.alloc(0)
  const workers: import('@playwright/test').Worker[] = []
  const errors: string[] = []
  page.on('worker', (worker) => workers.push(worker))
  page.on('pageerror', (error) => errors.push(error.message))
  let png = ''
  await page.route('https://orbit.test/v1/**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        },
      })
    if (route.request().url().endsWith('/models'))
      return route.fulfill({ json: { data: [{ id: 'test-image' }] } })
    upload = route.request().postDataBuffer()!
    return route.fulfill({
      json: {
        data: [{ b64_json: png, output_format: 'png', size: '640x480' }],
        model: 'test-image',
      },
    })
  })
  await openWorkspace(
    page,
    {
      imageBaseUrl: 'https://orbit.test/v1',
      imageApiKey: 'test-key',
      imageModel: 'test-image',
      requestImageCompressionLimitMb: 0.1,
    },
    pathToFileURL(path.resolve('dist/index.html')).href,
  )
  png = await page.evaluate(() => {
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
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('#imageReferenceUpload').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  })
  await expect(page.locator('.reference-preview-item')).toHaveCount(1)
  await page.locator('#imagePrompt').fill('按参考图生成')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item.success')).toHaveCount(1)
  expect(workers.length).toBeGreaterThan(0)
  expect(upload.toString('latin1')).toContain('Content-Type: image/webp')
  expect(upload.byteLength).toBeLessThan(Buffer.from(png, 'base64').byteLength)
  const stored = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const data = await new Promise<Record<string, any>[]>((resolve) => {
      const request = database
        .transaction('generations')
        .objectStore('generations')
        .getAll()
      request.onsuccess = () => resolve(request.result)
    })
    database.close()
    return data
  })
  const task = stored.find((record) => record.type === 'generation-task')!
  expect(JSON.stringify(task)).toContain('"originalWidth":640')
  expect(JSON.stringify(task)).toContain('"submittedWidth":640')
  expect(
    stored.some(
      (record) =>
        record.type === 'image' &&
        record.src === `data:image/png;base64,${png}`,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})

test('失败的生图任务可以查看详情、恢复配置和重试', async ({ page }) => {
  let calls = 0
  await page.route('https://orbit.test/v1/**', (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
        },
      })
    if (route.request().url().endsWith('/models'))
      return route.fulfill({ json: { data: [{ id: 'test-image' }] } })
    calls += 1
    return route.fulfill({
      status: 400,
      json: { error: { message: '测试接口拒绝请求' } },
    })
  })
  await openWorkspace(page, {
    imageBaseUrl: 'https://orbit.test/v1',
    imageApiKey: 'test-key',
  })
  await page.locator('#imagePrompt').fill('失败后保留的关键词')
  await page.locator('#generateImage').click()
  const failedTask = page.locator('.generation-task-card.error')
  await expect(failedTask).toContainText('测试接口拒绝请求')
  await expect(failedTask.locator('.generation-task-symbol')).toHaveText('!')
  await expect(failedTask.locator('.generation-record-spinner')).toHaveCount(0)
  await expect(failedTask.locator('.history-item-time')).toContainText(
    ' · 失败',
  )
  await expect(failedTask.locator('.history-item-time')).not.toContainText(
    '数量 0',
  )
  await page.locator('#closeToast').click()
  await page.locator('.generation-task-card.error').click()
  await expect(page.locator('#lightboxErrorMessage')).toContainText(
    '测试接口拒绝请求',
  )
  await page.locator('#closeLightbox').click()
  await page.locator('#imagePrompt').fill('新的临时关键词')
  await page.locator('[data-generation-action="reuse-task"]').click()
  await expect(page.locator('#imagePrompt')).toHaveValue('失败后保留的关键词')
  await page.locator('[data-generation-action="retry-task"]').click()
  await expect(page.locator('.generation-task-card.running')).toHaveCount(0)
  await expect(page.locator('.generation-task-card.error')).toHaveCount(1)
  expect(calls).toBe(2)
})

test('参考图上传期间任务状态、加载环和计时与原版一致', async ({ page }) => {
  const png = await pngFile(page, 'result.png', 'purple')
  let markRequestStarted!: () => void
  let releaseRequest!: () => void
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve
  })
  const pendingResponse = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route('https://orbit.test/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        },
      })
    markRequestStarted()
    await pendingResponse
    return route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { data: [{ b64_json: png.buffer.toString('base64') }] },
    })
  })
  await openWorkspace(page, {
    imageBaseUrl: 'https://orbit.test/v1',
    imageApiKey: 'test-key',
  })
  await page
    .locator('#imageReferenceUpload')
    .setInputFiles(await pngFile(page, 'reference.png', 'orange'))
  await page.locator('#imagePrompt').fill('按参考图生成图片')
  await page.locator('#generateImage').click()
  await requestStarted

  const runningTask = page.locator('.generation-task-card.running')
  await expect(runningTask.locator('.generation-task-visual')).toContainText(
    '上传资源中',
  )
  await expect(runningTask.locator('.generation-record-spinner')).toHaveCount(1)
  await expect(runningTask.locator('.history-item-time')).toHaveText(
    /^已用时 \d+s · 进行中$/,
  )
  await expect(runningTask.locator('.history-item-time')).not.toContainText(
    '数量 0',
  )
  releaseRequest()
  await expect(page.locator('.history-item.generation-record')).toHaveCount(1)
})

test('无参考图生图等待上游时显示原版阶段和计时', async ({ page }) => {
  const png = await pngFile(page, 'result.png', 'purple')
  let markRequestStarted!: () => void
  let releaseRequest!: () => void
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve
  })
  const pendingResponse = new Promise<void>((resolve) => {
    releaseRequest = resolve
  })
  await page.route('https://orbit.test/v1/**', async (route) => {
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'POST, OPTIONS',
        },
      })
    markRequestStarted()
    await pendingResponse
    return route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      json: { data: [{ b64_json: png.buffer.toString('base64') }] },
    })
  })
  await openWorkspace(page, {
    imageBaseUrl: 'https://orbit.test/v1',
    imageApiKey: 'test-key',
  })
  await page.locator('#imagePrompt').fill('等待接口生成结果')
  await page.locator('#generateImage').click()
  await requestStarted

  const runningTask = page.locator('.generation-task-card.running')
  await expect(runningTask.locator('.generation-task-visual')).toContainText(
    '等待上游中',
  )
  await expect(runningTask.locator('.generation-record-spinner')).toHaveCount(1)
  await expect(runningTask.locator('.history-item-time')).toHaveText(
    /^已用时 \d+s · 进行中$/,
  )

  releaseRequest()
  await expect(page.locator('.history-item.generation-record')).toHaveCount(1)
})

test('历史分组、单图选择和删除不会破坏剩余图片', async ({ page }) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('一组两张图片')
  await page.locator('#imageCount').fill('2')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item.group-card')).toHaveCount(1)
  await page.locator('[data-history-view="single"]').click()
  await expect(page.locator('.history-item.single-card')).toHaveCount(2)
  await page.locator('.history-item.single-card').first().hover()
  await page.locator('.history-select').first().check()
  await expect(page.locator('#historySelectionBar')).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#historyDeleteSelected').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.reload()
  await expect(page.locator('.history-item')).toHaveCount(1)
})

test('工作区导出和导入保留对话及图片历史', async ({ page }) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('导入导出的对话')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toContainText(
    '导入导出的对话',
  )
  await page.locator('[data-view="image"]').click()
  await page.locator('#imagePrompt').fill('导入导出的图片')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.locator('#topbarSettings').click()
  await page.locator('#settings-tab-data').click()
  await page.locator('#exportWorkspace').click()
  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-data-scope="workspace"]').click()
  const download = await downloadPromise
  const file = test.info().outputPath('workspace.json')
  await download.saveAs(file)
  const exported = JSON.parse(await readFile(file, 'utf8'))
  expect(exported.imageHistory).toHaveLength(1)
  expect(exported.conversations[0].messages).toHaveLength(2)
  page.on('dialog', (dialog) =>
    dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined),
  )
  await page.locator('#settings-tab-data').click()
  await page.locator('#workspaceImportFile').setInputFiles(file)
  await expect(page.locator('#toast')).toContainText('覆盖导入')
  await page.locator('#cancelSettings').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message.user')).toContainText('导入导出的对话')
})

test('聊天附件和 Markdown 图片支持预览与切换', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII=',
    'base64',
  )
  await page.route('https://orbit.test/*.png', (route) =>
    route.fulfill({
      body: png,
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
    }),
  )
  await openWorkspace(page)
  await page.locator('[data-view="chat"]').click()
  await page
    .locator('#imageUpload')
    .setInputFiles({ name: 'chat.png', mimeType: 'image/png', buffer: png })
  await page
    .locator('#messageInput')
    .fill(
      '![图片一](https://orbit.test/one.png)\n![图片二](https://orbit.test/two.png)',
    )
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toBeVisible()
  await expect(page.locator('.message.user .message-time')).toContainText(
    String(new Date().getFullYear()),
  )
  await page.locator('.message.user .message-image-button').click()
  await expect(page.locator('#chatImageViewer')).toBeVisible()
  await expect(page.locator('#viewerImage')).toHaveAttribute(
    'src',
    /^data:image\/png/,
  )
  await page.locator('#closeImageViewer').click()
  await page.locator('.message.user .markdown-inline-image').first().click()
  await expect(page.locator('#viewerImage')).toHaveAttribute(
    'src',
    'https://orbit.test/one.png',
  )
  await page.locator('#viewerNext').click()
  await expect(page.locator('#viewerImage')).toHaveAttribute(
    'src',
    'https://orbit.test/two.png',
  )
  await page.locator('#closeImageViewer').click()
  await expect(page.locator('#chatImageViewer')).toBeHidden()
})

async function pngFile(page: Page, name: string, color: string) {
  const encoded = await page.evaluate((color) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    const context = canvas.getContext('2d')!
    context.fillStyle = color
    context.fillRect(0, 0, 16, 16)
    return canvas.toDataURL().split(',')[1]
  }, color)
  return { name, mimeType: 'image/png', buffer: Buffer.from(encoded, 'base64') }
}

test('参考图排序、删除和清空同步更新提示词引用', async ({ page }) => {
  await openWorkspace(page)
  await page
    .locator('#imageReferenceUpload')
    .setInputFiles([
      await pngFile(page, 'red.png', 'red'),
      await pngFile(page, 'blue.png', 'blue'),
    ])
  const references = page.locator(
    '#imageReferencePreview .reference-preview-item',
  )
  await expect(references).toHaveCount(2)
  await page.locator('#imagePrompt').fill('主体 @图1, 背景 @图2')
  await references.first().dragTo(references.last())
  await expect(page.locator('#imagePrompt')).toHaveValue('主体 @图2, 背景 @图1')
  await references.first().hover()
  await references.first().locator('.remove-reference').click()
  await expect(page.locator('#imagePrompt')).toHaveValue('主体 @图1, 背景 @图?')
  await page.locator('#imagePrompt').fill('@')
  await page.locator('#imagePrompt').press('ArrowDown')
  await page.locator('#imagePrompt').press('Enter')
  await expect(page.locator('#imagePrompt')).toHaveValue('@图1')
  await expect(page.locator('#imagePromptMirror')).toHaveCount(1)
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('#clearImageReferences').click()
  await expect(references).toHaveCount(0)
  await expect(page.locator('#imagePrompt')).toHaveValue('@图?')
  await page.locator('#generateImage').click()
  await expect(page.locator('#toast')).toContainText('失效的参考图')
  await expect(page.locator('.generation-task-card')).toHaveCount(0)
})

test('润色使用两组参考图、保存模板并带回生成参考图', async ({ page }) => {
  let request:
    | { messages: { content: string | { type: string; text?: string }[] }[] }
    | undefined
  await page.route('https://orbit.test/v1/**', (route) => {
    if (route.request().url().endsWith('/models'))
      return route.fulfill({ json: { data: [] } })
    request = route.request().postDataJSON()
    return route.fulfill({
      json: { choices: [{ message: { content: '润色后的完整提示词' } }] },
    })
  })
  await openWorkspace(page, {
    chatBaseUrl: 'https://orbit.test/v1',
    chatApiKey: 'test-key',
  })
  await page
    .locator('#imageReferenceUpload')
    .setInputFiles(await pngFile(page, 'subject.png', 'red'))
  await page.locator('#imagePrompt').fill('主体 @图1')
  await page.locator('#polishImagePrompt').click()
  await expect(page.locator('#polishSourcePromptMirror')).toContainText(
    '主体 @图1',
  )
  await page
    .locator('#polishReferenceUpload')
    .setInputFiles(await pngFile(page, 'style.png', 'blue'))
  await page.locator('#polishInstruction').fill('分析 @润色参考图1 的风格')
  await expect(page.locator('#polishInstructionMirror')).toContainText(
    '分析 @润色参考图1 的风格',
  )
  await page.locator('#generatePolishResult').click()
  await expect(page.locator('#toast')).toContainText('勾选')
  await page.locator('#closeToast').click()
  await page.locator('#polishUseGenerationReferences').check()
  await page.locator('#generatePolishResult').click()
  await expect(page.locator('#polishResult')).toHaveValue('润色后的完整提示词')
  const parts = request!.messages[1].content as {
    type: string
    text?: string
  }[]
  expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(2)
  expect(parts[0].text).toContain('生成参考图 1')
  expect(parts[0].text).toContain('润色参考图 1')
  page.once('dialog', (dialog) => dialog.accept('测试润色模板'))
  await page.locator('#savePolishTemplate').click()
  await expect(page.locator('#polishTemplateSelect option:checked')).toHaveText(
    '测试润色模板',
  )
  await page
    .locator('#polishGenerationReferenceUpload')
    .setInputFiles(await pngFile(page, 'extra.png', 'green'))
  await page.locator('#polishUseGenerationReferences').uncheck()
  await page.locator('#applyPolishResult').click()
  await expect(page.locator('#imagePrompt')).toHaveValue('润色后的完整提示词')
  await expect(
    page.locator('#imageReferencePreview .reference-preview-item'),
  ).toHaveCount(2)
  await page.reload()
  await page.locator('#polishImagePrompt').click()
  await expect(page.locator('#polishTemplateSelect option:checked')).toHaveText(
    '测试润色模板',
  )
  await expect(
    page.locator('#polishReferencePreview .polish-reference-item'),
  ).toHaveCount(1)
})

test('三张图片的键盘导航每次只切换一张, Escape 只关闭顶层预览', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('键盘切换测试')
  await page.locator('#imageCount').fill('3')
  await page.locator('#generateImage').click()
  await page.locator('.history-image-button').click()
  const sources = await page
    .locator('#lightboxThumbnails img')
    .evaluateAll((images) =>
      images.map((image) => (image as HTMLImageElement).src),
    )
  await page.locator('#lightboxImage').click()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#viewerImage')).toHaveAttribute('src', sources[1])
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('#viewerImage')).toHaveAttribute('src', sources[0])
  await page.keyboard.press('Escape')
  await expect(page.locator('#chatImageViewer')).toBeHidden()
  await expect(page.locator('#imageLightbox')).toBeVisible()
  await expect(page.locator('#imageMetadata')).toContainText('文件大小')
  await page.locator('#lightboxCopyChat').click()
  await expect(page.locator('#chatView')).toBeVisible()
  await expect(page.locator('#attachmentPreview img')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('全屏图片预览点击图片周围空白处关闭', async ({ page }) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('预览空白关闭测试')
  await page.locator('#generateImage').click()
  await page.locator('.history-image-button').click()
  await page.locator('#lightboxImage').click()
  await expect(page.locator('#chatImageViewer')).toBeVisible()
  await page.locator('#viewerImageWrap').click({ position: { x: 20, y: 20 } })
  await expect(page.locator('#chatImageViewer')).toBeHidden()
  await expect(page.locator('#imageLightbox')).toBeVisible()
})

test('图片缩放回到100%后归中, 随后仍可继续缩放和拖动', async ({ page }) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('预览缩放复位测试')
  await page.locator('#generateImage').click()
  await page.locator('.history-image-button').click()
  await page.locator('#lightboxImage').click()
  const image = page.locator('#viewerImage')
  await expect(image).toBeVisible()
  const box = await image.boundingBox()
  expect(box).not.toBeNull()
  const center = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 }

  await page.mouse.move(center.x, center.y)
  for (let index = 0; index < 12; index++) await page.mouse.wheel(0, -120)
  await expect(page.locator('#viewerMeta')).not.toContainText('缩放 100%')
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 120, center.y + 40, { steps: 5 })
  await page.mouse.up()
  const moved = await image.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f }
  })
  expect(Math.abs(moved.x) + Math.abs(moved.y)).toBeGreaterThan(10)

  for (let index = 0; index < 16; index++) await page.mouse.wheel(0, 120)
  await expect(page.locator('#viewerMeta')).toContainText('缩放 100%')
  await expect
    .poll(() =>
      image.evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform)
        return [matrix.a, matrix.d, matrix.e, matrix.f]
      }),
    )
    .toEqual([1, 1, 0, 0])

  await page.mouse.move(center.x, center.y)
  await page.mouse.wheel(0, -120)
  await expect(page.locator('#viewerMeta')).not.toContainText('缩放 100%')
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 80, center.y, { steps: 4 })
  await page.mouse.up()
  const movedAgain = await image.evaluate((element) => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform)
    return { x: matrix.e, y: matrix.f }
  })
  expect(Math.abs(movedAgain.x) + Math.abs(movedAgain.y)).toBeGreaterThan(10)
})

test('设置支持取消草稿、保存和切换接口模板', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#topbarSettings').click()
  const original = await page.locator('#chatModel').inputValue()
  await page.locator('#chatModel').fill('cancel-model')
  await page.locator('#cancelSettings').click()
  await page.locator('#topbarSettings').click()
  await expect(page.locator('#chatModel')).toHaveValue(original)
  await page.locator('#chatBaseUrl').fill('https://orbit.test/v1')
  await page.locator('#chatModel').fill('profile-a')
  page.once('dialog', (dialog) => dialog.accept('接口 A'))
  await page.locator('#saveChatProfile').click()
  await expect(page.locator('#chatProfileSelect option:checked')).toHaveText(
    '接口 A',
  )
  await page.locator('#chatModel').fill('profile-b')
  page.once('dialog', (dialog) => dialog.accept('接口 B'))
  await page.locator('#saveChatProfile').click()
  await chooseCustomSelect(page, 'chatProfileSelect', '接口 A')
  await expect(page.locator('#chatModel')).toHaveValue('profile-a')
  await page.locator('#saveSettings').click()
  await page.reload()
  await page.locator('#topbarSettings').click()
  await expect(page.locator('#chatModel')).toHaveValue('profile-a')
  await expect(page.locator('#chatProfileSelect option')).toHaveCount(3)
})

test('覆盖导入空对话保留生图历史和模板引用, 页面仍可发消息', async ({
  page,
}) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('覆盖导入要保留的图片')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.locator('#topbarSettings').click()
  const dialog = (dialog: import('@playwright/test').Dialog) =>
    dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined)
  page.on('dialog', dialog)
  await page.locator('#settings-tab-data').click()
  await page.locator('#workspaceImportFile').setInputFiles({
    name: 'empty-chat.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 11,
        scope: 'chat',
        conversations: [],
        images: [],
      }),
    ),
  })
  await expect(page.locator('#toast')).toContainText('覆盖导入')
  page.off('dialog', dialog)
  await page.locator('#cancelSettings').click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('空对话导入后仍可发送')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toContainText(
    '空对话导入后仍可发送',
  )
  await page.reload()
  await expect(page.locator('.history-item')).toHaveCount(1)
})

test('清除生图工作区后运行中的任务不会重新写回', async ({ page }) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('清除前还在生成')
  await page.locator('#generateImage').click()
  const runningTask = page.locator('.generation-task-card.running')
  await expect(runningTask).toHaveCount(1)
  await expect(runningTask.locator('.generation-record-spinner')).toHaveCount(1)
  await expect(runningTask.locator('.generation-task-symbol')).toHaveCount(0)
  await expect(runningTask.locator('.history-item-time')).toHaveText(
    /^已用时 \d+s · 进行中$/,
  )
  await page.locator('#topbarSettings').click()
  await page.locator('#settings-tab-data').click()
  await page.locator('#resetLocalData').click()
  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('[data-data-scope="image"]').click()
  await expect(page.locator('#toast')).toContainText('已清除')
  // 等待演示请求的原定完成时间, 验证已取消的任务不会写回历史
  await page.waitForTimeout(1200)
  await expect(
    page.locator('.history-item, .generation-task-card'),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.locator('.history-item, .generation-task-card'),
  ).toHaveCount(0)
})

test('配置合并处理同名模板和图片 ID 冲突, 保留对话原图', async ({ page }) => {
  await openWorkspace(page)
  const red = `data:image/png;base64,${(await pngFile(page, 'red.png', 'red')).buffer.toString('base64')}`
  const blue = `data:image/png;base64,${(await pngFile(page, 'blue.png', 'blue')).buffer.toString('base64')}`
  await page.locator('#topbarSettings').click()
  page.on('dialog', (dialog) =>
    dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
  )
  const template = (id: string, name: string) => ({
    id,
    name,
    prompt: '模板参考图 @图1',
    referenceImageIds: ['shared-image'],
    createdAt: 1,
    updatedAt: 1,
  })
  await page.locator('#settings-tab-data').click()
  await page.locator('#workspaceImportFile').setInputFiles({
    name: 'all.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 12,
        scope: 'all',
        images: [{ id: 'shared-image', type: 'image', src: red, createdAt: 1 }],
        conversations: [
          {
            id: 'original-chat',
            title: '原图对话',
            createdAt: 1,
            messages: [
              {
                id: 'message',
                role: 'user',
                content: '原有图片',
                imageIds: ['shared-image'],
                createdAt: 1,
              },
            ],
          },
        ],
        activeConversationId: 'original-chat',
        apiConfig: {
          settings: {
            imagePromptTemplates: [template('template-a', 'Template')],
            imagePolishTemplates: [],
          },
        },
      }),
    ),
  })
  await expect(page.locator('#toast')).toContainText('合并导入')
  await page.locator('#settings-tab-data').click()
  await page.locator('#workspaceImportFile').setInputFiles({
    name: 'config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        version: 12,
        scope: 'config',
        images: [
          { id: 'shared-image', type: 'image', src: blue, createdAt: 2 },
        ],
        apiConfig: {
          settings: {
            imagePromptTemplates: [template('template-b', 'template')],
            imagePolishTemplates: [],
            activeImagePromptTemplateId: 'template-b',
          },
        },
      }),
    ),
  })
  await expect(page.locator('#toast')).toContainText('合并导入')
  await page.locator('#cancelSettings').click()
  await page.reload()
  await expect(page.locator('#imagePromptTemplateSelect option')).toHaveCount(2)
  await expect(
    page.locator('#imagePromptTemplateSelect option:checked'),
  ).toHaveText('template')
  await expect(page.locator('#imageReferencePreview img')).toHaveAttribute(
    'src',
    blue,
  )
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message.user img')).toHaveAttribute('src', red)
})

test('并发生图保留部分成功和请求审计, 远程结果保存后离线可用', async ({
  page,
}) => {
  await openWorkspace(page, {
    imageBaseUrl: 'https://orbit.test/v1',
    imageApiKey: 'test-key',
    imageCountMode: 'parallel',
  })
  const png = await pngFile(page, 'result.png', 'purple')
  let calls = 0
  const prompts: string[] = []
  await page.route('https://orbit.test/**', (route) => {
    if (route.request().url().endsWith('.png'))
      return route.fulfill({ body: png.buffer, contentType: 'image/png' })
    if (route.request().url().endsWith('/models'))
      return route.fulfill({ json: { data: [] } })
    calls++
    prompts.push(route.request().postDataBuffer()!.toString('latin1'))
    if (calls === 2)
      return route.fulfill({
        status: 400,
        json: { error: { message: '并发请求之一失败' } },
      })
    return route.fulfill({
      json: {
        model: 'response-image-model',
        data: [
          {
            url: 'https://orbit.test/result.png',
            revised_prompt: '接口修订提示词',
          },
        ],
      },
    })
  })
  await page
    .locator('#imageReferenceUpload')
    .setInputFiles(await pngFile(page, 'reference.png', 'orange'))
  await page.locator('#imagePrompt').fill('按 @图1 生成')
  await page.locator('#imageCount').fill('2')
  await page.locator('#generateImage').click()
  await expect(page.locator('.history-item.partial')).toHaveCount(1)
  expect(calls).toBe(2)
  expect(prompts.every((prompt) => prompt.includes('[image 1]'))).toBe(true)
  await page.locator('.history-image-button').click()
  await expect(page.locator('#lightboxImage')).toHaveAttribute(
    'src',
    /^data:image\/png/,
  )
  await expect(page.locator('#imageMetadata')).toContainText(
    'response-image-model',
  )
  await expect(page.locator('#imageMetadata')).toContainText('接口修订提示词')
  const requestDetails = page
    .locator('.metadata-disclosure')
    .filter({ hasText: '查看实际请求' })
  const responseDetails = page
    .locator('.metadata-disclosure')
    .filter({ hasText: '查看上游响应' })
  await requestDetails.locator('summary').click()
  await responseDetails.locator('summary').click()
  await expect(requestDetails.locator('pre')).toContainText(
    'multipart/form-data',
  )
  await expect(responseDetails.locator('pre')).toContainText(
    'response-image-model',
  )
  // 单图详情沿用原版展示该图的上游响应, 整个任务仍保存所有并发结果。
  const taskResponses = await page.evaluate(async () => {
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
    return records.find((record) => record.type === 'generation-task').responses
  })
  expect(taskResponses).toHaveLength(2)
  expect(JSON.stringify(taskResponses)).toContain('并发请求之一失败')
  await page.reload()
  await expect(page.locator('.history-item.partial')).toHaveCount(1)
})

test('删除收藏夹中的图片保留对话引用, 刷新后没有残留任务', async ({ page }) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('#imagePrompt').fill('同时用于对话和收藏的图片')
  await page.locator('#generateImage').click()
  await page.locator('[data-history-action="favorite"]').click()
  await page.locator('#saveFavoriteFolderChoices').click()
  await page.locator('.history-image-button').click()
  await page.locator('#lightboxCopyChat').click()
  await page.locator('#messageInput').fill('保留这张图片')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toBeVisible()
  await page.locator('[data-view="image"]').click()
  await page.locator('[data-history-library="favorites"]').click()
  const folderDelete = page.locator(
    '.favorite-folder-card button[aria-label="删除收藏夹"]',
  )
  await folderDelete.hover()
  await folderDelete.click()
  await page.locator('#deleteFavoriteImages').check()
  await page.locator('#confirmFavoriteDelete').click()
  await page.locator('[data-history-library="history"]').click()
  await expect(
    page.locator('.history-item, .generation-task-card'),
  ).toHaveCount(0)
  await page.reload()
  await expect(
    page.locator('.history-item, .generation-task-card'),
  ).toHaveCount(0)
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message.user .message-image')).toHaveCount(1)
})

test('收藏夹卡片和新建操作保持工作区的原有视觉样式', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        { id: 'favorites-default', name: '默认收藏夹', isDefault: true },
      ]),
    )
  })
  await openWorkspace(page)
  await page.locator('[data-history-library="favorites"]').click()
  const card = page.locator('.favorite-folder-card')
  await expect(card).toHaveClass(/is-default/)
  await expect(card.locator('.favorite-folder-visual svg')).toHaveCount(1)
  await expect(card.locator('.history-action-button')).toHaveCount(3)
  const defaultAction = card.locator(
    '.history-action-button[aria-label="设为默认收藏夹"]',
  )
  await expect(defaultAction).toHaveClass(/is-default/)
  await expect(defaultAction).not.toHaveClass(/is-favorite/)
  await expect(defaultAction.locator('svg')).toHaveCSS('fill', 'none')
  await expect(card.locator('.favorite-folder-name')).toHaveText('默认收藏夹')
  const cardStyle = await card.evaluate((element) => ({
    height: getComputedStyle(element).height,
    background: getComputedStyle(element).backgroundColor,
  }))
  expect(cardStyle.height).toBe('274px')
  expect(cardStyle.background).not.toMatch(/rgb\(255, 255, 255\)/)
  const createButton = page.locator('#newFavoriteFolder')
  await expect(createButton).toHaveCSS('width', '76px')
  await page.screenshot({ path: test.info().outputPath('favorite-style.png') })
})

test('收藏夹管理弹窗保持原版标题、尺寸、布局和行操作', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        { id: 'favorites-default', name: '默认收藏夹', isDefault: true },
      ]),
    )
  })
  await openWorkspace(page)
  await page.locator('[data-history-library="favorites"]').click()
  await page.locator('#newFavoriteFolder').click()
  const dialog = page.locator('#favoriteFolderBackdrop .settings-modal')
  await expect(dialog).toBeVisible()
  await expect(page.locator('#favoriteDialogTitle')).toHaveText('管理收藏夹')
  await expect(dialog).toHaveClass(/favorite-dialog/)
  await expect(dialog).toHaveCSS('width', '520px')
  await expect(
    page.locator('#favoriteFolderChoices .favorite-folder-row-actions button'),
  ).toHaveCount(3)
  await expect(
    page.locator(
      '#favoriteFolderChoices .favorite-folder-row > input[type="checkbox"]',
    ),
  ).toHaveCount(0)
  const body = page.locator('.favorite-dialog-body')
  await expect(body.locator('#favoriteFolderChoices')).toBeVisible()
  await expect(body.locator('#favoriteFolderCreateForm')).toBeVisible()
  await page.waitForTimeout(250)
  await page.screenshot({
    path: test.info().outputPath('favorite-management.png'),
  })
  await page.locator('#cancelFavoriteFolderDialog').click()
})

test('连续新建时复用当前空对话, 有消息后才添加新会话', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('[data-view="chat"]').click()
  const readActiveConversationId = () =>
    page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('orbit-chat-state-v1') || '{}')
          .activeConversationId,
    )
  const firstId = await readActiveConversationId()
  for (let index = 0; index < 3; index++)
    await page.locator('#newChatButton').click()
  await expect(page.locator('.conversation-item')).toHaveCount(1)
  expect(await readActiveConversationId()).toBe(firstId)

  await page.locator('#messageInput').fill('已有内容')
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toContainText('已有内容')
  await page.locator('#newChatButton').click()
  await expect(page.locator('.conversation-item')).toHaveCount(2)
  const emptyId = await readActiveConversationId()
  await page.locator('#newChatButton').click()
  await expect(page.locator('.conversation-item')).toHaveCount(2)
  expect(await readActiveConversationId()).toBe(emptyId)
})

test('尺寸面板只显示当前模式, 比例默认方形且取消不保存', async ({ page }) => {
  await openWorkspace(page)
  await page.locator('#imageSizeButton').click()
  await expect(page.locator('[data-size-panel="auto"]')).toBeVisible()
  await expect(page.locator('[data-size-panel="ratio"]')).toBeHidden()
  await expect(page.locator('[data-size-panel="custom"]')).toBeHidden()
  await page.locator('[data-size-mode="ratio"]').click()
  await expect(page.locator('[data-size-panel="auto"]')).toBeHidden()
  await expect(page.locator('[data-size-panel="ratio"]')).toBeVisible()
  await expect(page.locator('[data-size-panel="custom"]')).toBeHidden()
  await expect(page.locator('.ratio-choice.active')).toHaveAttribute(
    'data-ratio',
    '1:1',
  )
  await page.locator('#imageResolution-custom-trigger').click()
  await page.getByRole('option', { name: '2K', exact: true }).click()
  await expect(page.locator('#imageSizeCurrent')).toContainText('2048x2048')
  await expect(page.locator('.ratio-shape')).toHaveCount(8)
  await page.locator('[data-ratio="16:9"]').click()
  await expect(page.locator('.ratio-choice.active')).toHaveAttribute(
    'data-ratio',
    '16:9',
  )
  await page.locator('#cancelImageSize').click()
  await page.locator('#imageSizeButton').click()
  await expect(page.locator('[data-size-panel="auto"]')).toBeVisible()
  await expect(page.locator('[data-size-panel="ratio"]')).toBeHidden()
  await expect(page.locator('#imageSizeButton')).toContainText('自动')
})

test('生图下拉菜单保留自定义样式和键盘选择', async ({ page }) => {
  await openWorkspace(page)
  const control = page
    .locator('.select-control')
    .filter({ hasText: '输出透明度' })
  const trigger = control.locator('.custom-select-trigger')
  await expect(trigger).toHaveText('自动')
  await expect(trigger).toHaveCSS('background-color', 'rgb(16, 26, 40)')
  await trigger.focus()
  await trigger.press('ArrowDown')
  await expect(control.locator('.custom-select-menu')).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.locator('#imageBackground')).toHaveValue('opaque')
  await expect(trigger).toHaveText('不透明')
  await trigger.click()
  await control.getByRole('option', { name: '透明', exact: true }).click()
  await expect(page.locator('#imageBackground')).toHaveValue('transparent')
  await expect(trigger).toHaveText('透明')
})

test('数据范围导出使用原版文案、敏感确认、文件名和结果反馈', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.locator('#topbarSettings').click()
  await page.locator('#settings-tab-data').click()
  await page.locator('#exportWorkspace').click()
  await expect(page.locator('#dataScopeTitle')).toHaveText('选择导出范围')
  await expect(page.locator('#dataScopeDescription')).toHaveText(
    '请选择要写入 JSON 文件的数据范围。',
  )
  const [chatDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-data-scope="chat"]').click(),
  ])
  expect(chatDownload.suggestedFilename()).toMatch(
    /^orbit-chat-workspace-\d{4}-\d{2}-\d{2}\.json$/,
  )
  const chatExport = JSON.parse(
    await readFile((await chatDownload.path())!, 'utf8'),
  )
  expect(chatExport.scope).toBe('chat')
  await expect(page.locator('#toast')).toContainText('对话工作区已导出')

  await page.locator('#settings-tab-data').click()
  await page.locator('#exportWorkspace').click()
  let confirmation = ''
  page.once('dialog', (dialog) => {
    confirmation = dialog.message()
    void dialog.accept()
  })
  const [configDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-data-scope="config"]').click(),
  ])
  expect(confirmation).toContain('API Key、接口地址和模板')
  expect(configDownload.suggestedFilename()).toMatch(
    /^orbit-config-\d{4}-\d{2}-\d{2}\.json$/,
  )
  const configExport = JSON.parse(
    await readFile((await configDownload.path())!, 'utf8'),
  )
  expect(configExport.apiConfig).toBeTruthy()
  await expect(page.locator('#toast')).toContainText('配置已导出')
})

test('清除范围的说明、取消和对话清除行为保持原版规则', async ({ page }) => {
  await openWorkspace(page, {
    chatBaseUrl: 'https://chat.test/v1',
    chatApiKey: 'test-key',
  })
  await page.locator('#topbarSettings').click()
  await page.locator('#settings-tab-data').click()
  await page.locator('#resetLocalData').click()
  await expect(page.locator('#dataScopeTitle')).toHaveText('选择清除范围')
  await expect(page.locator('#dataScopeDescription')).toHaveText(
    '请选择本次要清除的数据范围，确认后不可撤销。',
  )
  let confirmation = ''
  page.once('dialog', (dialog) => {
    confirmation = dialog.message()
    void dialog.dismiss()
  })
  await page.locator('[data-data-scope="chat"]').click()
  expect(confirmation).toContain('清除对话工作区?')
  expect(confirmation).toContain('未被生图工作区引用的图片')
  await expect(page.locator('.conversation-item')).toHaveCount(1)

  await page.locator('#settings-tab-data').click()
  await page.locator('#resetLocalData').click()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('[data-data-scope="chat"]').click()
  await expect(page.locator('.conversation-item')).toHaveCount(1)
  await expect(page.locator('#toast')).toContainText('对话工作区已清除')
  await page.locator('#topbarSettings').click()
  await expect(page.locator('#chatBaseUrl')).toHaveValue('https://chat.test/v1')
})

test('接口模板校验、自动命名、同名覆盖、临时配置和删除反馈', async ({
  page,
}) => {
  await page.route('https://api.orbit.test/**', (route) =>
    route.fulfill({ json: { data: [{ id: 'model-one' }] } }),
  )
  await openWorkspace(page)
  await page.locator('#topbarSettings').click()
  await page.locator('#chatBaseUrl').fill('')
  await page.locator('#saveChatProfile').click()
  await expect(page.locator('#toast')).toContainText('请先填写接口地址')

  await page.locator('#chatBaseUrl').fill('https://api.orbit.test/v1')
  await page.locator('#chatApiKey').fill('local-test-key')
  await page.locator('#chatModel').fill('model-one')
  await page.locator('#loadChatModels').click()
  await expect(page.locator('#toast')).toContainText('已获取 1 个模型')
  page.once('dialog', (dialog) => {
    expect(dialog.defaultValue()).toBe('orbit.test')
    void dialog.accept('接口 A')
  })
  await page.locator('#saveChatProfile').click()
  await expect(page.locator('#chatProfileSelect option')).toHaveCount(2)
  await expect(page.locator('#chatProfileSelect option:checked')).toHaveText(
    '接口 A',
  )

  await page.locator('#chatModel').fill('model-two')
  let dialogCount = 0
  const handleOverwriteDialogs = async (dialog: Dialog) => {
    if (dialogCount++ === 0) {
      expect(dialog.type()).toBe('prompt')
      await dialog.accept('接口 a')
    } else {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    }
  }
  page.on('dialog', handleOverwriteDialogs)
  await page.locator('#saveChatProfile').click()
  page.off('dialog', handleOverwriteDialogs)
  await expect(page.locator('#chatProfileSelect option')).toHaveCount(2)
  await expect(page.locator('#chatProfileSelect option:checked')).toHaveText(
    '接口 a',
  )
  await expect(page.locator('#toast')).toContainText('模板已覆盖')

  await chooseCustomSelect(page, 'chatProfileSelect', '临时配置（未保存）')
  await expect(page.locator('#chatBaseUrl')).toHaveValue(
    'https://api.orbit.test/v1',
  )
  await expect(page.locator('#chatModel')).toHaveValue('model-two')
  await page.locator('#chatModel').click()
  await expect(page.locator('#chatModel-options [role="option"]')).toHaveCount(
    0,
  )
  await expect(page.locator('#chatModel-options')).toContainText(
    '暂无匹配模型，可直接输入模型名',
  )
  await expect(page.locator('#toast')).toContainText('当前填写内容保留')
  await chooseCustomSelect(page, 'chatProfileSelect', '接口 a')
  let confirmation = ''
  page.once('dialog', (dialog) => {
    confirmation = dialog.message()
    void dialog.accept()
  })
  await page.locator('#deleteChatProfile').click()
  expect(confirmation).toContain('接口 a')
  await expect(page.locator('#chatProfileSelect option')).toHaveCount(1)
  await expect(page.locator('#toast')).toContainText('当前接口配置仍保留')
  await expect(page.locator('#chatBaseUrl')).toHaveValue(
    'https://api.orbit.test/v1',
  )
})

test('获取模型时按钮显示请求中状态并禁止重复点击', async ({ page }) => {
  await page.route('https://models.test/v1/models', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.fulfill({ json: { data: [{ id: 'model-one' }] } })
  })
  await openWorkspace(page)
  await page.locator('#topbarSettings').click()
  for (const [tab, baseUrl, apiKey, buttonId] of [
    ['#settings-tab-chat', '#chatBaseUrl', '#chatApiKey', '#loadChatModels'],
    [
      '#settings-tab-image',
      '#imageBaseUrl',
      '#imageApiKey',
      '#loadImageModels',
    ],
  ]) {
    await page.locator(tab).click()
    await page.locator(baseUrl).fill('https://models.test/v1')
    await page.locator(apiKey).fill('test-key')
    const button = page.locator(buttonId)
    await button.click()
    await expect(button).toHaveText('获取中...')
    await expect(button).toBeDisabled()
    await expect(page.locator('#toast')).toContainText('已获取 1 个模型')
    await expect(button).toHaveText('获取模型')
    await expect(button).toBeEnabled()
  }
})

test('顶部连接状态沿用对话接口配置和聊天请求状态', async ({ page }) => {
  await page.route('https://chat.test/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.fulfill({
      json: { choices: [{ message: { content: '连接状态测试回复' } }] },
    })
  })
  await openWorkspace(page, {
    imageBaseUrl: 'https://image.test/v1',
    imageApiKey: 'image-key',
  })
  await expect(page.locator('#connectionText')).toHaveText('演示模式')
  await page.locator('#topbarSettings').click()
  await page.locator('#chatBaseUrl').fill('https://chat.test/v1')
  await page.locator('#chatApiKey').fill('chat-key')
  await page.locator('#settings-tab-display').click()
  await page.locator('#demoMode').uncheck()
  await page.locator('#saveSettings').click()
  await expect(page.locator('#connectionText')).toHaveText('已连接')
  await page.locator('[data-view="chat"]').click()
  await page.locator('#messageInput').fill('检查连接状态')
  await page.locator('#sendButton').click()
  await expect(page.locator('#connectionText')).toHaveText('请求中')
  await expect(page.locator('.message.assistant')).toContainText(
    '连接状态测试回复',
  )
  await expect(page.locator('#connectionText')).toHaveText('已连接')
})

test('对话重命名、删除提示、菜单关闭和 Markdown/HTML 导出保持原版行为', async ({
  page,
}) => {
  await openWorkspace(page, { demoMode: true })
  await page.locator('[data-view="chat"]').click()
  const exportButton = page.locator('#toggleConversationExportMenu')
  await expect(exportButton).toBeDisabled()

  await page
    .locator('#messageInput')
    .fill('内容 <script>alert(1)</script> & **加粗**')
  await page.locator('.conversation-item.active').click()
  await expect(page.locator('#messageInput')).toHaveValue(
    '内容 <script>alert(1)</script> & **加粗**',
  )
  await page.locator('#sendButton').click()
  await expect(page.locator('.message.assistant')).toBeVisible()
  page.once('dialog', (dialog) => void dialog.accept('危险<script>'))
  await page.locator('.conversation-action[aria-label="重命名对话"]').click()
  await expect(page.locator('.workspace-title')).toHaveText('危险<script>')

  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('.message.assistant .message-action').last().click()
  await expect(page.locator('#toast')).toContainText('消息已删除')
  await expect(page.locator('.message')).toHaveCount(1)

  await exportButton.click()
  await expect(page.locator('#conversationExportMenu')).toBeVisible()
  await page.locator('#topbarSettings').click()
  await expect(page.locator('#conversationExportMenu')).toBeHidden()
  await page.locator('#cancelSettings').click()
  await exportButton.click()
  await page.keyboard.press('Escape')
  await expect(page.locator('#conversationExportMenu')).toBeHidden()
  await expect(exportButton).toHaveAttribute('aria-expanded', 'false')

  await exportButton.click()
  const [markdownDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#conversationExportMenu button').first().click(),
  ])
  expect(markdownDownload.suggestedFilename()).toBe('危险_script_.md')
  const markdown = await readFile((await markdownDownload.path())!, 'utf8')
  expect(markdown).toContain('# 危险<script>')
  expect(markdown).toContain('> 导出时间：')
  expect(markdown).toContain('内容 <script>alert(1)</script> & **加粗**')
  await expect(page.locator('#toast')).toContainText(
    '当前对话已导出为 Markdown',
  )

  await exportButton.click()
  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#conversationExportMenu button').nth(1).click(),
  ])
  expect(htmlDownload.suggestedFilename()).toBe('危险_script_.html')
  const html = await readFile((await htmlDownload.path())!, 'utf8')
  expect(html).toContain('<title>危险&lt;script&gt;</title>')
  expect(html).toContain('内容 &lt;script&gt;alert(1)&lt;/script&gt; &amp;')
  expect(html).not.toContain('<script>alert(1)</script>')
})

test('图片引用菜单按光标筛选定位, 支持键盘、输入法、预览和原位编辑', async ({
  page,
}) => {
  await openWorkspace(page)
  await page
    .locator('#imageReferenceUpload')
    .setInputFiles([
      await pngFile(page, 'red.png', 'red'),
      await pngFile(page, 'blue.png', 'blue'),
    ])
  const input = page.locator('#imagePrompt')
  const wrap = page.locator('#imagePrompt').locator('..')
  const menu = wrap.locator('.image-mention-menu')
  await input.fill('@')
  await expect(menu).toBeVisible()
  await expect(menu.locator('.image-mention-option')).toHaveCount(2)
  await input.press('ArrowDown')
  await expect(menu.locator('.image-mention-option').nth(1)).toHaveClass(
    /active/,
  )
  await input.press('Enter')
  await expect(input).toHaveValue('@图2')

  await input.fill('@图2')
  await expect(menu.locator('.image-mention-option')).toHaveCount(1)
  await input.press('Escape')
  await expect(menu).toBeHidden()

  await input.fill('前置内容 @')
  const marker = page.locator('#imagePromptMirror .image-mention-caret')
  const markerBox = await marker.boundingBox()
  const menuBox = await menu.boundingBox()
  const wrapBox = await wrap.boundingBox()
  expect(markerBox).not.toBeNull()
  expect(menuBox).not.toBeNull()
  expect(wrapBox).not.toBeNull()
  expect(menuBox!.x).toBeGreaterThan(wrapBox!.x + 10)
  expect(Math.abs(menuBox!.x - markerBox!.x)).toBeLessThan(3)

  await input.fill('查看 @图1')
  const token = page.locator('#imagePromptMirror .image-mention-token')
  await token.hover()
  const tooltip = wrap.locator('.image-mention-tooltip')
  await expect(tooltip).toBeVisible()
  await expect(tooltip.locator('img')).toHaveAttribute(
    'src',
    /^data:image\/png/,
  )
  await token.click()
  await expect(input).toBeFocused()
  expect(
    await input.evaluate(
      (element: HTMLTextAreaElement) => element.selectionStart,
    ),
  ).toBe('查看 @图1'.length)
  await expect(page.locator('#imageLightbox')).toBeHidden()
  await expect(page.locator('#chatImageViewer')).toBeHidden()

  await input.evaluate((element: HTMLTextAreaElement) => {
    element.focus()
    element.value = '@'
    element.setSelectionRange(1, 1)
    element.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    )
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    )
  })
  await expect(menu).toBeVisible()
})

test('润色引用建议按两组图片和开关限制, 不会在已完成的引用中重复弹出', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.locator('#polishImagePrompt').click()
  await page
    .locator('#polishGenerationReferenceUpload')
    .setInputFiles(await pngFile(page, 'generation.png', 'red'))
  const source = page.locator('#polishSourcePrompt')
  const sourceMenu = page
    .locator('#polishSourcePromptMirror')
    .locator('..')
    .locator('.image-mention-menu')
  await source.fill('@')
  await expect(sourceMenu).toBeHidden()
  await page.locator('#polishUseGenerationReferences').check()
  await expect(sourceMenu.locator('.image-mention-option')).toHaveCount(1)
  await expect(sourceMenu).toContainText('@生成参考图1')

  await page
    .locator('#polishReferenceUpload')
    .setInputFiles(await pngFile(page, 'style.png', 'blue'))
  const instruction = page.locator('#polishInstruction')
  const instructionWrap = instruction.locator('..')
  const instructionMenu = instructionWrap.locator('.image-mention-menu')
  await instruction.fill('@')
  await expect(instructionMenu.locator('.image-mention-option')).toHaveCount(2)
  await page.locator('#polishUseGenerationReferences').uncheck()
  await expect(instructionMenu.locator('.image-mention-option')).toHaveCount(1)
  await expect(instructionMenu).toContainText('@润色参考图1')
  await instruction.fill('@润色参考图1')
  await expect(instructionMenu).toBeHidden()
  const token = page.locator('#polishInstructionMirror .image-mention-token')
  await expect(token).not.toHaveClass(/invalid/)
  await token.hover()
  await expect(instructionWrap.locator('.image-mention-tooltip')).toBeVisible()
})
