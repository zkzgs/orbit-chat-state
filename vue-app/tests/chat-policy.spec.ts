import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  agentImageFields,
  chatReasoningMessages,
  resolveAgentImageOptions,
  runImageAgent,
} from '../src/api/image-agent.js'

async function open(page: Page, url: string, settings = {}, withImage = false) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'text/javascript',
      }),
  )
  await page.goto(url)
  await page.evaluate(
    async ({ settings, withImage }) => {
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            demoMode: false,
            theme: 'light',
            chatBaseUrl: 'https://policy.test/v1',
            chatApiKey: 'test',
            chatStream: false,
            ...settings,
          },
          activeConversationId: 'a',
          conversations: [
            {
              id: 'a',
              title: '一个对话标题',
              createdAt: 1,
              messages: withImage
                ? [
                    {
                      id: 'u',
                      role: 'user',
                      content: '原来的图片',
                      imageIds: ['img'],
                      createdAt: 1,
                    },
                    {
                      id: 'a',
                      role: 'assistant',
                      content: '收到',
                      imageIds: [],
                      createdAt: 2,
                    },
                  ]
                : [],
            },
          ],
        }),
      )
      if (withImage) {
        const canvas = document.createElement('canvas')
        canvas.width = 1200
        canvas.height = 800
        canvas.getContext('2d')!.fillRect(0, 0, 1200, 800)
        const db = await new Promise<IDBDatabase>((resolve) => {
          const r = indexedDB.open('orbit-chat-images-v1')
          r.onupgradeneeded = () =>
            r.result.createObjectStore('generations', { keyPath: 'id' })
          r.onsuccess = () => resolve(r.result)
        })
        await new Promise<void>((resolve) => {
          const tx = db.transaction('generations', 'readwrite')
          tx.objectStore('generations').put({
            id: 'img',
            type: 'image',
            src: canvas.toDataURL(),
            createdAt: 1,
          })
          tx.oncomplete = () => resolve()
        })
        db.close()
      }
    },
    { settings, withImage },
  )
  await page.reload()
  await page.locator('[data-view="chat"]').click()
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' 标题悬停才溢出时滚动, 宽度变化实时更新',
    async ({ page }) => {
      await open(page, url)
      await page.mouse.move(800, 300)
      const title = page.locator('.conversation-title')
      const idle = await title.evaluate((el) => {
        const style = getComputedStyle(el)
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')!
        ctx.font = style.font
        el.textContent = '字'.repeat(
          Math.floor((el.clientWidth - 6) / ctx.measureText('字').width),
        )
        return {
          width: el.clientWidth,
          overflow: el.scrollWidth > el.clientWidth,
        }
      })
      expect(idle.overflow).toBe(false)
      await page.locator('.conversation-row').hover()
      await expect(title.locator('.conversation-title-track')).toBeVisible()
      expect(await title.evaluate((el) => el.clientWidth)).toBeLessThan(
        idle.width - 20,
      )
      await page
        .locator('#sidebar')
        .evaluate((el) =>
          (el as HTMLElement).style.setProperty('--sidebar-width', '500px'),
        )
      await expect(title.locator('.conversation-title-track')).toHaveCount(0)
      await page
        .locator('#sidebar')
        .evaluate((el) =>
          (el as HTMLElement).style.setProperty('--sidebar-width', '274px'),
        )
      await expect(title.locator('.conversation-title-track')).toBeVisible()
      await page.locator('#messageInput').hover()
      await expect(title.locator('.conversation-title-track')).toHaveCount(0)
      expect(await title.evaluate((el) => el.clientWidth)).toBe(idle.width)
    },
  )

  test(
    version + ' 侧栏拖窄自动折叠, 重新展开恢复可用宽度',
    async ({ page }) => {
      await open(page, url)
      const sidebar = page.locator('#sidebar')
      const before = (await sidebar.boundingBox())!.width
      const handle = (await page.locator('#sidebarResize').boundingBox())!
      await page.mouse.move(handle.x + 4, handle.y + 100)
      await page.mouse.down()
      await page.mouse.move(185, handle.y + 100, { steps: 4 })
      await expect(sidebar).toBeVisible()
      expect((await sidebar.boundingBox())!.width).toBeLessThan(210)
      await page.mouse.move(140, handle.y + 100, { steps: 3 })
      await page.mouse.up()
      await expect(sidebar).toBeHidden()
      await expect(page.locator('#openSidebar')).toHaveAttribute(
        'aria-expanded',
        'false',
      )
      await expect(page.locator('html')).not.toHaveClass(/resizing-sidebar/)
      await page.locator('#openSidebar').click()
      await expect(sidebar).toBeVisible()
      expect((await sidebar.boundingBox())!.width).toBe(before)
    },
  )

  test(
    version + ' 设置序号沿用强调色, 对话策略默认值及保存取消正确',
    async ({ page }) => {
      await open(page, url)
      await page.locator('#topbarSettings').click()
      const color = await page
        .locator('#settings-panel-chat .section-number')
        .evaluate((el) => {
          const probe = document.createElement('span')
          probe.style.color = 'var(--accent)'
          document.body.append(probe)
          const result = [
            getComputedStyle(el).color,
            getComputedStyle(probe).color,
          ]
          probe.remove()
          return result
        })
      expect(color[0]).toBe(color[1])
      await page.locator('#settings-tab-display').click()
      await expect(page.locator('#imagePrivacyEnabled')).not.toBeChecked()
      const privacyMode = page
        .locator('#imagePrivacyMode')
        .locator('..')
        .locator('.custom-select-trigger')
      await expect(privacyMode).toBeDisabled()
      await page.locator('#imagePrivacyEnabled').locator('..').click()
      await expect(privacyMode).toBeEnabled()
      await page.locator('#imagePrivacyEnabled').locator('..').click()
      await page.locator('#settings-tab-images').click()
      await expect(page.locator('#imagePreventPromptRewrite')).toBeChecked()
      await page.locator('#settings-tab-habits').click()
      await expect(page.locator('#persistInputContent')).toBeChecked()
      await expect(
        page.locator('#deleteRetriedRecordOnSuccess'),
      ).not.toBeChecked()
      await expect(page.locator('#clearInputAfterSubmit')).not.toBeChecked()
      await page.locator('#settings-tab-chat-policy').click()
      await expect(page.locator('#chatHistoryImages')).toHaveValue('all')
      await expect(page.locator('#chatImagePreview')).toBeChecked()
      await expect(page.locator('#chatSendReasoning')).toBeChecked()
      await expect(page.locator('#imageAgentPreview')).toBeChecked()
      await page.locator('#chatSendReasoning').locator('..').click()
      await page.locator('#settings-tab-agent').click()
      await expect(page.locator('#imageAgentRetryErrors')).toBeChecked()
      await expect(page.locator('#imageAgentRetryMismatch')).toBeEnabled()
      await expect(page.locator('#imageAgentRetryLimit')).toHaveValue('5')
      await page.locator('#imageAgentPreview').locator('..').click()
      await expect(page.locator('#imageAgentRetryMismatch')).toBeDisabled()
      await page.locator('#imageAgentPreview').locator('..').click()
      await expect(page.locator('#imageAgentRetryMismatch')).toBeEnabled()
      await page.locator('#imageAgentRetryErrors').locator('..').click()
      await page.locator('#imageAgentRetryMismatch').locator('..').click()
      await page.locator('#imageAgentRetryLimit').fill('3')
      page.once('dialog', (d) => d.dismiss())
      await page.locator('#cancelSettings').click()
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-chat-policy').click()
      await expect(page.locator('#chatSendReasoning')).toBeChecked()
      await page.locator('#chatSendReasoning').locator('..').click()
      await page.locator('#settings-tab-agent').click()
      await expect(page.locator('#imageAgentRetryErrors')).toBeChecked()
      await expect(page.locator('#imageAgentRetryLimit')).toHaveValue('5')
      await page.locator('#imageAgentRetryErrors').locator('..').click()
      await page.locator('#imageAgentRetryLimit').fill('6')
      await page.locator('#saveSettings').click()
      await expect(page.locator('#settingsBackdrop')).toBeVisible()
      await page.locator('#imageAgentRetryLimit').fill('3')
      await page.locator('#saveSettings').click()
      await expect(page.locator('#settingsBackdrop')).toBeHidden()
      await page.reload()
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-chat-policy').click()
      await expect(page.locator('#chatSendReasoning')).not.toBeChecked()
      await page.locator('#settings-tab-agent').click()
      await expect(page.locator('#imageAgentRetryErrors')).not.toBeChecked()
      await expect(page.locator('#imageAgentRetryLimit')).toHaveValue('3')
    },
  )

  for (const history of ['id', 'all'])
    for (const preview of [false, true])
      test(
        version + ' 图片上下文 ' + history + ', 使用预览 ' + preview,
        async ({ page }) => {
          const requests: any[] = []
          await page.route(
            'https://policy.test/v1/chat/completions',
            async (route) => {
              requests.push(route.request().postDataJSON())
              await route.fulfill({
                json: { choices: [{ message: { content: '测试完成' } }] },
              })
            },
          )
          await open(
            page,
            url,
            { chatHistoryImages: history, chatImagePreview: preview },
            true,
          )
          await page.locator('#messageInput').fill('继续查看 @图1')
          await page.locator('#sendButton').click()
          await expect(page.locator('.message.assistant').last()).toContainText(
            '测试完成',
          )
          const parts = requests[0].messages.flatMap((m: any) =>
            Array.isArray(m.content) ? m.content : [],
          )
          const images = parts.filter((p: any) => p.type === 'image_url')
          expect(images).toHaveLength(history === 'all' ? 2 : 1)
          const size = await page.evaluate(async (src) => {
            const image = new Image()
            image.src = src
            await image.decode()
            return [image.naturalWidth, image.naturalHeight]
          }, images[0].image_url.url)
          expect(size).toEqual(preview ? [640, 427] : [1200, 800])
          expect(JSON.stringify(requests[0])).not.toContain('orbit-image:')
          if (history === 'id')
            expect(
              requests[0].messages.find((m: any) => m.role === 'user').content,
            ).toContain('[图片 ID:')
        },
      )

  test(
    version + ' 流式与非流式携带相同历史图片, 推理字段受开关控制',
    async ({ page }) => {
      const requests: any[] = []
      await page.route(
        'https://policy.test/v1/chat/completions',
        async (route) => {
          const body = route.request().postDataJSON()
          requests.push(body)
          await route.fulfill(
            body.stream
              ? {
                  contentType: 'text/event-stream',
                  body:
                    'data: ' +
                    JSON.stringify({
                      choices: [{ delta: { content: '完成' } }],
                    }) +
                    '\n\ndata: [DONE]\n\n',
                }
              : { json: { choices: [{ message: { content: '完成' } }] } },
          )
        },
      )
      for (const enabled of [false, true]) {
        const pair: any[] = []
        for (const stream of [false, true]) {
          await open(
            page,
            url,
            {
              chatHistoryImages: 'all',
              chatStream: stream,
              chatSendReasoning: enabled,
            },
            true,
          )
          await page.evaluate(() => {
            const state = JSON.parse(
              localStorage.getItem('orbit-chat-state-v1')!,
            )
            state.conversations[0].messages[1].reasoning = '需要回传的历史推理'
            localStorage.setItem('orbit-chat-state-v1', JSON.stringify(state))
          })
          await page.reload()
          await page.locator('#messageInput').fill('只描述之前的图片')
          await page.locator('#sendButton').click()
          await expect(page.locator('.message.assistant').last()).toContainText(
            '完成',
          )
          const body = requests.at(-1)
          pair.push(body.messages)
          expect(body.stream).toBe(stream)
          const assistant = body.messages.find(
            (m: any) => m.role === 'assistant',
          )
          if (enabled)
            expect(assistant.reasoning_content).toBe('需要回传的历史推理')
          else expect(assistant).not.toHaveProperty('reasoning_content')
          expect(
            body.messages
              .flatMap((m: any) => (Array.isArray(m.content) ? m.content : []))
              .filter((p: any) => p.type === 'image_url'),
          ).toHaveLength(1)
        }
        expect(pair[0]).toEqual(pair[1])
      }
    },
  )

  test(
    version + ' 纯文字连续请求保持已有消息前缀, 不插入随机 ID 或时间',
    async ({ page }) => {
      const requests: any[] = []
      await page.route(
        'https://policy.test/v1/chat/completions',
        async (route) => {
          requests.push(route.request().postDataJSON())
          await route.fulfill({
            json: { choices: [{ message: { content: '固定回答' } }] },
          })
        },
      )
      await open(page, url)
      for (const text of ['第一问', '第二问']) {
        await page.locator('#messageInput').fill(text)
        await page.locator('#sendButton').click()
        await expect(page.locator('#sendButton')).toHaveAttribute(
          'data-mode',
          'send',
        )
      }
      expect(requests).toHaveLength(2)
      expect(
        requests[1].messages.slice(0, requests[0].messages.length),
      ).toEqual(requests[0].messages)
      expect(requests.map(({ messages, ...params }) => params)[0]).toEqual(
        requests.map(({ messages, ...params }) => params)[1],
      )
      expect(
        Object.keys(requests[0].messages.find((m: any) => m.role === 'user')),
      ).toEqual(['role', 'content'])
    },
  )
}

