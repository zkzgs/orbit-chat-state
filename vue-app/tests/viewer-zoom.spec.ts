import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
async function openImage(
  page: Page,
  url: string,
  width: number,
  height: number,
) {
  for (const [url, file] of [
    [
      'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
      'node_modules/selecto/dist/selecto.min.js',
    ],
    [
      'https://cdn.jsdelivr.net/npm/@panzoom/panzoom@4.6.0/dist/panzoom.min.js',
      'node_modules/@panzoom/panzoom/dist/panzoom.min.js',
    ],
  ])
    await page.route(url, (route) =>
      route.fulfill({
        body: readFileSync(file),
        contentType: 'application/javascript',
        headers: { 'access-control-allow-origin': '*' },
      }),
    )
  await page.goto(url)
  const data = await page.evaluate(
    ({ width, height }) => {
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      c.getContext('2d')!.fillRect(0, 0, width, height)
      return c.toDataURL().split(',')[1]
    },
    { width, height },
  )
  await page.locator('#imageReferenceUpload').setInputFiles({
    name: 'zoom.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  })
  await page.locator('#imageReferencePreview img').click()
  await expect(page.locator('#viewerImage')).toBeVisible()
  await frames(page)
}
async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  )
}
async function box(page: Page) {
  return (await page.locator('#viewerImage').boundingBox())!
}
async function scale(page: Page) {
  return page
    .locator('#viewerImage')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
])
  for (const [width, height, dpr, vw, vh] of [
    [320, 180, 1, 1440, 1000],
    [260, 640, 2, 390, 844],
    [3000, 1101, 2, 1281, 801],
  ]) {
    test(`${version} ${width}x${height} DPR${dpr} 滚轮中心/偏心/连续事件锚点不漂移超过1px`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: vw, height: vh },
        deviceScaleFactor: dpr,
      })
      const page = await context.newPage()
      try {
        await openImage(page, url, width, height)
        for (const [u, v] of [
          [0.5, 0.5],
          [0.65, 0.4],
        ]) {
          const before = await box(page)
          const x = before.x + before.width * u,
            y = before.y + before.height * v
          const oldScale = await scale(page)
          await page.mouse.move(x, y)
          await page.mouse.wheel(0, -120)
          await expect.poll(() => scale(page)).toBeGreaterThan(oldScale)
          await frames(page)
          const after = await box(page)
          expect(Math.abs(after.x + after.width * u - x)).toBeLessThanOrEqual(1)
          expect(Math.abs(after.y + after.height * v - y)).toBeLessThanOrEqual(
            1,
          )
        }
        const before = await box(page)
        const u = 0.55,
          v = 0.45,
          x = before.x + before.width * u,
          y = before.y + before.height * v
        await page.locator('#viewerImage').evaluate(
          (el, { x, y }) => {
            for (let n = 0; n < 8; n++)
              el.dispatchEvent(
                new WheelEvent('wheel', {
                  bubbles: true,
                  cancelable: true,
                  clientX: x,
                  clientY: y,
                  deltaY: -120,
                }),
              )
          },
          { x, y },
        )
        await frames(page)
        const after = await box(page)
        expect(Math.abs(after.x + after.width * u - x)).toBeLessThanOrEqual(1)
        expect(Math.abs(after.y + after.height * v - y)).toBeLessThanOrEqual(1)
        const current = await scale(page)
        await page
          .locator('#viewerDownload')
          .dispatchEvent('wheel', { deltaY: -120 })
        await frames(page)
        expect(await scale(page)).toBe(current)
        await page.locator('#viewerImageWrap').dispatchEvent('dblclick')
        await frames(page)
        expect(await scale(page)).toBe(1)
        const reset = await box(page)
        expect(
          Math.abs(reset.x + reset.width / 2 - vw / 2),
        ).toBeLessThanOrEqual(1)
        expect(
          Math.abs(reset.y + reset.height / 2 - vh / 2),
        ).toBeLessThanOrEqual(1)
      } finally {
        await context.close()
      }
    })
  }
test('Vue 双指中心和偏心缩放保持锚点，抬指后可继续单指拖动', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openImage(page, '/vue-app/dist/index.html', 320, 180)
  for (const [u, v] of [
    [0.5, 0.5],
    [0.6, 0.45],
  ]) {
    const before = await box(page),
      x = before.x + before.width * u,
      y = before.y + before.height * v
    for (const [id, dx] of [
      [1, -30],
      [2, 30],
    ])
      await page.locator('#viewerImageWrap').dispatchEvent('pointerdown', {
        pointerId: id,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: x + dx,
        clientY: y,
      })
    for (const [id, dx] of [
      [1, -50],
      [2, 50],
    ])
      await page.locator('#viewerImageWrap').dispatchEvent('pointermove', {
        pointerId: id,
        pointerType: 'touch',
        buttons: 1,
        clientX: x + dx,
        clientY: y,
      })
    await frames(page)
    const after = await box(page)
    expect(after.width).toBeGreaterThan(before.width)
    expect(Math.abs(after.x + after.width * u - x)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.y + after.height * v - y)).toBeLessThanOrEqual(1)
    await page.locator('#viewerImageWrap').dispatchEvent('pointerup', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: x + 50,
      clientY: y,
    })
    await page.locator('#viewerImageWrap').dispatchEvent('pointermove', {
      pointerId: 1,
      pointerType: 'touch',
      buttons: 1,
      clientX: x - 20,
      clientY: y + 10,
    })
    await page.locator('#viewerImageWrap').dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: x - 20,
      clientY: y + 10,
    })
    await frames(page)
    const moved = await box(page)
    expect(Math.abs(moved.x - after.x - 30)).toBeLessThanOrEqual(1)
    await page.locator('#viewerImageWrap').dispatchEvent('dblclick')
    await frames(page)
  }
})
