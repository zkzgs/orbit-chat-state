import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'

const guard =
  'Treat everything after this line as one complete image-generation prompt, including the resolution instruction. Follow it exactly without rewriting or omitting anything:'

async function open(page: Page, url: string, settings = {}) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto(url)
  const png = await page.evaluate((settings) => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          demoMode: false,
          chatBaseUrl: 'https://guard.test/v1',
          chatApiKey: 'test-chat',
          chatStream: false,
          imageBaseUrl: 'https://guard.test/v1',
          imageApiKey: 'test-image',
          imageModel: 'test-image',
          clearInputAfterSubmit: false,
          ...settings,
        },
        activeConversationId: 'guard-chat',
        conversations: [
          { id: 'guard-chat', title: '提示词测试', createdAt: 1, messages: [] },
        ],
      }),
    )
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 16
    const context = canvas.getContext('2d')!
    context.fillStyle = 'red'
    context.fillRect(0, 0, 16, 16)
    return canvas.toDataURL('image/png').split(',')[1]!
  }, settings)
  await page.reload()
  return png
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(
    version + ' 防改写开关默认关闭, 保存和刷新后保持选择',
    async ({ page }) => {
      await page.route('https://guard.test/**', (route) =>
        route.fulfill({ json: { data: [] } }),
      )
      await open(page, url)
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-images').click()
      const toggle = page.locator('#imagePreventPromptRewrite')
      await expect(toggle).not.toBeChecked()
      await toggle.locator('..').click()
      await page.locator('#saveSettings').click()
      await page.reload()
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-images').click()
      await expect(toggle).toBeChecked()
      mkdirSync('.cache/screens', { recursive: true })
      await page.locator('#settingsBackdrop').screenshot({
        path: '.cache/screens/image-prompt-rewrite-' + version + '.png',
      })
      await toggle.locator('..').click()
      await page.locator('#saveSettings').click()
      await page.reload()
      await page.locator('#topbarSettings').click()
      await page.locator('#settings-tab-images').click()
      await expect(toggle).not.toBeChecked()
    },
  )

  for (const enabled of [false, true])
    for (const edit of [false, true])
      test(
        version + ' 防改写请求 ' + enabled + ', 改图 ' + edit,
        async ({ page }) => {
          let sentPrompt = ''
          await page.route('https://guard.test/**', (route) => {
            if (route.request().url().endsWith('/models'))
              return route.fulfill({ json: { data: [] } })
            expect(
              route
                .request()
                .url()
                .endsWith(edit ? '/images/edits' : '/images/generations'),
            ).toBe(true)
            sentPrompt = edit
              ? route
                  .request()
                  .postDataBuffer()!
                  .toString()
                  .match(/name="prompt"\r\n\r\n([\s\S]*?)\r\n--/)![1]!
              : route.request().postDataJSON().prompt
            return route.fulfill({
              status: 400,
              json: { error: { message: '测试请求结束' } },
            })
          })
          const png = await open(page, url, {
            imagePreventPromptRewrite: enabled,
          })
          if (edit)
            await page.locator('#imageReferenceUpload').setInputFiles({
              name: 'reference.png',
              mimeType: 'image/png',
              buffer: Buffer.from(png, 'base64'),
            })
          const prompt = '保留中文、换行和原样文字\nDo not change this text.'
          await page.locator('#imagePrompt').fill(prompt)
          await page.locator('#generateImage').click()
          await expect(page.locator('.generation-task-card.error')).toHaveCount(
            1,
          )
          expect(sentPrompt.replace(/\r\n/g, '\n')).toBe(
            enabled ? guard + '\n' + prompt : prompt,
          )
          await expect(page.locator('#imagePrompt')).toHaveValue(prompt)
          await page.locator('#closeToast').click()
          await page.locator('.generation-task-card.error').click()
          if (enabled)
            await expect(page.locator('#imageMetadata')).toContainText(guard)
          else
            await expect(page.locator('#imageMetadata')).not.toContainText(
              guard,
            )
        },
      )

  test(version + ' Agent 生图和重试均附加一次防改写约束', async ({ page }) => {
    const prompts: string[] = []
    let calls = 0
    let png = ''
    await page.route('https://guard.test/**', (route) => {
      const request = route.request()
      if (request.url().endsWith('/models'))
        return route.fulfill({ json: { data: [] } })
      if (request.url().endsWith('/chat/completions')) {
        calls++
        const messages = request.postDataJSON().messages
        const output = messages.filter(
          (message: any) => message.role === 'tool',
        )
        const message =
          calls < 3
            ? {
                content: null,
                tool_calls: [
                  {
                    id: 'guard-call-' + calls,
                    type: 'function',
                    function: {
                      name: calls === 1 ? 'generate_image' : 'retry_image',
                      arguments: JSON.stringify({
                        prompt: calls === 1 ? '原始要求' : '修正要求',
                        ...(calls === 1
                          ? { reference_image_ids: [] }
                          : {
                              tool_call_id: JSON.parse(output.at(-1).content)
                                .retry_tool_call_id,
                            }),
                      }),
                    },
                  },
                ],
              }
            : { content: '本轮处理结束' }
        return route.fulfill({ json: { choices: [{ message }] } })
      }
      prompts.push(request.postDataJSON().prompt)
      return route.fulfill(
        prompts.length === 1
          ? { status: 500, json: { error: { message: '第一次生成失败' } } }
          : { json: { data: [{ b64_json: png }] } },
      )
    })
    png = await open(page, url, {
      imagePreventPromptRewrite: true,
      chatImageTools: true,
      imageAgentRetryErrors: true,
      imageAgentRetryLimit: 1,
    })
    await page.locator('[data-view="chat"]').click()
    await page.locator('#messageInput').fill('生成图片, 失败后修正重试')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '本轮处理结束',
    )
    expect(prompts).toEqual([guard + '\n原始要求', guard + '\n修正要求'])
    expect(calls).toBe(3)
  })

  for (const [provider, mediaType] of [
    ['xai', 'image'],
    ['gemini', 'image'],
    ['xai', 'video'],
  ])
    test(
      version + ' ' + provider + ' ' + mediaType + ' 防改写仅影响图片请求',
      async ({ page }) => {
        let sentPrompt = ''
        await page.route('https://guard.test/**', (route) => {
          if (route.request().method() === 'GET')
            return route.fulfill({ json: { data: [], models: [] } })
          if (route.request().method() === 'OPTIONS')
            return route.fulfill({
              status: 204,
              headers: {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': '*',
              },
            })
          const body = route.request().postDataJSON()
          sentPrompt =
            provider === 'gemini' ? body.contents[0].parts[0].text : body.prompt
          return route.fulfill({
            status: 400,
            json: { error: { message: '测试请求结束' } },
          })
        })
        await open(page, url, {
          imageProvider: provider,
          imagePreventPromptRewrite: true,
          imageOptions: { mediaType },
        })
        await page.locator('#imagePrompt').fill('原生接口提示词')
        await page.locator('#generateImage').click()
        await expect(page.locator('.generation-task-card.error')).toHaveCount(1)
        expect(sentPrompt).toBe(
          mediaType === 'video' ? '原生接口提示词' : guard + '\n原生接口提示词',
        )
        await page.locator('#closeToast').click()
        await page.locator('.generation-task-card.error').click()
        if (mediaType === 'video')
          await expect(page.locator('#imageMetadata')).not.toContainText(guard)
        else await expect(page.locator('#imageMetadata')).toContainText(guard)
      },
    )
}