function call(id: string, name: string, args: object) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}
async function agent(
  settings: object,
  steps: any[][],
  succeed: boolean | ((index: number) => boolean),
  imageModels: string[] = [],
) {
  const requests: any[] = [],
    generated: any[] = [],
    rounds: any[] = []
  const result = await runImageAgent({
    settings: { ...settings },
    messages: [{ role: 'user', content: '处理原图' }],
    imageIds: ['original'],
    imageModels,
    signal: new AbortController().signal,
    fetch: async (_: string, { body }: any) => {
      requests.push(JSON.parse(body))
      const calls = steps.shift()
      return Response.json({
        choices: [
          {
            message: calls
              ? { content: null, tool_calls: calls }
              : { content: '结束' },
          },
        ],
      })
    },
    generate: async (prompt: string, ids: string[], parameters?: object) => {
      generated.push({ prompt, ids, parameters })
      if (
        !(typeof succeed === 'function'
          ? succeed(generated.length - 1)
          : succeed)
      )
        throw new Error('上游生成失败')
      return { status: 'success', imageIds: ['result-' + generated.length] }
    },
    preview: async () => 'data:image/png;base64,test',
    onRound: (round: any) => rounds.push(JSON.parse(JSON.stringify(round))),
  })
  return { result, requests, generated, rounds }
}
const initial = call('first', 'generate_image', {
  prompt: '原始要求',
  reference_image_ids: ['original'],
})
const retry = (id: string, previous = 'first') =>
  call(id, 'retry_image', { tool_call_id: previous, prompt: '修正要求' })

