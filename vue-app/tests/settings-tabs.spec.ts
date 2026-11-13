import { test, expect, type Page } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'

const tabs = [
  'chat',
  'image',
  'proxy',
  'chat-policy',
  'images',
  'agent',
  'prompts',
  'habits',
  'display',
  'data',
]
async function open(page: Page, url: string) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto(url)
  await page.locator('#topbarSettings').click()
  await expect(page.locator('#settingsBackdrop')).toBeVisible()
  await expect(page.locator('#settingsBackdrop .security-callout')).toHaveCount(
    0,
  )
  await expect(page.locator('#settingsBackdrop')).not.toContainText(
    'Key、接口模板和润色模板默认只保存在当前浏览器',
  )
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 设置分模块保留草稿、取消、保存、模板与键盘和 tooltip`, async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await open(page, url)
    mkdirSync('.cache/screens', { recursive: true })
    await expect(
      page.getByRole('tablist', { name: '设置模块' }).getByRole('tab'),
    ).toHaveCount(tabs.length)
    await expect(
      page.getByRole('tablist', { name: '设置模块' }),
    ).toHaveAttribute('aria-orientation', 'vertical')
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
    await page.locator('#chatModel').fill('settings-chat-draft')
    await page.locator('#settings-tab-image').click()
    await page.locator('#imageModel').fill('settings-image-draft')
    await page.locator('#imageBaseUrl').fill('https://settings-image.test/v1')
    page.once('dialog', (dialog) => dialog.accept('设置分栏测试接口'))
    await page.locator('#saveImageProfile').click()
    await expect(page.locator('#imageProfileSelect option:checked')).toHaveText(
      '设置分栏测试接口',
    )
    for (const id of tabs) {
      await page.locator(`#settings-tab-${id}`).click()
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      await expect(page.locator(`#settings-panel-${id}`)).toBeVisible()
      await expect(page.locator(`#settings-tab-${id}`)).toHaveAttribute(
        'aria-selected',
        'true',
      )
      const button = await page.locator('#saveSettings').boundingBox()
      const modal = await page
        .locator('#settingsBackdrop > .settings-modal')
        .boundingBox()
      expect(button!.x).toBeGreaterThan(modal!.x + modal!.width / 2)
    }
    await page.locator('#settings-tab-proxy').click()
    await expect(page.locator('#proxyUrl')).toBeVisible()
    await page.locator('#settings-tab-images').click()
    await expect(page.locator('#compressRequestImages')).toBeAttached()
    await expect(page.locator('#imagePreventPromptRewrite')).toBeAttached()
    await page.locator('#settings-tab-agent').click()
    expect(
      await page
        .locator('#settings-panel-agent input, #settings-panel-agent textarea')
        .evaluateAll((elements) => elements.map((element) => element.id)),
    ).toEqual([
      'imageAgentInstruction',
      'imageAgentAutoParameters',
      'imageAgentPreview',
      'imageAgentRetryMismatch',
      'imageAgentRetryErrors',
      'imageAgentRetryLimit',
    ])
    await expect(page.locator('#settingsBackdrop')).not.toContainText(
      'DeepSeek 官方 Agent',
    )
    for (const row of await page
      .locator('#settings-panel-agent .toggle-row')
      .all()) {
      const box = await row.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(45)
    }
    await page.screenshot({
      path: `.cache/screens/settings-${version}-desktop-agent.png`,
      animations: 'disabled',
    })
    await page.locator('#settings-tab-prompts').click()
    const originalPrompt = await page.locator('#systemPrompt').inputValue()
    await page.locator('#systemPrompt').fill('settings-prompt-draft')
    await page.locator('#settings-tab-chat').click()
    await expect(page.locator('#chatModel')).toHaveValue('settings-chat-draft')
    await page.locator('#settings-tab-image').click()
    await expect(page.locator('#imageModel')).toHaveValue(
      'settings-image-draft',
    )
    await page.locator('#settings-tab-image').focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('#settings-tab-proxy')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.locator('#settings-tab-data')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.locator('#settings-tab-chat')).toBeFocused()
    await page.mouse.move(5, 5)
    await page.locator('#settings-tab-chat').hover()
    await expect(page.locator('.custom-tooltip.show')).toHaveCount(0)
    await page.mouse.move(5, 5)
    await page.locator('#settings-tab-chat').blur()
    await page.screenshot({
      path: `.cache/screens/settings-${version}-desktop.png`,
      animations: 'disabled',
    })
    await page.locator('#settings-tab-prompts').click()
    await page.locator('#cancelSettings').click()
    await page.locator('#topbarSettings').click()
    await expect(page.locator('#settings-tab-prompts')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator('#systemPrompt')).toHaveValue(originalPrompt)
    await page.locator('#systemPrompt').fill('settings-saved-prompt')
    await page.locator('#settings-tab-chat').click()
    await page.locator('#chatModel').fill('settings-saved-chat')
    await page.locator('#saveSettings').click()
    await page.reload()
    await page.locator('#topbarSettings').click()
    await expect(page.locator('#chatModel')).toHaveValue('settings-saved-chat')
    await page.locator('#settings-tab-prompts').click()
    await expect(page.locator('#systemPrompt')).toHaveValue(
      'settings-saved-prompt',
    )
    expect(errors).toEqual([])
  })
  test(`${version} 手机设置横向滚动导航、内容滚动和右侧保存始终可达`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open(page, url)
    await expect(
      page.getByRole('tablist', { name: '设置模块' }),
    ).toHaveAttribute('aria-orientation', 'horizontal')
    const nav = page.getByRole('tablist', { name: '设置模块' })
    expect(
      await nav.evaluate((el) => el.scrollWidth > el.clientWidth),
    ).toBeTruthy()
    await page.locator('#settings-tab-chat').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#settings-tab-image')).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.locator('#settings-tab-data')).toBeFocused()
    await expect(page.locator('#exportWorkspace')).toBeVisible()
    await page.keyboard.press('Home')
    await page.locator('#settings-tab-chat').blur()
    await page.mouse.move(1, 1)
    await page.screenshot({
      path: `.cache/screens/settings-${version}-mobile.png`,
      animations: 'disabled',
    })
    for (const id of tabs) {
      await page.locator(`#settings-tab-${id}`).click()
      await expect(page.getByRole('tabpanel')).toHaveCount(1)
      if (id === 'agent') {
        for (const row of await page
          .locator('#settings-panel-agent .toggle-row')
          .all()) {
          const box = await row.boundingBox()
          expect(box!.height).toBeGreaterThanOrEqual(45)
        }
        await page.screenshot({
          path: `.cache/screens/settings-${version}-mobile-agent.png`,
          animations: 'disabled',
        })
      }
      await page
        .locator('#settingsBackdrop .settings-scroll')
        .evaluate((el) => {
          el.scrollTop = el.scrollHeight
        })
      const box = await page.locator('#saveSettings').boundingBox()
      expect(box!.x).toBeGreaterThan(195)
      expect(box!.y + box!.height).toBeLessThanOrEqual(844)
      expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    }
    await page.screenshot({
      path: `.cache/screens/settings-${version}-mobile-data.png`,
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 568 })
    await expect
      .poll(async () => {
        const box = await page.locator('#saveSettings').boundingBox()
        return box!.y + box!.height
      })
      .toBeLessThanOrEqual(568)
    await page.locator('#cancelSettings').click()
    await expect(page.locator('#settingsBackdrop')).toBeHidden()
  })
}
