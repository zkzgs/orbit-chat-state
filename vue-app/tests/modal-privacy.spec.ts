import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

async function seed(page: Page, url: string, theme: string) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (theme) => {
    const state = {
      settings: {
        theme,
        demoMode: false,
          chatImageTools: true,
        imagePrivacyEnabled: true,
        imagePrivacyMode: 'single',
      },
      activeConversationId: 'a',
      conversations: [
        {
          id: 'a',
          title: '弹窗与隐私遮罩',
          createdAt: 1,
          messages: [
            {
              id: 'u',
              role: 'user',
              content: '背景对话内容',
              imageIds: ['img'],
              createdAt: 1,
            },
            {
              id: 'a',
              role: 'assistant',
              content: '这些文字不应显示在弹窗前面。'.repeat(8),
              imageIds: [],
              createdAt: 2,
            },
          ],
        },
      ],
    }
    const canvas = document.createElement('canvas')
    canvas.width = 600
    canvas.height = 400
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#eebb22'
    ctx.fillRect(0, 0, 600, 400)
    ctx.fillStyle = '#2244cc'
    ctx.fillRect(100, 100, 400, 200)
    const db = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open('orbit-chat-images-v1')
      request.onupgradeneeded = () =>
        request.result.createObjectStore('generations', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('generations', 'readwrite')
      tx.objectStore('generations').put({
        id: 'img',
        type: 'image',
        src: canvas.toDataURL(),
        createdAt: 1,
      })
      tx.objectStore('generations').put({
        id: 'batch',
        batchId: 'batch',
        type: 'generation-batch',
        prompt: '生图记录',
        imageIds: ['img'],
        referenceImageIds: [],
        config: {
          model: 'test',
          format: 'png',
          count: 1,
          sizeMode: 'auto',
          quality: 'auto',
        },
        imageCount: 1,
        createdAt: 1,
        startedAt: 1,
        completedAt: 1,
        durationMs: 0,
      })
      tx.oncomplete = () => resolve()
    })
    db.close()
    localStorage.setItem('orbit-chat-state-v1', JSON.stringify(state))
    history.replaceState(null, '', '#/chat?c=a')
  }, theme)
}

async function openAndInspect(
  page: Page,
  trigger: string,
  backdrop: string,
  hovered: string,
) {
  const image = page.locator(hovered)
  await image.hover()
  const point = await image.boundingBox()
  // 用实际点击打开, 随即移回原图片位置, 覆盖两种滤镜同时过渡的时机。
  await page.locator(trigger).click()
  await page.mouse.move(point!.x + 8, point!.y + 8)
  const samples = await page.locator(backdrop).evaluate(async (el) => {
    const panel = el.querySelector('.settings-modal, .lightbox-panel')!
    const states = []
    for (let i = 0; i < 15; i++) {
      const b = panel.getBoundingClientRect()
      states.push({
        overlay: getComputedStyle(el).opacity,
        panel: getComputedStyle(panel).opacity,
        background: getComputedStyle(panel).backgroundColor,
        intercepts: [
          [b.x + 10, b.y + 10],
          [b.x + b.width / 2, b.y + b.height / 2],
          [20, 130],
        ].every(([x, y]) => el.contains(document.elementFromPoint(x!, y!))),
      })
      await new Promise(requestAnimationFrame)
    }
    return {
      states,
      active: el.getAnimations().length + panel.getAnimations().length,
      transform: getComputedStyle(panel).transform,
    }
  })
  expect(
    samples.states.every(
      (s) => s.overlay === '1' && s.panel === '1' && s.intercepts,
    ),
  ).toBe(true)
  expect(samples.states.every((s) => /^rgb\(/.test(s.background))).toBe(true)
  expect(samples.transform).toBe('none')
  expect(samples.active).toBe(0)
}

for (const [version, host, file] of [
  ['HTML', '/index.html', pathToFileURL(path.resolve('../index.html')).href],
  [
    'Vue',
    '/vue-app/dist/index.html',
    pathToFileURL(path.resolve('dist/index.html')).href,
  ],
])
  for (const [transport, url] of [
    ['服务', host],
    ['文件', file],
  ])
    for (const theme of ['light', 'dark']) {
      test(`${version} ${transport} ${theme} 每次刷新后前三次弹窗保持不透明且拦截背景操作`, async ({
        page,
      }) => {
        await seed(page, url, theme)
        for (let cold = 0; cold < 2; cold++) {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await expect(page.locator('.message-image')).toBeVisible()
          for (let first = 0; first < 3; first++) {
            await openAndInspect(
              page,
              '#agentImageSettings',
              '#agentImageSettingsBackdrop',
              '.message-image',
            )
            await page.locator('#cancelAgentImageSettings').click()
          }
          await openAndInspect(
            page,
            '#topbarSettings',
            '#settingsBackdrop',
            '.message-image',
          )
          await page.locator('#settings-tab-chat-policy').click()
          expect(
            await page
              .locator('#imageAgentPreview')
              .evaluate((el) =>
                el
                  .closest('label')!
                  .nextElementSibling!.contains(
                    document.querySelector('#imageAgentRetryMismatch'),
                  ),
              ),
          ).toBe(true)
          await page.locator('#cancelSettings').click()
        }
        await page.locator('[data-view="image"]').click()
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('.history-item.success').waitFor()
        await page.locator('#topbarSettings').click()
        await page.locator('#settings-tab-display').click()
        await page
          .locator('#imagePrivacyMode')
          .selectOption('list', { force: true })
        await page.locator('#saveSettings').click()
        await openAndInspect(
          page,
          '#topbarSettings',
          '#settingsBackdrop',
          '#imageHistory',
        )
        await page.locator('#cancelSettings').click()
        await openAndInspect(
          page,
          '.history-image-button',
          '#imageLightbox',
          '#imageHistory',
        )
        await expect(page.locator('#imageLightbox')).toHaveCSS(
          'background-color',
          theme === 'light'
            ? 'rgba(255, 255, 255, 0.72)'
            : 'rgba(2, 7, 13, 0.84)',
        )
        await page.keyboard.press('Escape')
        await expect(page.locator('#imageLightbox')).toBeHidden()
      })
    }