for (const stream of [false, true])
  test(`Agent 从工具结果读取句柄连续重试, 保留推理和原图 ${stream}`, async () => {
    const requests: any[] = [],
      generated: string[][] = []
    let handle = ''
    await runImageAgent({
      settings: {
        chatBaseUrl: 'https://api.deepseek.com/chat/completions',
        chatSendReasoning: true,
        imageAgentRetryErrors: true,
        imageAgentRetryLimit: 2,
      },
      messages: [{ role: 'user', content: '原图生成失败时修正重试' }],
      imageIds: ['original'],
      signal: new AbortController().signal,
      onChunk: stream ? () => {} : undefined,
      fetch: async (_: string, { body }: any) => {
        const request = JSON.parse(body)
        requests.push(request)
        const tools = request.messages.filter((m: any) => m.role === 'tool')
        const output = tools.length ? JSON.parse(tools.at(-1).content) : null
        if (output) {
          expect(output.retry_tool_call_id).toBe(handle)
          expect(output.retryRemaining).toBe(3 - tools.length)
        }
        const message =
          tools.length < 3
            ? {
                reasoning_content: '检查工具结果后决定重试 ' + tools.length,
                tool_calls: tools.length
                  ? [retry('retry-' + tools.length, output.retry_tool_call_id)]
                  : [
                      call('opaque-call-id', 'generate_image', {
                        prompt: '初次生成',
                        reference_image_ids: ['original'],
                      }),
                    ],
              }
            : { content: '已用完重试次数' }
        if (!tools.length) handle = message.tool_calls![0].id
        for (const assistant of request.messages.filter(
          (m: any) => m.tool_calls,
        ))
          expect(assistant.reasoning_content).toContain('检查工具结果')
        return stream
          ? new Response(
              'data: ' +
                JSON.stringify({ choices: [{ delta: message }] }) +
                '\n\ndata: [DONE]\n\n',
              {
                headers: { 'Content-Type': 'text/event-stream' },
              },
            )
          : Response.json({ choices: [{ message }] })
      },
      generate: async (_: string, ids: string[]) => {
        generated.push(ids)
        // taskId 和图片 ID 都刻意不等于调用句柄。
        return {
          taskId: 'task-' + generated.length,
          status: 'error',
          imageIds: [],
          error: '测试失败',
        }
      },
      onRound: () => {},
    })
    expect(requests).toHaveLength(4)
    expect(generated).toEqual([['original'], ['original'], ['original']])
  })

