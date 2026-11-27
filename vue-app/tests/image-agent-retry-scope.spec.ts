import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { agentMessages, runImageAgent } from '../src/api/image-agent.js'

const notRunHint = '未执行生图，不可重试，请修正参数后重新调用 generate_image'

function call(id: string, name: string, args: object) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}
const toolMessages = (request: any) =>
  request.messages
    .filter((m: any) => m.role === 'tool')
    .map((m: any) => JSON.parse(m.content))

async function run(options: {
  settings?: object
  steps: any[][]
  succeed?: boolean
  messages?: any[]
  imageIds?: string[]
  retryLimit?: () => number
  onRequest?: (index: number) => void
}) {
  const requests: any[] = [],
    generated: any[] = [],
    rounds: any[] = []
  await runImageAgent({
    settings: {
      imageAgentRetryErrors: true,
      imageAgentRetryLimit: 2,
      ...options.settings,
    },
    messages: options.messages || [{ role: 'user', content: '生成' }],
    imageIds: options.imageIds || ['original'],
    retryLimit: options.retryLimit,
    signal: new AbortController().signal,
    fetch: async (_: string, { body }: any) => {
      requests.push(JSON.parse(body))
      options.onRequest?.(requests.length)
      const calls = options.steps.shift()
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
    generate: async (prompt: string, ids: string[]) => {
      generated.push({ prompt, ids })
      return (options.succeed || prompt === '成功')
        ? { status: 'success', imageIds: ['result-' + generated.length] }
        : { status: 'error', imageIds: [], error: '上游失败' }
    },
    preview: async () => 'data:image/png;base64,test',
    onRound: (round: any) => rounds.push(JSON.parse(JSON.stringify(round))),
  })
  return { requests, generated, rounds }
}
const first = call('first', 'generate_image', {
  prompt: '原始',
  reference_image_ids: ['original'],
})
const retry = (id: string, of = 'first') =>
  call(id, 'retry_image', { tool_call_id: of, prompt: '修正' })

test('错误和效果重试各用自己的次数', async () => {
  const { generated, rounds } = await run({
    settings: {
      imageAgentPreview: true,
      imageAgentRetryMismatch: true,
      imageAgentErrorRetryLimit: 1,
      imageAgentMismatchRetryLimit: 1,
    },
    steps: [
      [first],
      [call('fix', 'retry_image', { tool_call_id: 'first', prompt: '成功' })],
      [retry('effect')],
      [retry('error-again')],
    ],
  })
  expect(generated).toHaveLength(3)
  expect(JSON.parse(rounds.at(-1).results[0].content).error).toBe('该图片任务已不可再重试')
})

test('工具结果不带重试次数, 句柄只在本轮请求中提供且不保存', async () => {
  const { requests, rounds } = await run({ steps: [[first], [retry('r1')]] })
  const system = requests[0].messages[0].content
  expect(system).not.toMatch(/\d+\s*次/)
  expect(system).not.toContain('共用次数')
  for (const request of requests)
    for (const output of toolMessages(request))
      expect(output).not.toHaveProperty('retryRemaining')
  expect(toolMessages(requests[1])[0].retry_tool_call_id).toBe('first')
  expect(toolMessages(requests[2])[1].retry_tool_call_id).toBe('first')
  for (const round of rounds)
    for (const result of round.results) {
      const saved = JSON.parse(result.content)
      expect(saved).not.toHaveProperty('retryRemaining')
      expect(saved).not.toHaveProperty('retry_tool_call_id')
    }
})

test('历史轮次发送时去掉重试句柄和次数, 旧句柄重试提示改用 generate_image', async () => {
  const old = {
    toolRounds: [
      {
        assistant: {
          role: 'assistant',
          content: null,
          tool_calls: [
            call('old-call', 'generate_image', {
              prompt: '狗',
              reference_image_ids: [],
            }),
          ],
        },
        results: [
          {
            role: 'tool',
            tool_call_id: 'old-call',
            content: JSON.stringify({
              status: 'success',
              imageIds: ['dog'],
              taskId: 't1',
              retry_tool_call_id: 'old-call',
              retryRemaining: 2,
            }),
          },
        ],
      },
    ],
  }
  const history = agentMessages(old)
  expect(JSON.parse(history[1].content)).toEqual({
    status: 'success',
    imageIds: ['dog'],
    taskId: 't1',
  })
  // 保存的数据保持原样, 只在发送时去掉。
  expect(JSON.parse(old.toolRounds[0].results[0].content).retryRemaining).toBe(
    2,
  )
  const { requests, generated, rounds } = await run({
    messages: [
      { role: 'user', content: '画狗' },
      ...history,
      { role: 'assistant', content: '已生成' },
      { role: 'user', content: '重做' },
    ],
    imageIds: ['dog'],
    steps: [[retry('r1', 'old-call')]],
    succeed: true,
  })
  expect(
    JSON.stringify(requests[0].messages.filter((m: any) => m.role === 'tool')),
  ).not.toMatch(/retry_tool_call_id|retryRemaining/)
  expect(generated).toHaveLength(0)
  const error = JSON.parse(rounds[0].results[0].content).error
  expect(error).toContain('之前的消息')
  expect(error).toContain('generate_image')
})

test('重试上限本地判断, 运行中读取最新设置, 超出时不带数字', async () => {
  let limit = 1
  const raised = await run({
    retryLimit: () => limit,
    onRequest: (index) => {
      if (index === 2) limit = 3
    },
    steps: [
      [first],
      [retry('r1')],
      [retry('r2')],
      [retry('r3')],
      [retry('r4')],
    ],
  })
  expect(raised.generated).toHaveLength(4)
  expect(JSON.parse(raised.rounds.at(-1).results[0].content).error).toBe(
    '该图片任务已不可再重试',
  )

  limit = 3
  const lowered = await run({
    retryLimit: () => limit,
    onRequest: (index) => {
      if (index === 2) limit = 1
    },
    steps: [[first], [retry('r1')], [retry('r2')]],
  })
  expect(lowered.generated).toHaveLength(2)
  const error = JSON.parse(lowered.rounds.at(-1).results[0].content).error
  expect(error).toBe('该图片任务已不可再重试')
  expect(error).not.toMatch(/\d/)
})

test('生图前失败不给重试句柄, 重试该调用返回同样提示', async () => {
  const bad = call('bad', 'generate_image', {
    prompt: '原始',
    reference_image_ids: ['missing'],
  })
  const { requests, generated, rounds } = await run({
    steps: [[bad], [retry('r1', 'bad')]],
  })
  expect(generated).toHaveLength(0)
  const output = toolMessages(requests[1])[0]
  expect(output).not.toHaveProperty('retry_tool_call_id')
  expect(output.error).toContain('参考图不属于当前对话')
  expect(output.error).toContain(notRunHint)
  expect(JSON.parse(rounds.at(-1).results[0].content).error).toBe(notRunHint)

  const invalid = await run({
    settings: { imageProvider: 'openai', imageAgentAutoParameters: true },
    steps: [
      [
        call('p', 'generate_image', {
          prompt: '原始',
          reference_image_ids: [],
          image_options: { count: 100 },
        }),
      ],
    ],
  })
  const message = toolMessages(invalid.requests[1])[0]
  expect(message.error).toContain('数量')
  expect(message.error).toContain(notRunHint)
  expect(message).not.toHaveProperty('retry_tool_call_id')
})

async function open(
  page: Page,
  url: string,
  settings: object,
  messages: any[],
) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto(url)
  await page.evaluate(
    ({ settings, messages }) => {
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            demoMode: false,
            chatBaseUrl: 'https://scope.test/v1',
            chatApiKey: 'test-chat',
            chatStream: false,
            imageBaseUrl: 'https://scope.test/v1',
            imageApiKey: 'test-image',
            imageModel: 'test-image',
            ...settings,
          },
          activeConversationId: 'c1',
          conversations: [
            { id: 'c1', title: '重试测试', createdAt: 1, messages },
            { id: 'empty', title: '空对话', createdAt: 0, messages: [] },
          ],
        }),
      )
    },
    { settings, messages },
  )
  await page.reload()
  await page.locator('[data-view="chat"]').click()
}

