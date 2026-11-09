import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'

const note =
  '注：润色参考图不会出现在最终生成参数内，请勿在提示词中提及润色参考图，或使用“参考图中的…”、“as in the reference”等依赖润色参考图的表述；应将其中需要的视觉信息（主体、风格、构图、色彩等）直接用文字描述出来。此限制不影响会传入最终生图的生成参考图。'
const customSystem = '用户自定义系统提示：请按模板要求输出完整提示词。'
const customInstruction = '用户自定义模板要求：细致描述风格。'
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 润色参考图说明仅在请求时追加，模板不变且不误传到最终生图`, async ({
    page,
  }) => {
    const requests: any[] = []
    await page.route(
      'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
      (route) =>
        route.fulfill({
          body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
          contentType: 'application/javascript',
        }),
    )
    await page.route('https://polish.test/v1/**', (route) => {
      if (route.request().url().endsWith('/models'))
        return route.fulfill({ json: { data: [] } })
      requests.push(route.request().postDataJSON())
      return route.fulfill({
        json: {
          choices: [{ message: { content: `润色结果 ${requests.length}` } }],
        },
      })
    })
    await page.addInitScript(
      ({ customSystem }) => {
        if (!localStorage.getItem('orbit-chat-state-v1'))
          localStorage.setItem(
            'orbit-chat-state-v1',
            JSON.stringify({
              settings: {
                demoMode: false,
                chatBaseUrl: 'https://polish.test/v1',
                chatApiKey: 'mock-key',
                imagePolishSystemPrompt: customSystem,
              },
            }),
          )
      },
      { customSystem },
    )
    await page.goto(url)
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 16
      c.height = 16
      c.getContext('2d')!.fillRect(0, 0, 16, 16)
      return c.toDataURL().split(',')[1]
    })
    const file = {
      name: 'ref.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    }
    await page.locator('#imagePrompt').fill('描述一幅画')
    await page.locator('#polishImagePrompt').click()
    await page.locator('#polishInstruction').fill(customInstruction)
    await page.locator('#generatePolishResult').click()
    await expect(page.locator('#polishResult')).toHaveValue('润色结果 1')
    expect(requests[0].messages[0].content).toBe(customSystem)
    await page.locator('#polishGenerationReferenceUpload').setInputFiles(file)
    await page.locator('#polishUseGenerationReferences').check()
    await page.locator('#generatePolishResult').click()
    await expect(page.locator('#polishResult')).toHaveValue('润色结果 2')
    expect(requests[1].messages[0].content).toBe(customSystem)
    await page.locator('#polishReferenceUpload').setInputFiles(file)
    page.once('dialog', (dialog) => dialog.accept('保持原模板'))
    await page.locator('#savePolishTemplate').click()
    await page.locator('#generatePolishResult').click()
    await expect(page.locator('#polishResult')).toHaveValue('润色结果 3')
    expect(requests[2].messages[0].content).toBe(`${customSystem}\n\n${note}`)
    expect(
      requests[2].messages[1].content.filter(
        (part: any) => part.type === 'image_url',
      ),
    ).toHaveLength(2)
    await expect(page.locator('#polishInstruction')).toHaveValue(
      customInstruction,
    )
    const settings = await page.evaluate(
      () => JSON.parse(localStorage.getItem('orbit-chat-state-v1')!).settings,
    )
    expect(settings.imagePolishSystemPrompt).toBe(customSystem)
    expect(
      settings.imagePolishTemplates.find(
        (item: any) => item.name === '保持原模板',
      ).instruction,
    ).toBe(customInstruction)
    expect(JSON.stringify(settings)).not.toContain(note)
    await page.locator('#applyPolishResult').click()
    await expect(
      page.locator('#imageReferencePreview .reference-preview-item'),
    ).toHaveCount(1)
    await page.locator('#polishImagePrompt').click()
    await page.locator('#generatePolishResult').click()
    await expect(page.locator('#polishResult')).toHaveValue('润色结果 4')
    expect(requests[3].messages[0].content.split(note)).toHaveLength(2)
  })
}