test('推理回传仅由开关控制, 不判断地址和模型', () => {
  const messages = [
    { role: 'assistant', content: '回答', reasoning_content: '历史推理' },
  ]
  for (const chatBaseUrl of [
    'https://api.deepseek.com/v1',
    'https://relay.test/v1',
  ])
    for (const chatModel of ['deepseek-v4-pro', 'other-model']) {
      expect(
        chatReasoningMessages(messages, { chatBaseUrl, chatModel })[0],
      ).not.toHaveProperty('reasoning_content')
      expect(
        chatReasoningMessages(messages, {
          chatBaseUrl,
          chatModel,
          chatSendReasoning: false,
        })[0],
      ).not.toHaveProperty('reasoning_content')
      expect(
        chatReasoningMessages(messages, {
          chatBaseUrl,
          chatModel,
          chatSendReasoning: true,
        }),
      ).toEqual(messages)
    }
  expect(messages[0].reasoning_content).toBe('历史推理')
})

test('Agent 允许重试时仍由 AI 决定, 模型不调用则不重发', async () => {
  const { generated, requests } = await agent(
    { imageAgentRetryErrors: true },
    [[initial]],
    false,
  )
  expect(generated).toHaveLength(1)
  expect(requests).toHaveLength(2)
  expect(requests[0].tools.map((t: any) => t.function.name)).toContain(
    'retry_image',
  )
})
test('Agent 失败重试共享每轮上限, 沿用原图并允许修正提示词', async () => {
  const { generated, rounds } = await agent(
    { imageAgentRetryErrors: true, imageAgentRetryLimit: 2 },
    [[initial], [retry('r1')], [retry('r2')], [retry('r3')]],
    false,
  )
  expect(generated).toHaveLength(3)
  expect(generated.map((g) => g.ids)).toEqual([
    ['original'],
    ['original'],
    ['original'],
  ])
  expect(generated[1].prompt).toBe('修正要求')
  expect(JSON.parse(rounds.at(-1).results[0].content).error).toContain('上限')
})
for (const preview of [false, true])
  test('Agent 效果重试必须开启预览 ' + preview, async () => {
    const { generated, requests } = await agent(
      {
        imageAgentRetryMismatch: true,
        imageAgentPreview: preview,
        imageAgentRetryLimit: 1,
      },
      [[initial], [retry('r1')], [retry('r2')]],
      true,
    )
    expect(generated).toHaveLength(preview ? 2 : 1)
    expect(
      requests[0].tools
        .map((t: any) => t.function.name)
        .includes('retry_image'),
    ).toBe(preview)
  })
