import { test, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const versions = [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]
const savedState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('orbit-chat-state-v1')!))
async function seed(page: Page, url: string) {
  await page.goto(url)
  await page.evaluate(async () => {
    const profile = (kind: string, id: string) => ({
      id,
      name: `站点/分组/${id}`,
      baseUrl: 'https://old.example/v1',
      apiKey: 'fake-old',
      model: `${kind}-old`,
      models: [`${kind}-old`],
      createdAt: 1,
      updatedAt: 1,
    })
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          demoMode: false,
          chatBaseUrl: 'https://old.example/v1',
          chatApiKey: 'fake-old',
          chatModel: 'chat-old',
          imageBaseUrl: 'https://old.example/v1',
          imageApiKey: 'fake-old',
          imageModel: 'image-old',
        },
        connectionProfiles: {
          chat: [profile('chat', 'chat'), profile('chat', 'other-chat')],
          image: [profile('image', 'image'), profile('image', 'other-image')],
        },
        activeConnectionProfiles: { chat: 'chat', image: 'image' },
        conversations: [
          {
            id: 'readable',
            title: '可读性与模板回归',
            createdAt: 1,
            messages: [
              {
                id: 'assistant',
                role: 'assistant',
                imageIds: [],
                content:
                  '这是主要对话的正文内容。Readable chat body and a longer line for mobile wrapping.',
                reasoning:
                  '这是小一档的思考内容。Thinking details remain readable.',
                createdAt: 1,
              },
            ],
          },
        ],
        activeConversationId: 'readable',
      }),
    )
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        { id: 'folder', name: '可读的收藏夹名称', isDefault: true },
      ]),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('orbit-chat-images-v1')
      r.onupgradeneeded = () =>
        r.result.createObjectStore('generations', { keyPath: 'id' })
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('generations', 'readwrite'),
        store = tx.objectStore('generations')
      store.clear()
      store.put({
        id: 'image',
        type: 'image',
        src:
          'data:image/svg+xml,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="teal"/></svg>',
          ),
        favoriteFolderIds: ['folder'],
        createdAt: 1,
      })
      store.put({
        id: 'batch',
        batchId: 'batch',
        type: 'generation-batch',
        imageIds: ['image'],
        referenceImageIds: [],
        imageCount: 1,
        prompt: '生成记录中的长标题与提示词可读性检查',
        config: { model: 'image-old', count: 1 },
        createdAt: 1,
        startedAt: 1,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload()
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message-text')).toContainText('主要对话')
}
async function open(page: Page, kind = 'chat') {
  await page.locator('#topbarSettings').click()
  await page.locator(`#settings-tab-${kind}`).click()
}
async function assertNoOldModels(page: Page, kind: string) {
  await page.locator(`#${kind}Model`).focus()
  await expect(page.locator('.model-dropdown:visible')).not.toContainText(
    `${kind}-old`,
  )
  await page.locator('#settingsTitle').click()
}
for (const [version, url] of versions) {
  for (const kind of ['chat', 'image']) {
    test(`${version}: ${kind} edited credentials keep template identity without silently updating saved fields`, async ({
      page,
    }) => {
      await seed(page, url)
      await open(page, kind)
      await page.locator(`#${kind}ApiKey`).fill('fake-new')
      await expect(page.locator(`#${kind}ProfileSelect`)).toHaveValue(kind)
      await expect(
        page.locator(`#update${kind === 'chat' ? 'Chat' : 'Image'}Profile`),
      ).toBeEnabled()
      await expect(page.locator(`#${kind}Model`)).toHaveValue('')
      await assertNoOldModels(page, kind)
      await page.locator('#saveSettings').click()
      await page.reload()
      await open(page, kind)
      await expect(page.locator(`#${kind}ProfileSelect`)).toHaveValue(kind)
      await expect(page.locator(`#${kind}ApiKey`)).toHaveValue('fake-new')
      await assertNoOldModels(page, kind)
      const s = await savedState(page)
      expect(s.connectionProfiles[kind][0].apiKey).toBe('fake-old')
      expect(s.connectionProfiles[kind][0].models).toEqual([`${kind}-old`])
      // Explicitly selecting a saved template restores its saved connection, not the unsaved edit.
      await page
        .locator(`#${kind}ProfileSelect`)
        .selectOption(`other-${kind}`, { force: true })
      await page
        .locator(`#${kind}ProfileSelect`)
        .selectOption(kind, { force: true })
      await expect(page.locator(`#${kind}ApiKey`)).toHaveValue('fake-old')
      await expect(page.locator(`#${kind}Model`)).toHaveValue(`${kind}-old`)
    })
    for (const fetchModels of [false, true]) {
      test(`${version}: ${kind} edit and update retains same ID, fresh cache, switch and reload (fetch=${fetchModels})`, async ({
        page,
      }) => {
        let requests = 0
        await page.route('https://new.example/**', (route) => {
          requests++
          return route.fulfill({ json: { data: [{ id: 'fresh-model' }] } })
        })
        await seed(page, url)
        await open(page, kind)
        await page.locator(`#${kind}BaseUrl`).fill('https://new.example/v1')
        await page.locator(`#${kind}ApiKey`).fill('fake-new')
        await expect(page.locator(`#${kind}ProfileSelect`)).toHaveValue(kind)
        await expect(page.locator(`#${kind}Model`)).toHaveValue('')
        await assertNoOldModels(page, kind)
        if (fetchModels) {
          await page.locator(`#${kind}Model`).focus()
          await page.locator('.model-dropdown:visible .model-refresh').click()
          await expect(page.locator('.model-dropdown:visible')).toContainText(
            'fresh-model',
          )
          await page.locator('#settingsTitle').click()
          // Fetching for edited credentials must not poison the still-saved old template.
          expect(
            (await savedState(page)).connectionProfiles[kind][0].models,
          ).toEqual([`${kind}-old`])
        }
        await page.locator(`#${kind}Model`).fill('manual-new')
        await page
          .locator(`#update${kind === 'chat' ? 'Chat' : 'Image'}Profile`)
          .click()
        await expect
          .poll(
            async () =>
              (await savedState(page)).connectionProfiles[kind][0].apiKey,
          )
          .toBe('fake-new')
        const updated = (await savedState(page)).connectionProfiles[kind][0]
        expect(updated).toMatchObject({
          id: kind,
          name: `站点/分组/${kind}`,
          baseUrl: 'https://new.example/v1',
          apiKey: 'fake-new',
          model: 'manual-new',
          models: fetchModels ? ['fresh-model'] : [],
          createdAt: 1,
        })
        await page
          .locator(`#${kind}ProfileSelect`)
          .selectOption(`other-${kind}`, { force: true })
        await expect(page.locator(`#${kind}Model`)).toHaveValue(`${kind}-old`)
        await page
          .locator(`#${kind}ProfileSelect`)
          .selectOption(kind, { force: true })
        await expect(page.locator(`#${kind}Model`)).toHaveValue('manual-new')
        await page.locator('#saveSettings').click()
        await page.reload()
        await open(page, kind)
        await expect(page.locator(`#${kind}ProfileSelect`)).toHaveValue(kind)
        await expect(page.locator(`#${kind}Model`)).toHaveValue('manual-new')
        await page.locator(`#${kind}Model`).fill('')
        await assertNoOldModels(page, kind)
        expect(requests).toBe(fetchModels ? 1 : 0)
      })
    }
  }
  for (const width of [1440, 420, 360]) {
    test(`${version}: readable fonts and centered scope cards at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 960 })
      await seed(page, url)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await expect(page.locator('.topbar')).toHaveCSS(
        'height',
        width > 780 ? '60px' : '52px',
      )
      const thinking = page.locator('.message-reasoning')
      await thinking.locator('summary').click()
      await expect(page.locator('.message-text')).toHaveCSS('font-size', '15px')
      await expect(thinking.locator('.message-reasoning-content')).toHaveCSS(
        'font-size',
        '13px',
      )
      await mkdir('/workspace/screens/orbit-compact/after', { recursive: true })
      const shot = (name: string) =>
        page.screenshot({
          path: `/workspace/screens/orbit-compact/after/${version.toLowerCase()}-${width}-${name}.png`,
        })
      await expect
        .poll(() =>
          page
            .locator('.app-shell')
            .evaluate((el) => el.scrollWidth - el.clientWidth),
        )
        .toBeLessThanOrEqual(1)
      const bounds = await page.locator('.message-text').boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      await shot('chat')
      await expect(page.locator('.message-role')).toHaveCSS('font-size', '12px')
      await expect(page.locator('.message-time')).toHaveCSS('font-size', '10px')
      await expect(page.locator('#messageInput')).toHaveCSS('font-size', '15px')
      await expect(page.locator('#messageInputMirror')).toHaveCSS(
        'font-size',
        '15px',
      )
      await open(page)
      await expect(page.locator('#chatBaseUrl')).toHaveCSS('font-size', '13px')
      await expect(
        page.locator('#settings-panel-chat .field-help').first(),
      ).toHaveCSS('font-size', '11px')
      for (const tab of [
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
      ]) {
        await page.locator(`#settings-tab-${tab}`).click()
        const overflow = await page
          .locator('#settingsBackdrop .settings-scroll')
          .evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(
          overflow,
          `${tab} settings horizontal overflow`,
        ).toBeLessThanOrEqual(1)
      }
      await page.locator('#settings-tab-chat').click()
      await shot('settings')
      const host = page.locator('#chatProfileSelect').locator('..')
      await host.locator('.custom-select-trigger').click()
      await shot('templates')
      await page.locator('#settingsTitle').click()
      await page.locator('#settings-tab-data').click()
      for (const [button, selected] of [
        ['exportWorkspace', 3],
        ['resetLocalData', 0],
      ] as const) {
        await page.locator(`#${button}`).click()
        await expect(
          page.locator('.data-scope-option input:checked'),
        ).toHaveCount(selected)
        const centers = await page
          .locator('.data-scope-option')
          .evaluateAll((cards) =>
            cards.map((card) => {
              const box = card.getBoundingClientRect(),
                input = card.querySelector('input')!.getBoundingClientRect()
              const node = Array.from(card.childNodes).find(
                (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim(),
              )!
              const range = document.createRange()
              range.selectNodeContents(node)
              const text = range.getBoundingClientRect()
              return {
                dx: Math.abs(
                  (input.left + text.right) / 2 - (box.left + box.right) / 2,
                ),
                dy: Math.abs(
                  (input.top + input.bottom) / 2 - (box.top + box.bottom) / 2,
                ),
                textDy: Math.abs(
                  (text.top + text.bottom) / 2 - (box.top + box.bottom) / 2,
                ),
              }
            }),
          )
        for (const center of centers) {
          expect(center.dx).toBeLessThan(2)
          expect(center.dy).toBeLessThan(2)
          expect(center.textDy).toBeLessThan(2)
        }
        await shot(button)
        await page.locator('#cancelDataScope').click()
      }
      await page.locator('#closeSettings').click()
      await page.locator('[data-view="image"]').click()
      await expect(page.locator('#imageHistory .history-select')).toHaveCount(1)
      await page.locator('#imageHistory').scrollIntoViewIfNeeded()
      await shot('history')
      await page.locator('[data-history-library="favorites"]').click()
      await expect(page.locator('.favorite-folder-name')).toContainText(
        '可读的收藏夹名称',
      )
      await shot('favorites')
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1)
      expect(errors).toEqual([])
    })
  }
  for (const theme of ['dark', 'light']) {
    for (const [view, id] of [
      ['chat', 'messageInput'],
      ['image', 'imagePrompt'],
    ]) {
      test(`${version}: native focused selection stays legible without mirror double-paint (${theme}/${view})`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1000, height: 800 })
        await seed(page, url)
        await page.evaluate((t) => {
          const s = JSON.parse(localStorage.getItem('orbit-chat-state-v1')!)
          s.settings.theme = t
          localStorage.setItem('orbit-chat-state-v1', JSON.stringify(s))
        }, theme)
        await page.reload()
        await page.locator(`[data-view="${view}"]`).click()
        const input = page.locator(`#${id}`),
          wrap = input.locator('..'),
          mirror = wrap.locator('.image-prompt-mirror')
        await input.fill('单独选择输入框 Text selection 清晰可读 @图1')
        await input.evaluate((el: HTMLTextAreaElement) => {
          el.focus()
          el.setSelectionRange(2, el.value.length - 2)
        })
        await expect(wrap).toHaveClass(/has-text-selection/)
        await expect(mirror).toHaveCSS('visibility', 'hidden')
        const selection = await input.evaluate((el) => {
          const style = getComputedStyle(el, '::selection')
          return {
            color: style.color,
            fill: style.webkitTextFillColor,
            shadow: style.textShadow,
          }
        })
        expect(selection).toEqual({
          color: 'rgb(255, 255, 255)',
          fill: 'rgb(255, 255, 255)',
          shadow: 'none',
        })
        await mkdir('/workspace/screens/orbit-selection', { recursive: true })
        const shot = (state: string) =>
          page.screenshot({
            path: `/workspace/screens/orbit-selection/after-${version.toLowerCase()}-${theme}-${view}-${state}.png`,
          })
        await shot('focused')
        await input.press('ArrowRight')
        await expect(wrap).not.toHaveClass(/has-text-selection/)
        await expect(mirror).toHaveCSS('visibility', 'visible')
        await expect(input).toHaveCSS(
          '-webkit-text-fill-color',
          'rgba(0, 0, 0, 0)',
        )
        await input.evaluate((el: HTMLTextAreaElement) => {
          el.setSelectionRange(0, el.value.length)
        })
        await expect(wrap).toHaveClass(/has-text-selection/)
        await input.evaluate((el) => el.blur())
        await expect(wrap).not.toHaveClass(/has-text-selection/)
        await expect(mirror).toHaveCSS('visibility', 'visible')
        await shot('blurred')
        // Page-text selection is left to the browser; the normal mirror remains visible.
        await mirror.evaluate((el) => {
          const range = document.createRange()
          const anchor =
            el.previousElementSibling?.id === 'messageInput'
              ? document.querySelector('.message-text')!
              : document.querySelector('.panel-label-row')!
          range.setStartBefore(anchor)
          range.setEndAfter(el)
          const selection = window.getSelection()!
          selection.removeAllRanges()
          selection.addRange(range)
        })
        expect(await page.evaluate(() => getSelection()!.toString())).toContain(
          '单独选择输入框',
        )
        await expect(mirror).toHaveCSS('visibility', 'visible')
        await shot('page')
      })
    }
  }
}
