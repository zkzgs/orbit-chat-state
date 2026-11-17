import { test, expect, type Page } from '@playwright/test'

const api = 'https://search.test/v1'
const citation = (url: string, title: string) => ({
  type: 'url_citation',
  url_citation: { url, title, start_index: 0, end_index: 1 },
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
            chatModel: 'search-model',
            chatStream: false,
            chatWebSearch: true,
            chatImageTools: false,
            ...settings,
          },
          activeConversationId: 'a',
          conversations: [
            { id: 'a', title: '联网', createdAt: 1, messages: [] },
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

async function send(page: Page, text = '查一下') {
  await page.locator('#messageInput').fill(text)
  await page.locator('#sendButton').click()
  await expect(page.locator('#sendButton')).toHaveAttribute('data-mode', 'send')
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' 联网方式只发送所选字段, 关闭联网不发送',
    async ({ page }) => {
      const bodies: any[] = []
      await page.route(api + '/chat/completions', (route) => {
        bodies.push(route.request().postDataJSON())
        return route.fulfill({
          json: { choices: [{ message: { content: '好的' } }] },
        })
      })
      await open(page, url)
      const mode = page.locator('#chatWebSearchMode')
      await expect(mode).toHaveValue('web_search_options')
      await expect(mode).toBeEnabled()
      await send(page)
      await mode.selectOption('web_search', { force: true })
      await send(page)
      await mode.selectOption('deepseek', { force: true })
      await send(page)
      await page.locator('#chatWebSearch').uncheck()
      await expect(mode).toBeDisabled()
      await send(page)
      expect(bodies[0].web_search_options).toEqual({})
      expect(bodies[0].tools).toBeUndefined()
      expect(bodies[1].web_search_options).toBeUndefined()
      expect(bodies[1].tools).toEqual([{ type: 'web_search' }])
      expect(bodies[2].tools).toEqual([
        { type: 'deepseek_web_search' },
        { type: 'deepseek_read_url' },
      ])
      expect(bodies[2].web_search_options).toBeUndefined()
      expect(bodies[3].tools).toBeUndefined()
      expect(bodies[3].web_search_options).toBeUndefined()
      await page.reload()
      await page.locator('[data-view="chat"]').click()
      await expect(page.locator('#chatWebSearchMode')).toHaveValue('deepseek')
    },
  )

  test(version + ' Agent 生图时联网工具并入 tools', async ({ page }) => {
    const bodies: any[] = []
    await page.route(api + '/chat/completions', (route) => {
      bodies.push(route.request().postDataJSON())
      return route.fulfill({
        json: {
          choices: [
            {
              message: {
                content: '答复',
                annotations: [citation('https://a.test/1', '甲')],
              },
            },
          ],
        },
      })
    })
    await open(page, url, {
      chatImageTools: true,
      chatWebSearchMode: 'deepseek',
      imageBaseUrl: api,
      imageApiKey: 'test',
    })
    await send(page)
    const tools = bodies[0].tools.map((tool: any) => tool.type)
    expect(tools[0]).toBe('function')
    expect(tools.slice(-2)).toEqual([
      'deepseek_web_search',
      'deepseek_read_url',
    ])
    expect(bodies[0].tool_choice).toBe('auto')
    expect(bodies[0].web_search_options).toBeUndefined()
    await expect(
      page.locator('.message.assistant .message-sources a'),
    ).toHaveText(['甲'])
  })

  test(version + ' 联网报错原样显示, 不关闭联网也不重发', async ({ page }) => {
    let count = 0
    await page.route(api + '/chat/completions', (route) => {
      count++
      return route.fulfill({
        status: 422,
        json: { error: { message: '上游不支持 web_search' } },
      })
    })
    await open(page, url, { chatWebSearchMode: 'web_search' })
    await send(page)
    await expect(
      page.locator('.message.assistant .message-error'),
    ).toContainText('上游不支持 web_search')
    expect(count).toBe(1)
    await expect(page.locator('#chatWebSearch')).toBeChecked()
    await expect(page.locator('body')).not.toContainText('已关闭联网')
  })

  for (const stream of [false, true]) {
    test(
      version + ' 来源去重显示并在刷新后保留 ' + stream,
      async ({ page }) => {
        await page.route(api + '/chat/completions', (route) => {
          const annotations = [
            citation('https://a.test/1', '甲'),
            citation('https://b.test/2', '乙'),
            citation('https://a.test/1', '甲'),
          ]
          if (!stream)
            return route.fulfill({
              json: {
                choices: [{ message: { content: '结论', annotations } }],
              },
            })
          const chunks = [
            { choices: [{ delta: { reasoning_content: '想' } }] },
            {
              choices: [
                {
                  delta: {
                    content: '',
                    annotations: annotations.slice(0, 2),
                    server_tool_calls: [
                      {
                        index: 0,
                        reasoning_content: '想',
                        calls: [
                          {
                            id: 's1',
                            type: 'deepseek_web_search',
                            sources: [],
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
            {
              choices: [
                {
                  delta: { content: '结论', annotations: annotations.slice(2) },
                },
              ],
            },
          ]
          return route.fulfill({
            contentType: 'text/event-stream',
            body:
              chunks
                .map((chunk) => 'data: ' + JSON.stringify(chunk) + '\n\n')
                .join('') + 'data: [DONE]\n\n',
          })
        })
        await open(page, url, {
          chatStream: stream,
          chatWebSearchMode: 'deepseek',
        })
        await send(page)
        const links = page.locator('.message.assistant .message-sources a')
        await expect(links).toHaveText(['甲', '乙'])
        await expect(links.first()).toHaveAttribute('href', 'https://a.test/1')
        await expect(
          page.locator('.message.assistant .message-text'),
        ).toContainText('结论')
        await page.reload()
        await page.locator('[data-view="chat"]').click()
        await expect(
          page.locator('.message.assistant .message-sources a'),
        ).toHaveText(['甲', '乙'])
      },
    )
  }
}