test('Agent 重试失败后按最近结果检查重试权限', async () => {
  const { generated, rounds } = await agent(
    {
      imageAgentRetryMismatch: true,
      imageAgentPreview: true,
      imageAgentRetryLimit: 2,
    },
    [[initial], [retry('r1')], [retry('r2')]],
    (index) => index === 0,
  )
  expect(generated).toHaveLength(2)
  expect(JSON.parse(rounds.at(-1).results[0].content).error).toContain(
    '未允许生图失败后重试',
  )
})

test('Agent 默认禁止重试, 不执行模型越权或跨轮重试', async () => {
  const a = await agent({}, [[initial], [retry('r1')]], false)
  expect(a.generated).toHaveLength(1)
  const b = await agent(
    { imageAgentRetryErrors: true },
    [[retry('r1', 'old-turn')]],
    false,
  )
  expect(b.generated).toHaveLength(0)
  expect(JSON.parse(b.rounds[0].results[0].content).error).toContain('本轮')
})

test('AI 生图参数限于当前接口的参数值, 不接受底层策略或模型覆盖', async () => {
  for (const provider of ['openai', 'xai', 'gemini']) {
    const defaults = resolveAgentImageOptions(provider)
    expect(defaults).toMatchObject({
      sizeMode: 'auto',
      ratio: 'auto',
      count: 1,
      quality: 'auto',
      format: 'png',
    })
    const result = resolveAgentImageOptions(provider, {
      ...defaults,
      count: 2,
      model: 'forged',
      provider: 'other',
      countMode: 'parallel',
      backgroundMode: 'prompt',
      compressReferences: false,
    })
    expect(result.count).toBe(2)
    for (const key of [
      'model',
      'provider',
      'countMode',
      'backgroundMode',
      'compressReferences',
    ])
      expect(result).not.toHaveProperty(key)
  }
  expect(() => resolveAgentImageOptions('openai', { count: 100 })).toThrow(
    '数量',
  )
  expect(() => resolveAgentImageOptions('openai', { width: 0 })).toThrow('宽度')
  expect(() =>
    resolveAgentImageOptions('openai', { format: 'unsupported' }),
  ).toThrow('格式')
  expect(() =>
    resolveAgentImageOptions('openai', { compression: 1.5 }),
  ).toThrow('压缩')
})

