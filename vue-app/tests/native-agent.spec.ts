import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readBackup } from './helpers/backup'
test.beforeEach(async ({ page }) => {
  const script = await readFile('node_modules/selecto/dist/selecto.min.js')
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) => route.fulfill({ body: script, contentType: 'text/javascript' }),
  )
})
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII='
async function open(
  page: Page,
  url: string,
  settings: Record<string, unknown>,
) {
  await page.goto(url)
  await page.evaluate(
    (settings) =>
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            demoMode: false,
            imageBaseUrl: 'https://native.test/v1',
            imageApiKey: 'image-key',
            imageModel: 'test-image',
            chatBaseUrl: 'https://native.test/v1',
            chatApiKey: 'chat-key',
            chatModel: 'test-chat',
            ...settings,
          },
        }),
      ),
    settings,
  )
  await page.reload()
  await expect(page.locator('#imageView')).toBeVisible()
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  for (const provider of ['xai', 'gemini'])
    test(
      version + ' ' + provider + ' 原生请求、参考图、模型切换与持久化',
      async ({ page }) => {
        const requests: any[] = []
        let modelLoads = 0
        await page.route('https://native.test/**', async (route) => {
          const request = route.request()
          if (request.method() === 'GET') {
            modelLoads++
            await route.fulfill({
              json:
                provider === 'gemini'
                  ? { models: [{ name: 'models/new-image' }] }
                  : { data: [{ id: 'new-image' }] },
            })
            return
          }
          requests.push({
            url: request.url(),
            body: request.postDataJSON(),
            headers: request.headers(),
          })
          await route.fulfill({
            json:
              provider === 'gemini'
                ? {
                    candidates: [
                      {
                        content: {
                          parts: [
                            {
                              inlineData: { mimeType: 'image/png', data: png },
                            },
                          ],
                        },
                      },
                    ],
                  }
                : { data: [{ b64_json: png }] },
          })
        })
        await open(page, url, {
          imageProvider: provider,
          imageBaseUrl:
            provider === 'gemini'
              ? 'https://native.test/v1beta'
              : 'https://native.test/v1',
        })
        await page.locator('#imageModelQuick').fill('changed-model')
        await page.locator('#imagePrompt').fill('测试 @图1')
        await page.locator('#imageReferenceUpload').setInputFiles({
          name: 'ref.png',
          mimeType: 'image/png',
          buffer: Buffer.from(png, 'base64'),
        })
        await expect(
          page.locator('#imageReferencePreview .reference-preview-item'),
        ).toHaveCount(1)
        await page.locator('#generateImage').click()
        await expect(page.locator('.history-item.success')).toHaveCount(1)
        expect(requests).toHaveLength(1)
        const request = requests[0]
        expect(JSON.stringify(request)).not.toContain('orbit-image:')
        if (provider === 'gemini') {
          expect(request.url).toBe(
            'https://native.test/v1beta/models/changed-model:generateContent',
          )
          expect(request.headers['x-goog-api-key']).toBe('image-key')
          expect(request.body.contents[0].parts[1].inlineData.data).toBe(png)
          expect(request.body.generationConfig.responseModalities).toContain(
            'IMAGE',
          )
        } else {
          expect(request.url).toBe('https://native.test/v1/images/edits')
          expect(request.body.model).toBe('changed-model')
          expect(request.body.image.url).toBe('data:image/png;base64,' + png)
          expect(request.body.prompt).toContain('<IMAGE_0>')
        }
        const previous = modelLoads
        await page.locator('#imageModelQuick').click()
        const refreshButton =
          version === 'HTML'
            ? '[data-model-dropdown="image"][data-model-input="imageModelQuick"] .model-refresh'
            : '#imageModelQuick-options .model-refresh'
        await page.locator(refreshButton).click()
        await expect.poll(() => modelLoads).toBeGreaterThan(previous)
        await page.reload()
        await expect(page.locator('.history-item.success')).toHaveCount(1)
        await page.locator('.history-image-button').click()
        await expect(page.locator('#lightboxImage')).toHaveJSProperty(
          'naturalWidth',
          1,
        )
      },
    )
  for (const stream of [false, true])
    test(
      version + ' Agent 工具生图、多轮编辑与历史重放 ' + stream,
      async ({ page }) => {
        const chats: any[] = []
        const images: any[] = []
        await page.route('https://native.test/**', async (route) => {
          const request = route.request()
          if (request.method() === 'GET') {
            await route.fulfill({ json: { data: [] } })
            return
          }
          if (request.url().includes('/images/')) {
            images.push(request.postData())
            await route.fulfill({ json: { data: [{ b64_json: png }] } })
            return
          }
          const body = request.postDataJSON()
          chats.push(body)
          const messages = body.messages
          const last = messages.at(-1)
          let message: any
          if (last.role === 'tool')
            message = { role: 'assistant', content: '图片已经完成' }
          else {
            const system = messages[0].content as string
            const ids = system.match(/图片 ID: (.*?)。/)?.[1]
            const references =
              images.length && ids && ids !== '无' ? [ids.split(', ')[0]] : []
            message = {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call-' + images.length,
                  type: 'function',
                  function: {
                    name: 'generate_image',
                    arguments: JSON.stringify({
                      prompt: '画一只猫',
                      reference_image_ids: references,
                    }),
                  },
                },
              ],
            }
          }
          if (!body.stream) {
            await route.fulfill({ json: { choices: [{ message }] } })
            return
          }
          let deltas: any[]
          if (message.tool_calls) {
            const call = message.tool_calls[0]
            const args = call.function.arguments
            deltas = [
              {
                tool_calls: [
                  {
                    index: 0,
                    id: call.id,
                    type: 'function',
                    function: {
                      name: 'generate_image',
                      arguments: args.slice(0, 8),
                    },
                  },
                ],
              },
              {
                tool_calls: [
                  { index: 0, function: { arguments: args.slice(8) } },
                ],
              },
            ]
          } else deltas = [{ content: '图片已经' }, { content: '完成' }]
          await route.fulfill({
            contentType: 'text/event-stream',
            body:
              deltas
                .map(
                  (delta) =>
                    'data: ' +
                    JSON.stringify({ choices: [{ delta }] }) +
                    '\n\n',
                )
                .join('') + 'data: [DONE]\n\n',
          })
        })
        await open(page, url, { chatImageTools: true, chatStream: stream })
        await page.locator('[data-view="chat"]').click()
        await page.locator('#messageInput').fill('帮我生成猫图')
        await page.locator('#sendButton').click()
        await expect(page.locator('.message.assistant').last()).toContainText(
          '图片已经完成',
        )
        await expect(
          page.locator('.message.assistant .message-image'),
        ).toHaveCount(1)
        await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
        await page.locator('#messageInput').fill('再改成橘猫')
        await page.locator('#sendButton').click()
        await expect(page.locator('.message.assistant')).toHaveCount(2)
        await expect(page.locator('.message.assistant').last()).toContainText(
          '图片已经完成',
        )
        await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
        expect(chats).toHaveLength(4)
        expect(images).toHaveLength(2)
        expect(
          chats[2].messages.filter((m: any) => m.role === 'tool'),
        ).toHaveLength(1)
        expect(
          chats[2].messages.find((m: any) => m.tool_calls)?.tool_calls[0].id,
        ).toBe('call-0')
        expect(images[1]).toContain('name="image"')
        await page.reload()
        await page.locator('[data-view="chat"]').click()
        await expect(
          page.locator('.message.assistant .message-image'),
        ).toHaveCount(2)
        await page.locator('#topbarSettings').click()
        await page.locator('#settings-tab-data').click()
        await page.locator('#exportWorkspace').click()
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          page.locator('[data-data-scope="workspace"]').click(),
        ])
        const backup = await readFile((await download.path())!)
        const payload = readBackup(backup)
        expect(payload.imageHistory).toHaveLength(2)
        expect(
          payload.conversations[0].messages.filter(
            (m: any) => m.toolRounds?.length,
          ),
        ).toHaveLength(2)
        expect(payload.images.length).toBeGreaterThanOrEqual(1)
        const validIds = new Set(payload.images.map((image: any) => image.id))
        expect(
          payload.imageHistory.every((batch: any) =>
            batch.imageIds.every((id: string) => validIds.has(id)),
          ),
        ).toBe(true)
        page.on('dialog', (dialog) =>
          dialog.accept(dialog.type() === 'prompt' ? '覆盖' : undefined),
        )
        await page.locator('#workspaceImportFile').setInputFiles({
          name: 'agent.zip',
          mimeType: 'application/zip',
          buffer: backup,
        })
        await expect(page.locator('#toast')).toContainText('覆盖导入')
        await expect(page.locator('#importProgress')).toBeHidden()
        await page.locator('#cancelSettings').click()
        await page.locator('[data-view="chat"]').click()
        await page.locator('#messageInput').fill('导入后继续改图')
        await page.locator('#sendButton').click()
        await expect(page.locator('.message.assistant').last()).toContainText(
          '图片已经完成',
        )
        await expect(page.locator('.message.assistant')).toHaveCount(3)
        expect(chats).toHaveLength(6)
        expect(
          chats[4].messages.filter((message: any) => message.role === 'tool'),
        ).toHaveLength(2)
        expect(images).toHaveLength(3)
        expect(images[2]).toContain('name="image"')
      },
    )
  test(version + ' Grok 视频提交、轮询、预览、下载和备份', async ({ page }) => {
    await page.goto(url)
    const encoded = await page.evaluate(async () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const context = canvas.getContext('2d')!
      const stream = canvas.captureStream(10)
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
      const parts: BlobPart[] = []
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        recorder.ondataavailable = (event) => parts.push(event.data)
      })
      let frame = 0
      const timer = setInterval(() => {
        context.fillStyle = frame++ % 2 ? 'red' : 'blue'
        context.fillRect(0, 0, 32, 32)
      }, 100)
      recorder.start()
      await new Promise((resolve) => setTimeout(resolve, 1000))
      clearInterval(timer)
      recorder.stop()
      await stopped
      stream.getTracks().forEach((track) => track.stop())
      return new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1])
        reader.readAsDataURL(new Blob(parts, { type: 'video/webm' }))
      })
    })
    let polls = 0
    let body: any
    await page.route('https://native.test/**', async (route) => {
      if (route.request().url().endsWith('/file.mp4')) {
        await route.fulfill({
          contentType: 'video/webm',
          body: Buffer.from(encoded, 'base64'),
        })
        return
      }
      if (route.request().url().includes('/videos/job')) {
        polls++
        await route.fulfill({
          json:
            polls === 1
              ? { status: 'pending', progress: 50 }
              : {
                  status: 'done',
                  video: { url: 'https://native.test/file.mp4', duration: 2 },
                },
        })
        return
      }
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { data: [] } })
        return
      }
      body = route.request().postDataJSON()
      await route.fulfill({ json: { request_id: 'job' } })
    })
    await open(page, url, {
      imageProvider: 'xai',
      imageOptions: {
        mediaType: 'video',
        videoDuration: 2,
        videoResolution: '720p',
      },
    })
    await page.locator('#imagePrompt').fill('猫眨眼')
    await page.locator('#generateImage').click()
    await expect(page.locator('.history-item.success')).toHaveCount(1, {
      timeout: 15000,
    })
    expect(body.duration).toBe(2)
    expect(polls).toBe(2)
    await page.locator('.history-image-button').click()
    const video = page.locator('#lightboxVideo')
    await expect(video).toBeVisible()
    await expect(video).toHaveJSProperty('videoWidth', 32)
    await page.locator('#lightboxDownload').click()
    await page.locator('#closeLightbox').click()
    await page.reload()
    await expect(page.locator('.history-item.success')).toHaveCount(1)
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-data-scope="image"]').click(),
    ])
    const payload = readBackup(await readFile((await download.path())!))
    expect(payload.images[0].src).toBe('data:video/webm;base64,' + encoded)
    expect(payload.imageTasks[0].requestLog.remoteRequests[0].requestId).toBe(
      'job',
    )
    expect(payload.imageTasks[0].responses[0].response.responses).toHaveLength(
      3,
    )
  })
  test(version + ' 浅色设置持久化且桌面手机布局完整', async ({ page }) => {
    await open(page, url, { theme: 'light', imageProvider: 'xai' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-display').click()
      await expect(page.locator('#saveSettings')).toBeInViewport()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: '.cache/screens/' + version + '-light-' + width + '.png',
      })
      await page.locator('#cancelSettings').click()
    }
    await page.locator('#imageReferenceUpload').setInputFiles({
      name: 'light.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    })
    await page.locator('#imageReferencePreview img').click()
    await expect(page.locator('#viewerCopy')).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(page.locator('#viewerMeta')).toHaveCSS('color', 'rgb(0, 0, 0)')
    await page.locator('#viewerCopy').hover()
    await expect(page.locator('.custom-tooltip.show')).toHaveCSS(
      'background-color',
      'rgb(255, 255, 255)',
    )
    await expect(page.locator('.custom-tooltip.show')).toHaveCSS(
      'color',
      'rgb(0, 0, 0)',
    )
    await page.locator('#closeImageViewer').click()
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })
}