const seededMessages = [
  { id: 'u1', role: 'user', content: '画一只狗', imageIds: [], createdAt: 1 },
  {
    id: 'a1',
    role: 'assistant',
    content: '已生成狗',
    imageIds: [],
    createdAt: 2,
    toolRounds: [
      {
        assistant: {
          role: 'assistant',
          content: null,
          tool_calls: [
            call('old-call', 'generate_image', {
              prompt: '狗',
              reference_image_ids: [],
            }),
          ],
        },
        results: [
          {
            role: 'tool',
            tool_call_id: 'old-call',
            content: JSON.stringify({
              status: 'error',
              imageIds: [],
              error: '旧失败',
              retry_tool_call_id: 'old-call',
              retryRemaining: 2,
            }),
          },
        ],
      },
    ],
  },
]

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 代理错误可区分来源，HTML 不显示原文，日志不含请求内容`, async ({ page }) => {
    const proxyUrl = 'https://proxy.test/private-path'
    const requestId = 'f13316bb-a593-4518-8a1f-46937dcfa795'
    await page.route(`${proxyUrl}/**`, async (route) => {
      if (route.request().url().endsWith('/health'))
        return route.fulfill({ json: { service: 'orbit-api-proxy' } })
      if (route.request().method() !== 'POST') return route.fulfill({ json: { data: [] } })
      const prompt = JSON.stringify(route.request().postDataJSON())
      if (prompt.includes('网关测试'))
        return route.fulfill({ status: 502, headers: { 'access-control-expose-headers': 'x-orbit-proxy-stage, x-orbit-request-id', 'x-orbit-proxy-stage': 'gateway-proxy', 'x-orbit-request-id': requestId }, body: 'private-gateway-body' })
      if (prompt.includes('断连测试'))
        return route.fulfill({ status: 502, headers: { 'access-control-expose-headers': 'x-orbit-proxy-stage', 'x-orbit-proxy-stage': 'upstream-connection' }, json: { error: { message: 'socket hang up' } } })
      if (prompt.includes('上游测试'))
        return route.fulfill({ status: 429, headers: { 'access-control-expose-headers': 'x-orbit-proxy-stage', 'x-orbit-proxy-stage': 'upstream-response' }, json: { error: { message: 'limited' } } })
      return route.fulfill({ status: 524, contentType: 'text/html', body: '<!DOCTYPE html><html>private-page</html>' })
    })
    await open(page, url, { chatModel: 'test-chat', proxyEnabled: true, proxyUrl }, [])
    for (const [prompt, expected] of [
      ['网页测试', '代理链路（来源未确认）返回 HTTP 524：等待源站响应超时'],
      ['上游测试', '上游接口返回 HTTP 429'],
      ['断连测试', '代理转发失败（HTTP 502）：socket hang up'],
      ['网关测试', `代理网关转发失败（HTTP 502）（请求编号：${requestId}）`],
    ]) {
      await page.locator('#messageInput').fill(prompt)
      await page.locator('#sendButton').click()
      await expect(page.getByText(expected, { exact: false }).first()).toBeVisible()
    }
    await expect(page.getByText('private-page', { exact: false })).toHaveCount(0)
    await page.reload()
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-proxy').click()
    const download = page.waitForEvent('download')
    await page.locator('#exportRequestErrors').click()
    const text = await readFile((await (await download).path())!, 'utf8')
    expect(JSON.parse(text)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 524, stage: 'proxy-unknown', kind: 'html-response' }),
      expect.objectContaining({ status: 429, stage: 'upstream-response' }),
      expect.objectContaining({ status: 502, stage: 'upstream-connection', code: 'SOCKET_HANG_UP' }),
      expect.objectContaining({ status: 502, stage: 'gateway-proxy', requestId }),
    ]))
    expect(text).not.toMatch(/private-path|private-page|private-gateway-body|test-chat|网页测试|limited/)
  })

  test(
    version + ' 历史轮次不发送重试句柄和次数, 本地上限按当前设置',
    async ({ page }) => {
      const chats: any[] = []
      let images = 0
      await page.route('https://scope.test/**', async (route) => {
        const request = route.request()
        if (request.method() === 'GET')
          return route.fulfill({ json: { data: [] } })
        if (request.url().endsWith('/chat/completions')) {
          const body = request.postDataJSON()
          chats.push(body)
          const step = chats.length
          const message =
            step === 1
              ? {
                  content: null,
                  tool_calls: [
                    call('gen', 'generate_image', {
                      prompt: '新狗',
                      reference_image_ids: [],
                    }),
                  ],
                }
              : step <= 3
                ? {
                    content: null,
                    tool_calls: [
                      call('r' + step, 'retry_image', {
                        tool_call_id: 'gen',
                        prompt: '再试',
                      }),
                    ],
                  }
                : { content: '结束' }
          return route.fulfill({ json: { choices: [{ message }] } })
        }
        images++
        return route.fulfill({
          status: 500,
          json: { error: { message: '生图失败' } },
        })
      })
      await open(
        page,
        url,
        {
          chatImageTools: true,
          imageAgentRetryErrors: true,
          imageAgentRetryLimit: 1,
        },
        seededMessages,
      )
      await page.locator('#messageInput').fill('重做')
      await page.locator('#sendButton').click()
      await expect(page.locator('.message.assistant').last()).toContainText(
        '结束',
      )
      const historyTools = chats[0].messages.filter(
        (m: any) => m.role === 'tool',
      )
      expect(historyTools).toHaveLength(1)
      expect(historyTools[0].content).not.toMatch(
        /retry_tool_call_id|retryRemaining/,
      )
      for (const chat of chats)
        for (const output of toolMessages(chat))
          expect(output).not.toHaveProperty('retryRemaining')
      expect(toolMessages(chats[1]).at(-1).retry_tool_call_id).toBe('gen')
      // 上限 1: 第一次重试执行, 第二次本地拒绝。
      expect(images).toBe(2)
      expect(toolMessages(chats[3]).at(-1).error).toBe('该图片任务已不可再重试')
    },
  )

  test(version + ' 生成中修改重试上限立即生效', async ({ page }) => {
    let chats = 0
    let images = 0
    const outputs: any[] = []
    await page.route('https://scope.test/**', async (route) => {
      const request = route.request()
      if (request.method() === 'GET')
        return route.fulfill({ json: { data: [] } })
      if (request.url().endsWith('/chat/completions')) {
        chats++
        outputs.push(...toolMessages(request.postDataJSON()).slice(-1))
        if (chats === 3) {
          // 第一次重试已用完上限 1, 此时把上限改为 2。
          await page.locator('#topbarSettings').click()
          await page.locator('#settings-tab-agent').click()
          await page.locator('#imageAgentErrorRetryLimit').fill('2')
          await page.locator('#saveSettings').click()
        }
        const message =
          chats === 1
            ? {
                content: null,
                tool_calls: [
                  call('gen', 'generate_image', {
                    prompt: '新狗',
                    reference_image_ids: [],
                  }),
                ],
              }
            : chats <= 4
              ? {
                  content: null,
                  tool_calls: [
                    call('r' + chats, 'retry_image', {
                      tool_call_id: 'gen',
                      prompt: '再试',
                    }),
                  ],
                }
              : { content: '结束' }
        return route.fulfill({ json: { choices: [{ message }] } })
      }
      images++
      return route.fulfill({
        status: 500,
        json: { error: { message: '生图失败' } },
      })
    })
    await open(
      page,
      url,
      {
        chatImageTools: true,
        imageAgentRetryErrors: true,
        imageAgentRetryLimit: 1,
      },
      [],
    )
    await page.locator('#messageInput').fill('生成')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '结束',
      { timeout: 20000 },
    )
    expect(images).toBe(3)
    expect(outputs.at(-1).error).toBe('该图片任务已不可再重试')
  })

  test(
    version + ' 对话菜单复制为 Markdown 与导出内容一致',
    async ({ page }) => {
      await page.addInitScript(() => {
        ;(window as any).copied = []
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (text: string) =>
              (window as any).copied.push(text),
          },
        })
      })
      await open(
        page,
        url,
        {},
        seededMessages.map(({ toolRounds, ...message }: any) => message),
      )
      const openMenu = async (title: string) => {
        const row = page.locator('.conversation-row').filter({ hasText: title })
        await row.hover()
        await row.getByRole('button', { name: '对话操作' }).click()
        return page.locator('.conversation-row-menu')
      }
      // 空对话不出现在侧栏列表, 菜单按钮另有空消息禁用保护。
      await expect(
        page.locator('.conversation-row').filter({ hasText: '空对话' }),
      ).toHaveCount(0)
      let menu = await openMenu('重试测试')
      await expect(
        menu.getByRole('menuitem', { name: '复制为 Markdown' }),
      ).toBeEnabled()
      await menu.getByRole('menuitem', { name: '复制为 Markdown' }).click()
      await expect(page.getByText('当前对话已复制')).toBeVisible()
      const copied = await page.evaluate(
        () => (window as any).copied as string[],
      )
      expect(copied).toHaveLength(1)
      menu = await openMenu('重试测试')
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        menu.getByRole('menuitem', { name: '导出 Markdown' }).click(),
      ])
      const exported = await readFile((await download.path())!, 'utf8')
      const strip = (text: string) => text.replace(/> 导出时间：.*\n/, '')
      expect(strip(copied[0])).toBe(strip(exported))
      expect(copied[0]).toContain('# 重试测试')
      expect(copied[0]).toContain('已生成狗')
    },
  )
}