test('Agent 工具将模型限制为已获取模型并传入当次生图', async () => {
  const result = await agent(
    {
      imageProvider: 'openai',
      imageModel: 'image-fast',
      imageAgentAutoParameters: true,
    },
    [
      [
        call('first', 'generate_image', {
          prompt: '生成图像',
          reference_image_ids: [],
          image_options: { model: 'image-quality' },
        }),
      ],
    ],
    true,
    ['image-fast', 'image-quality'],
  )
  const options =
    result.requests[0].tools[0].function.parameters.properties.image_options
  expect(options.properties.model.enum).toEqual(['image-fast', 'image-quality'])
  expect(result.generated[0].parameters.model).toBe('image-quality')
  expect(() =>
    resolveAgentImageOptions(
      'openai',
      { model: 'not-configured' },
      ['image-fast', 'image-quality'],
      'image-fast',
    ),
  ).toThrow('模型')
})

test('AI 自动生图参数可选择已获取的模型, 手动模型仅保留当前选项', async () => {
  const available = ['image-fast', 'image-quality']
  const fields = agentImageFields('openai', available, 'image-fast')
  expect(fields.find((field) => field.key === 'model')?.options).toEqual(
    available.map((model) => ({ value: model, label: model })),
  )
  expect(() =>
    resolveAgentImageOptions(
      'openai',
      { model: 'not-configured' },
      available,
      'image-fast',
    ),
  ).toThrow('模型')
  const result = await agent(
    {
      imageProvider: 'openai',
      imageModel: 'image-fast',
      imageAgentAutoParameters: true,
    },
    [
      [
        call('first', 'generate_image', {
          prompt: '生成图像',
          reference_image_ids: [],
          image_options: { model: 'image-quality' },
        }),
      ],
    ],
    true,
    available,
  )
  expect(result.generated[0].parameters.model).toBe('image-quality')
  expect(
    result.requests[0].tools[0].function.parameters.properties.image_options
      .properties.model.enum,
  ).toEqual(available)
})

