import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const api = 'https://responses.test/v1'
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII='
const sse = (events: object[]) =>
  events.map((event) => 'data: ' + JSON.stringify(event) + '\n\n').join('')

test.beforeEach(async ({ page }) => {
  const script = await readFile('node_modules/selecto/dist/selecto.min.js')
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) => route.fulfill({ body: script, contentType: 'text/javascript' }),
  )
})

async function open(page: Page, url: string, settings = {}) {
  await page.goto(url)
  await page.evaluate(
    ({ settings, api }) => {
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            demoMode: false,
            chatBaseUrl: api,
            chatApiKey: 'test',
            chatModel: 'resp-model',
            chatApiFormat: 'responses',
            chatStream: true,
            chatImageTools: false,
            systemPrompt: '系统提示',
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
              title: 'Responses',
              createdAt: 1,
              messages: [
                {
                  id: 'u0',
                  role: 'user',
                  content: '上一问',
                  imageIds: [],
                  createdAt: 1,
                },
                {
                  id: 'a0',
                  role: 'assistant',
                  content: '上一答',
                  imageIds: [],
                  createdAt: 2,
                },
              ],
            },
          ],
        }),
      )
    },
    { settings, api },
  )
  await page.reload()
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('#messageInput')).toBeVisible()
}

async function send(page: Page, text = '你好') {
  await page.locator('#messageInput').fill(text)
  await page.locator('#sendButton').click()
  await expect(page.locator('#sendButton')).toHaveAttribute('data-mode', 'send')
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' 接口格式默认 Chat Completions, 可选 Responses 并保存',
    async ({ page }) => {
      await page.goto(url)
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      await page.locator('#topbarSettings').click()
      const format = page.locator('#chatApiFormat')
      await expect(format).toHaveValue('chat')
      await expect(format.locator('option')).toHaveText([
        'Chat Completions',
        'Responses',
      ])
      await format.selectOption('responses', { force: true })
      await page.locator('#saveSettings').click()
      const saved = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('orbit-chat-state-v1')!).settings
            .chatApiFormat,
      )
      expect(saved).toBe('responses')
    },
  )

  test(
    version + ' Responses 流式: 思考、正文、来源和多轮历史',
    async ({ page }) => {
      const requests: { url: string; body: any }[] = []
      await page.route(api + '/**', (route) => {
        if (route.request().method() === 'GET')
          return route.fulfill({ json: { data: [] } })
        requests.push({
          url: route.request().url(),
          body: route.request().postDataJSON(),
        })
        return route.fulfill({
          contentType: 'text/event-stream',
          body: sse([
            { type: 'response.created', response: { output: [] } },
            { type: 'response.reasoning_summary_text.delta', delta: '先想' },
            { type: 'response.reasoning_summary_text.delta', delta: '一下' },
            { type: 'response.output_text.delta', delta: '结论' },
            {
              type: 'response.output_text.annotation.added',
              annotation: {
                type: 'url_citation',
                url: 'https://a.test/1',
                title: '甲',
              },
            },
            {
              type: 'response.completed',
              response: {
                output: [
                  {
                    type: 'message',
                    content: [
                      {
                        type: 'output_text',
                        text: '结论',
                        annotations: [
                          {
                            type: 'url_citation',
                            url: 'https://a.test/1',
                            title: '甲',
                          },
                          {
                            type: 'url_citation',
                            url: 'https://b.test/2',
                            title: '乙',
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          ]),
        })
      })
      await open(page, url, {
        chatWebSearch: true,
        chatWebSearchMode: 'web_search_options',
      })
      await send(page)
      expect(requests[0].url).toBe(api + '/responses')
      const body = requests[0].body
      expect(body.messages).toBeUndefined()
      expect(body.web_search_options).toBeUndefined()
      expect(body.instructions).toContain('系统提示')
      expect(body.input.map((item: any) => item.role)).toEqual([
        'user',
        'assistant',
        'user',
      ])
      expect(body.reasoning).toEqual({ effort: 'low', summary: 'auto' })
      expect(body.tools).toEqual([{ type: 'web_search' }])
      expect(body.stream).toBe(true)
      const reply = page.locator('.message.assistant').last()
      await expect(reply.locator('.message-text')).toContainText('结论')
      await expect(reply.locator('.message-reasoning-content')).toContainText(
        '先想一下',
      )
      await expect(reply.locator('.message-sources a')).toHaveText(['甲', '乙'])
    },
  )

  test(version + ' Responses 非流式与报错原样显示', async ({ page }) => {
    let count = 0
    await page.route(api + '/**', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: [] } })
      count++
      if (count === 2)
        return route.fulfill({
          status: 400,
          json: { error: { message: '上游拒绝 responses' } },
        })
      return route.fulfill({
        json: {
          output: [
            {
              type: 'reasoning',
              summary: [{ type: 'summary_text', text: '非流式思考' }],
            },
            {
              type: 'message',
              content: [
                { type: 'output_text', text: '非流式回答', annotations: [] },
              ],
            },
          ],
        },
      })
    })
    await open(page, url, { chatStream: false })
    await send(page)
    const reply = page.locator('.message.assistant').last()
    await expect(reply.locator('.message-text')).toContainText('非流式回答')
    await expect(reply.locator('.message-reasoning-content')).toContainText(
      '非流式思考',
    )
    await send(page, '再来')
    await expect(
      page.locator('.message.assistant').last().locator('.message-error'),
    ).toContainText('上游拒绝 responses')
    expect(count).toBe(2)
  })

  test(version + ' Responses Agent 生图工具轮次', async ({ page }) => {
    const bodies: any[] = []
    let images = 0
    await page.route(api + '/**', (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { data: [] } })
      const request = route.request()
      if (request.url().includes('/images/')) {
        images++
        return route.fulfill({ json: { data: [{ b64_json: png }] } })
      }
      const body = request.postDataJSON()
      bodies.push(body)
      if (bodies.length === 1)
        return route.fulfill({
          contentType: 'text/event-stream',
          body: sse([
            {
              type: 'response.output_item.added',
              output_index: 1,
              item: {
                type: 'function_call',
                call_id: 'call_1',
                name: 'generate_image',
                arguments: '',
              },
            },
            {
              type: 'response.function_call_arguments.delta',
              output_index: 1,
              delta: '{"prompt":"橘猫",',
            },
            {
              type: 'response.function_call_arguments.delta',
              output_index: 1,
              delta: '"reference_image_ids":[]}',
            },
            { type: 'response.completed', response: { output: [] } },
          ]),
        })
      return route.fulfill({
        contentType: 'text/event-stream',
        body: sse([
          { type: 'response.output_text.delta', delta: '图片已经完成' },
        ]),
      })
    })
    await open(page, url, { chatImageTools: true, imageAgentPreview: true })
    await send(page, '画一只橘猫')
    await expect(page.locator('.message.assistant').last()).toContainText(
      '图片已经完成',
    )
    expect(images).toBe(1)
    const tools = bodies[0].tools
    expect(tools[0]).toMatchObject({ type: 'function', name: 'generate_image' })
    expect(tools[0].function).toBeUndefined()
    expect(bodies[0].tool_choice).toBe('auto')
    const input = bodies[1].input
    const call = input.find((item: any) => item.type === 'function_call')
    expect(call).toMatchObject({ call_id: 'call_1', name: 'generate_image' })
    expect(JSON.parse(call.arguments).prompt).toBe('橘猫')
    const output = input.find(
      (item: any) => item.type === 'function_call_output',
    )
    expect(output.call_id).toBe('call_1')
    expect(typeof output.output).toBe('string')
    expect(
      input.some(
        (item: any) =>
          Array.isArray(item.content) &&
          item.content.some((part: any) => part.type === 'input_image'),
      ),
    ).toBe(true)
  })
}
