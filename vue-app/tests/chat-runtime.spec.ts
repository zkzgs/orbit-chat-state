import { test, expect, type Page } from '@playwright/test'

const api = 'https://runtime.test/v1'
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII='

async function open(
  page: Page,
  url: string,
  settings = {},
  messages: unknown[] = [],
) {
  await page.goto(url)
  await page.evaluate(
    ({ settings, messages, api }) => {
      const context = (model: string) => ({
        settings: {
          chatModel: model,
          systemPrompt: model + '-system',
          reasoningEffort: model === 'model-a' ? 'low' : 'high',
          chatStream: false,
          chatWebSearch: false,
          chatImageTools: false,
          chatHistoryImages: 'id',
          ...settings,
        },
        contextMode: 'client',
      })
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            theme: 'light',
            demoMode: false,
            chatBaseUrl: api,
            chatApiKey: 'test',
            chatModel: 'model-a',
            systemPrompt: 'model-a-system',
            reasoningEffort: 'low',
            imageBaseUrl: api,
            imageApiKey: 'test',
            imageModel: 'image-model',
            ...settings,
          },
          activeConversationId: 'a',
          conversations: [
            {
              id: 'a',
              title: '对话甲',
              createdAt: 2,
              chatContext: context('model-a'),
              messages,
            },
            {
              id: 'b',
              title: '对话乙',
              createdAt: 1,
              chatContext: context('model-b'),
              messages: [],
            },
          ],
        }),
      )
    },
    { settings, messages, api },
  )
  await page.reload()
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('#messageInput')).toBeVisible()
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function stored(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-chat-state-v1')!),
  )
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  for (const stream of [false, true]) {
    test(
      version + ' 不同对话并发且后台完成不清除当前状态 ' + stream,
      async ({ page }) => {
        const requests: any[] = []
        const gates = [deferred(), deferred()]
        await page.route(api + '/chat/completions', async (route) => {
          const index = requests.length
          const body = route.request().postDataJSON()
          requests.push(body)
          await gates[index].promise
          const result = {
            content: index === 0 ? '甲的回答' : '乙的回答',
            reasoning_content: '**独立思考**',
          }
          await route
            .fulfill(
              stream
                ? {
                    contentType: 'text/event-stream',
                    body:
                      'data: ' +
                      JSON.stringify({ choices: [{ delta: result }] }) +
                      '\n\ndata: [DONE]\n\n',
                  }
                : { json: { choices: [{ message: result }] } },
            )
            .catch(() => {})
        })
        try {
          await open(page, url, { chatStream: stream })
          await page.locator('#messageInput').fill('甲的问题')
          await page.locator('#sendButton').click()
          await expect.poll(() => requests.length).toBe(1)
          await page
            .locator('.conversation-item')
            .filter({ hasText: '对话乙' })
            .click()
          await expect(page.locator('#sendButton')).toHaveAttribute(
            'data-mode',
            'send',
          )
          await expect(page.locator('#typingIndicator')).toBeHidden()
          await page.locator('#messageInput').fill('乙的问题')
          await page.locator('#sendButton').click()
          await expect.poll(() => requests.length).toBe(2)
          await expect(
            page.locator('.conversation-icon.is-generating'),
          ).toHaveCount(2)
          expect(requests.map((r) => r.model)).toEqual(['model-a', 'model-b'])
          expect(requests.map((r) => r.reasoning_effort)).toEqual([
            'low',
            'high',
          ])
          expect(requests[0].messages[0].content).toBe('model-a-system')
          expect(requests[1].messages[0].content).toBe('model-b-system')
          expect(requests[1].messages.at(-1).content).toBe('乙的问题')
          gates[0].resolve()
          await expect(
            page.locator('.conversation-icon.is-generating'),
          ).toHaveCount(1)
          await expect(page.locator('#sendButton')).toHaveAttribute(
            'data-mode',
            'stop',
          )
          await expect(page.locator('#typingIndicator')).toBeVisible()
          await expect(page.locator('.message.assistant')).toHaveCount(0)
          gates[1].resolve()
          await expect(page.locator('#sendButton')).toHaveAttribute(
            'data-mode',
            'send',
          )
          await expect(page.locator('.message.assistant')).toContainText(
            '乙的回答',
          )
          await page
            .locator('.conversation-item')
            .filter({ hasText: '对话甲' })
            .click()
          await expect(page.locator('.message.assistant')).toContainText(
            '甲的回答',
          )
          await expect(
            page.locator('.conversation-icon.is-generating'),
          ).toHaveCount(0)
          await expect
            .poll(async () =>
              (await stored(page)).conversations.map((c: any) =>
                c.messages
                  .filter((m: any) => m.role === 'assistant')
                  .map((m: any) => m.content),
              ),
            )
            .toEqual([['甲的回答'], ['乙的回答']])
        } finally {
          gates.forEach((gate) => gate.resolve())
        }
      },
    )
  }

  test(version + ' 暂停当前对话不会取消另一对话', async ({ page }) => {
    const requests: any[] = []
    const gates = [deferred(), deferred()]
    await page.route(api + '/chat/completions', async (route) => {
      const index = requests.length
      requests.push(route.request().postDataJSON())
      await gates[index].promise
      await route
        .fulfill({ json: { choices: [{ message: { content: '完成乙' } }] } })
        .catch(() => {})
    })
    try {
      await open(page, url)
      await page.locator('#messageInput').fill('暂停甲')
      await page.locator('#sendButton').click()
      await expect.poll(() => requests.length).toBe(1)
      await page
        .locator('.conversation-item')
        .filter({ hasText: '对话乙' })
        .click()
      await page.locator('#messageInput').fill('保留乙')
      await page.locator('#sendButton').click()
      await expect.poll(() => requests.length).toBe(2)
      await page
        .locator('.conversation-item')
        .filter({ hasText: '对话甲' })
        .click()
      await page.locator('#sendButton').click()
      await expect(page.locator('#sendButton')).toHaveAttribute(
        'data-mode',
        'send',
      )
      await expect(
        page.locator('.conversation-icon.is-generating'),
      ).toHaveCount(1)
      await page
        .locator('.conversation-item')
        .filter({ hasText: '对话乙' })
        .click()
      await expect(page.locator('#sendButton')).toHaveAttribute(
        'data-mode',
        'stop',
      )
      gates[1].resolve()
      await expect(page.locator('.message.assistant')).toContainText('完成乙')
      await expect(page.locator('#sendButton')).toHaveAttribute(
        'data-mode',
        'send',
      )
    } finally {
      gates.forEach((gate) => gate.resolve())
    }
  })

  test(
    version + ' 思考区解析 Markdown 且浅色使用次要文字',
    async ({ page }) => {
      await open(page, url, {}, [
        {
          id: 'm',
          role: 'assistant',
          content: '主要回答',
          reasoning:
            '# 思考标题\n\n**粗体**\n\n- 步骤\n\n|名称|值|\n|---|---|\n|项目|结果|\n\n    const x = 1',
          imageIds: [],
          createdAt: 1,
        },
      ])
      const reasoning = page.locator('.message-reasoning')
      await reasoning.locator('summary').click()
      await expect(reasoning.locator('strong')).toHaveText('粗体')
      await expect(reasoning.locator('li')).toHaveText('步骤')
      await expect(reasoning.locator('table')).toHaveCount(1)
      await expect(reasoning.locator('pre code')).toContainText('const x = 1')
      const colors = await page.evaluate(() => ({
        content: getComputedStyle(
          document.querySelector('.message-reasoning-content')!,
        ).color,
        title: getComputedStyle(
          document.querySelector('.message-reasoning-content h1')!,
        ).color,
        main: getComputedStyle(document.querySelector('.message-text')!).color,
      }))
      expect(colors.content).not.toBe(colors.main)
      expect(colors.title).toBe(colors.content)
    },
  )

  test(
    version + ' 历史生成图以 user 图片块携带, 点击后打开生成详情',
    async ({ page }) => {
      const requests: any[] = []
      await open(page, url, { chatHistoryImages: 'all' }, [
        {
          id: 'assistant-image',
          role: 'assistant',
          content: '上一轮生成的图片',
          imageIds: ['generated'],
          createdAt: 1,
        },
      ])
      await page.evaluate(async (png) => {
        localStorage.setItem(
          'orbit-image-favorite-folders-v1',
          JSON.stringify([
            { id: 'hidden-generated', name: '隐藏收藏', hidden: true },
          ]),
        )
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('orbit-chat-images-v1')
          request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains('generations'))
              request.result.createObjectStore('generations', {
                keyPath: 'id',
              })
          }
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction('generations', 'readwrite')
          const config = {
            model: 'image-model',
            requestType: 'generation',
            format: 'png',
            count: 1,
          }
          tx.objectStore('generations').put({
            id: 'generated',
            type: 'image',
            src: `data:image/png;base64,${png}`,
            batchId: 'generated-batch',
            taskId: 'generated-task',
            prompt: '历史生成图',
            favoriteFolderIds: ['hidden-generated'],
            config,
            createdAt: 1,
          })
          tx.objectStore('generations').put({
            id: 'generated-batch',
            type: 'generation-batch',
            batchId: 'generated-batch',
            taskId: 'generated-task',
            prompt: '历史生成图',
            config,
            imageIds: ['generated'],
            referenceImageIds: [],
            responseMeta: {},
            imageCount: 1,
            startedAt: 1,
            createdAt: 1,
            completedAt: 1,
            durationMs: 0,
          })
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        db.close()
      }, png)
      await page.reload()
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('.message-image-button')).toHaveCount(1)
      await page.locator('.message-image-button').click()
      await expect(page.locator('#imageLightbox')).toBeVisible()
      await expect(page.locator('#lightboxImage')).toBeVisible()
      await expect
        .poll(() =>
          page
            .locator('#lightboxImage')
            .evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0)
      await expect(page.locator('#lightboxPrompt')).toContainText('历史生成图')
      await page.locator('#closeLightbox').click()

      await page.route(api + '/chat/completions', async (route) => {
        requests.push(route.request().postDataJSON())
        await route.fulfill({
          json: { choices: [{ message: { content: '继续完成' } }] },
        })
      })
      await page.locator('#messageInput').fill('继续分析')
      await page.locator('#sendButton').click()
      await expect(page.locator('.message.assistant').last()).toContainText(
        '继续完成',
      )
      const messages = requests[0].messages
      const assistant = messages.find(
        (message: any) => message.content === '上一轮生成的图片',
      )
      expect(assistant).toBeTruthy()
      expect(
        messages.some(
          (message: any) =>
            message.role === 'assistant' &&
            Array.isArray(message.content) &&
            message.content.some((part: any) => part.type === 'image_url'),
        ),
      ).toBe(false)
      const imageContext = messages.find(
        (message: any) =>
          message.role === 'user' &&
          Array.isArray(message.content) &&
          message.content.some((part: any) => part.type === 'image_url'),
      )
      expect(imageContext.content[0].text).toContain('助手回复生成的图片')
      expect(
        imageContext.content.some((part: any) => part.type === 'image_url'),
      ).toBe(true)
    },
  )

  for (const preview of [false, true]) {
    test(
      version +
        ' Agent 生成结果预览回传开关 ' +
        preview +
        ', 历史不保存预览数据',
      async ({ page }) => {
        const requests: any[] = []
        await page.route(api + '/**', async (route) => {
          if (route.request().method() === 'GET') {
            await route.fulfill({ json: { data: [{ id: 'model-a' }] } })
            return
          }
          if (route.request().url().includes('/images/')) {
            await route.fulfill({ json: { data: [{ b64_json: png }] } })
            return
          }
          const body = route.request().postDataJSON()
          requests.push(body)
          const message =
            requests.length === 1
              ? {
                  role: 'assistant',
                  content: null,
                  tool_calls: [0, 1].map((index) => ({
                    id: 'call-' + index,
                    type: 'function',
                    function: {
                      name: 'generate_image',
                      arguments: JSON.stringify({
                        prompt: '测试图',
                        reference_image_ids: [],
                      }),
                    },
                  })),
                }
              : { role: 'assistant', content: '生成结果已返回' }
          await route.fulfill({ json: { choices: [{ message }] } })
        })
        await open(page, url, {
          chatImageTools: true,
          chatHistoryImages: 'id',
          imageAgentPreview: false,
          imageAgentRetryErrors: false,
          imageAgentRetryMismatch: false,
        })
        await page.locator('#topbarSettings').click()
        await page.locator('#settings-tab-agent').click()
        await expect(page.locator('#imageAgentPreview')).not.toBeChecked()
        if (preview)
          await page.locator('#imageAgentPreview').locator('..').click()
        await expect(page.locator('#imageAgentPreview')).toBeChecked({
          checked: preview,
        })
        await page.locator('#saveSettings').click()
        await page.locator('#messageInput').fill('生成两张图')
        await page.locator('#sendButton').click()
        await expect(page.locator('.message.assistant').last()).toContainText(
          '生成结果已返回',
        )
        await expect(page.locator('#sendButton')).toHaveAttribute(
          'data-mode',
          'send',
        )
        expect(requests).toHaveLength(2)
        const messages = requests[1].messages
        expect(messages.filter((m: any) => m.role === 'tool')).toHaveLength(2)
        const parts = messages.flatMap((m: any) =>
          Array.isArray(m.content) ? m.content : [],
        )
        const images = parts.filter((part: any) => part.type === 'image_url')
        if (preview) {
          expect(images.length).toBeGreaterThan(0)
          expect(
            images.every((part: any) =>
              part.image_url.url.startsWith('data:image/'),
            ),
          ).toBe(true)
          expect(messages.at(-1).role).toBe('user')
          expect(
            parts.some((part: any) => part.text?.includes('生成结果图片 ID:')),
          ).toBe(true)
          expect(messages.findLastIndex((m: any) => m.role === 'tool')).toBe(
            messages.length - 2,
          )
        } else {
          expect(images).toHaveLength(0)
          expect(messages.at(-1).role).toBe('tool')
        }
        await expect
          .poll(async () => (await stored(page)).settings.imageAgentPreview)
          .toBe(preview)
        const saved = await stored(page)
        expect(JSON.stringify(saved.conversations)).not.toContain('data:image')
        await page.locator('#messageInput').fill('继续文字交流')
        await page.locator('#sendButton').click()
        await expect(page.locator('.message.assistant')).toHaveCount(2)
        await expect(page.locator('#sendButton')).toHaveAttribute(
          'data-mode',
          'send',
        )
        expect(requests).toHaveLength(3)
        expect(JSON.stringify(requests[2].messages)).not.toContain('data:image')
      },
    )
  }
}