test('AI 自选参数及重试参数不沿用工作区, 手动模式忽略模型擅自传参', async () => {
  const first = call('first', 'generate_image', {
    prompt: '原始',
    reference_image_ids: ['original'],
    image_options: { format: 'webp', count: 2 },
  })
  const again = call('again', 'retry_image', {
    tool_call_id: 'first',
    prompt: '修正',
    image_options: { format: 'png', quality: 'high' },
  })
  const result = await agent(
    {
      imageProvider: 'openai',
      imageAgentAutoParameters: true,
      imageAgentRetryErrors: true,
      imageAgentRetryLimit: 1,
    },
    [[first], [again]],
    false,
  )
  expect(result.generated.map((item) => item.parameters)).toEqual([
    resolveAgentImageOptions('openai', { format: 'webp', count: 2 }),
    resolveAgentImageOptions('openai', { format: 'png', quality: 'high' }),
  ])
  expect(result.generated.map((item) => item.ids)).toEqual([
    ['original'],
    ['original'],
  ])
  for (const tool of result.requests[0].tools) {
    const schema = tool.function.parameters
    expect(schema.required).toContain('image_options')
    expect(schema.properties.image_options.required).toEqual(
      agentImageFields('openai').map((field) => field.key),
    )
    expect(schema.properties.image_options.additionalProperties).toBe(false)
  }
  const manual = await agent({}, [[first]], true)
  expect(manual.generated[0].parameters).toBeUndefined()
  expect(
    manual.requests[0].tools[0].function.parameters.properties,
  ).not.toHaveProperty('image_options')
})

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' Agent 参数快捷设置共享工作区, 保存取消及 AI 模式可切回',
    async ({ page }) => {
      await open(page, url)
      await expect(page.locator('#agentImageSettings')).toBeDisabled()
      await page.locator('#chatImageTools').check({ force: true })
      await expect(page.locator('#agentImageSettings')).toBeEnabled()
      await page.locator('#agentImageSettings').click()
      const modal = page.locator('#agentImageSettingsBackdrop')
      await expect(modal).toBeVisible()
      const originalModel = await page.locator('#agentImageModel').inputValue()
      await page.locator('#agentImageModel').fill('agent-test-model')
      await page.locator('#cancelAgentImageSettings').click()
      await page.locator('#agentImageSettings').click()
      await expect(page.locator('#agentImageModel')).toHaveValue(originalModel)
      await expect(
        page.locator('#agentImage-resolution').locator('..'),
      ).toBeHidden()
      await expect(page.locator('#agentImage-width')).toBeHidden()
      await expect(page.locator('#agentImageAutoParameters')).not.toBeChecked()
      await page
        .locator('#agentImage-quality')
        .selectOption('high', { force: true })
      await page.locator('#cancelAgentImageSettings').click()
      await page.locator('#agentImageSettings').click()
      await expect(page.locator('#agentImage-quality')).toHaveValue('auto')
      await page.locator('#agentImageModel').fill('agent-test-model')
      await page
        .locator('#agentImage-quality')
        .selectOption('high', { force: true })
      await page
        .locator('#agentImage-sizeMode')
        .selectOption('ratio', { force: true })
      await page
        .locator('#agentImage-ratio')
        .selectOption('16:9', { force: true })
      await page
        .locator('#agentImage-resolution')
        .selectOption('2K', { force: true })
      await expect(page.locator('#agentImage-width')).toBeHidden()
      await expect(
        page.locator('#agentImage-resolution').locator('..'),
      ).toBeVisible()
      await page.locator('#agentImage-count').fill('2')
      await page.locator('#saveAgentImageSettings').click()
      await expect(modal).toBeHidden()
      await page.locator('[data-view="image"]').click()
      await expect(page.locator('#imageQuality')).toHaveValue('high')
      await expect(page.locator('#imageRatio')).toHaveValue('16:9')
      await expect(page.locator('#imageCount')).toHaveValue('2')
      await expect(page.locator('#imageModelQuick')).toHaveValue(
        'agent-test-model',
      )
      await page.locator('[data-view="chat"]').click()
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-agent').click()
      await expect(page.locator('#imageAgentAutoParameters')).not.toBeChecked()
      await page.locator('#imageAgentAutoParameters').locator('..').click()
      await page.locator('#saveSettings').click()
      await page.locator('#agentImageSettings').click()
      await expect(page.locator('#agentImageAutoParameters')).toBeChecked()
      await expect(page.locator('#agentImageModel')).toBeEnabled()
      await expect(page.locator('#agentImage-count')).toBeDisabled()
      await expect(page.locator('#agentImage-quality')).toHaveValue('high')
      await page.locator('#agentImageAutoParameters').locator('..').click()
      await expect(page.locator('#agentImage-count')).toBeEnabled()
      await page.locator('#saveAgentImageSettings').click()
      await expect(page.locator('#agentImageSettings')).not.toContainText('AI')
      await page.reload()
      await page.locator('[data-view="chat"]').click()
      await page.locator('#agentImageSettings').click()
      await expect(page.locator('#agentImageAutoParameters')).not.toBeChecked()
      await expect(page.locator('#agentImage-quality')).toHaveValue('high')
    },
  )

  test(
    version + ' 手机快捷弹窗可滚动, AI 模式禁用手动控件, 取消不保存',
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 550 })
      await open(page, url)
      await expect(page.locator('#agentImageSettings')).toBeDisabled()
      await page.locator('#chatImageTools').check({ force: true })
      await page.locator('#agentImageSettings').click()
      await page.locator('#agentImageAutoParameters').locator('..').click()
      const box = await page.locator('#saveAgentImageSettings').boundingBox()
      expect(box!.y + box!.height).toBeLessThanOrEqual(550)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(390)
      await expect(
        page
          .locator('#agentImage-quality')
          .locator('..')
          .locator('.custom-select-trigger'),
      ).toBeDisabled()
      await page.locator('#cancelAgentImageSettings').click()
      await page.locator('#agentImageSettings').click()
      await expect(page.locator('#agentImageAutoParameters')).not.toBeChecked()
    },
  )

  for (const automatic of [false, true])
    test(
      version + ' Agent 实际请求参数隔离与底层策略 ' + automatic,
      async ({ page }) => {
        const chats: any[] = [],
          images: any[] = []
        await page.route('https://policy.test/**', async (route) => {
          const request = route.request()
          if (request.method() === 'GET')
            return route.fulfill({ json: { data: [] } })
          if (request.url().includes('/images/')) {
            images.push(request.postDataJSON())
            return route.fulfill({
              json: {
                data: [
                  {
                    b64_json:
                      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVocAAAAASUVORK5CYII=',
                  },
                ],
              },
            })
          }
          const body = request.postDataJSON()
          chats.push(body)
          return route.fulfill({
            json: {
              choices: [
                {
                  message:
                    chats.length === 1
                      ? {
                          content: null,
                          tool_calls: [
                            call('first', 'generate_image', {
                              prompt: '生成测试图',
                              reference_image_ids: [],
                              image_options: {
                                count: 2,
                                quality: 'low',
                                background: 'transparent',
                                model: automatic
                                  ? 'configured-model'
                                  : 'forged',
                                provider: 'gemini',
                                countMode: 'parameter',
                                backgroundMode: 'parameter',
                                compressReferences: false,
                              },
                            }),
                          ],
                        }
                      : { content: '完成' },
                },
              ],
            },
          })
        })
        await open(page, url, {
          chatImageTools: true,
          imageAgentAutoParameters: automatic,
          imageBaseUrl: 'https://policy.test/v1',
          imageApiKey: 'image-test',
          imageModel: 'configured-model',
          imageCountMode: 'parallel',
          imageBackgroundMode: 'prompt',
          compressRequestImages: true,
          imageOptions: {
            sizeMode: 'ratio',
            resolution: '2K',
            ratio: '16:9',
            width: 1024,
            height: 1024,
            quality: 'high',
            reasoningEffort: 'high',
            format: 'webp',
            compression: 75,
            background: 'opaque',
            moderation: 'low',
            count: 2,
          },
        })
        await page.locator('#messageInput').fill('生成测试图')
        await page.locator('#sendButton').click()
        await expect(page.locator('.message.assistant').last()).toContainText(
          '完成',
        )
        expect(images).toHaveLength(2)
        for (const body of images) {
          expect(body.model).toBe('configured-model')
          expect(body.n).toBe(1)
          expect(body).not.toHaveProperty('background')
          if (automatic) {
            expect(body.quality).toBe('low')
            expect(body).not.toHaveProperty('size')
            expect(body).not.toHaveProperty('output_format')
            expect(body).not.toHaveProperty('reasoning_effort')
            expect(body.moderation).toBe('auto')
            expect(body.prompt.toLowerCase()).toContain('transparent')
          } else {
            expect(body.quality).toBe('high')
            expect(body.size).toBe('2048x1152')
            expect(body.output_format).toBe('webp')
            expect(body.output_compression).toBe(75)
            expect(body.reasoning_effort).toBe('high')
          }
        }
        const options = await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('orbit-chat-state-v1')!).settings
              .imageOptions,
        )
        expect(options).toMatchObject({
          quality: 'high',
          format: 'webp',
          count: 2,
          background: 'opaque',
        })
      },
    )
}
