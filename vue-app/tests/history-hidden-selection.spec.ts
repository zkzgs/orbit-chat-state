import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

async function seed(page: Page) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (route) =>
      route.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
        headers: { 'access-control-allow-origin': '*' },
      }),
  )
  await page.goto('/vue-app/dist/index.html')
  await page.evaluate(async () => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({ settings: { demoMode: true } }),
    )
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        { id: 'secret', name: '私密收藏', isDefault: true },
        { id: 'other', name: '普通收藏', isDefault: false },
      ]),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('orbit-chat-images-v1', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('generations', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('generations', 'readwrite')
      const store = tx.objectStore('generations')
      store.clear()
      const config = { model: 'test', count: 1, size: '1024x1024' }
      for (const [n, ids] of [
        ['mixed', ['a', 'b', 'c']],
        ['only-hidden', ['d']],
        ['plain1', ['e']],
        ['plain2', ['f']],
      ] as [string, string[]][]) {
        ids.forEach((id) =>
          store.put({
            id,
            type: 'image',
            src:
              'data:image/svg+xml,' +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="teal"/><text>${id}</text></svg>`,
              ),
            prompt: n,
            createdAt: 1000,
            config,
            favoriteFolderIds: ['a', 'c', 'd'].includes(id)
              ? ['secret', 'other']
              : [],
          }),
        )
        store.put({
          id: n,
          type: 'generation-batch',
          batchId: n,
          taskId: `task-${n}`,
          imageIds: ids,
          imageCount: ids.length,
          prompt: n,
          config,
          createdAt: 1000,
          startedAt: 1000,
          durationMs: 100,
        })
        store.put({
          id: `task-${n}`,
          type: 'generation-task',
          status: 'success',
          batchId: n,
          prompt: n,
          config,
          startedAt: 1000,
          finishedAt: 1100,
          referenceImageIds: [],
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version}: folder hiding persists, filters mixed groups and viewer, and restores`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(4)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    await folder.getByRole('checkbox', { name: '隐藏图片' }).check()
    await folder.locator('.favorite-folder-open').click()
    await expect(cards).toHaveCount(3)
    await page.locator('[data-history-library="history"]').click()
    await expect(cards).toHaveCount(3)
    await expect(page.locator('#imageHistoryTitle .history-count')).toHaveText(
      '3',
    )
    await expect(
      page.locator(
        '#imageHistory img[data-image-id="a"], #imageHistory img[data-image-id="c"], #imageHistory img[data-image-id="d"]',
      ),
    ).toHaveCount(0)
    await expect(page.locator('#imageHistoryTitle')).toContainText('生成记录')
    const mixed = cards.filter({ hasText: 'mixed' })
    await expect(mixed).toHaveCount(1)
    await expect(mixed).toContainText('数量 1')
    await mixed.locator('.history-image-button').click()
    await expect(
      page.locator('#lightboxThumbnails .lightbox-thumb'),
    ).toHaveCount(1)
    await page.keyboard.press('Escape')
    await page.reload()
    await expect(cards).toHaveCount(3)
    await page.locator('[data-history-library="favorites"]').click()
    await expect(
      folder.getByRole('checkbox', { name: '隐藏图片' }),
    ).toBeChecked()
    await folder.getByRole('checkbox', { name: '隐藏图片' }).uncheck()
    await page.locator('[data-history-library="history"]').click()
    await expect(cards).toHaveCount(4)
    await page.locator('[data-history-view="single"]').click()
    await expect(cards).toHaveCount(6)
    await cards.first().locator('[data-history-action="favorite"]').click()
    const row = page
      .locator('.favorite-folder-row')
      .filter({ hasText: '私密收藏' })
    const membership = row.getByRole('checkbox', { name: '收藏到 私密收藏' })
    const before = await membership.isChecked()
    await row.getByRole('checkbox', { name: '隐藏图片' }).check()
    await expect(membership).toBeChecked({ checked: before })
    await page.locator('#cancelFavoriteFolderDialog').click()
    await expect(cards).toHaveCount(3)
    await page.locator('[data-history-library="favorites"]').click()
    await expect(
      folder.getByRole('checkbox', { name: '隐藏图片' }),
    ).toBeChecked()
  })

  test(`${version}: hidden flags survive export, overwrite and merge imports`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(4)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    await folder.getByRole('checkbox', { name: '隐藏图片' }).check()
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const pending = page.waitForEvent('download')
    await page.locator('[data-data-scope="image"]').click()
    const download = await pending
    const payload = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(
      payload.favoriteFolders.find((item: any) => item.id === 'secret').hidden,
    ).toBe(true)
    expect(payload.images).toHaveLength(6)
    let mode = '覆盖'
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? mode : undefined),
    )
    async function importPayload() {
      await page.locator('#settings-tab-data').click()
      await page.locator('#workspaceImportFile').setInputFiles({
        name: 'hidden.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(payload)),
      })
      await expect(page.locator('#toast')).toContainText(mode + '导入')
      const folders = await page.evaluate(() =>
        JSON.parse(
          localStorage.getItem('orbit-image-favorite-folders-v1') || '[]',
        ),
      )
      expect(folders.find((item: any) => item.id === 'secret').hidden).toBe(
        true,
      )
    }
    await importPayload()
    mode = '合并'
    await importPayload()
    // Merging a legacy visible copy must not accidentally reveal a hidden folder.
    delete payload.favoriteFolders.find((item: any) => item.id === 'secret')
      .hidden
    await importPayload()
  })

  test(`${version}: cancel favorite removes an image group from every folder and closes dialog`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(4)
    const mixed = cards.filter({ hasText: 'mixed' })
    await mixed.locator('[data-history-action="favorite"]').click()
    const remove = page.locator('#removeFavoriteFolderChoices')
    await expect(remove).toBeVisible()
    await remove.click()
    await expect(page.locator('#favoriteFolderBackdrop')).toBeHidden()
    await mixed.locator('[data-history-action="favorite"]').click()
    await expect(remove).toBeHidden()
    await page.locator('#cancelFavoriteFolderDialog').click()
    await page.locator('[data-history-library="favorites"]').click()
    for (const name of ['私密收藏', '普通收藏']) {
      const folder = page
        .locator('.favorite-folder-card')
        .filter({ hasText: name })
      await expect(folder).toContainText('1 张图片')
    }
    await page.reload()
    await expect(cards).toHaveCount(4)
    await cards
      .filter({ hasText: 'mixed' })
      .locator('[data-history-action="favorite"]')
      .click()
    await expect(remove).toBeHidden()
  })

  test(`${version}: cancel favorite on a hidden image restores it to main history`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(4)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    await folder.getByRole('checkbox', { name: '隐藏图片' }).check()
    await folder.locator('.favorite-folder-open').click()
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(3)
    await cards
      .filter({ hasText: 'mixed' })
      .first()
      .locator('[data-history-action="favorite"]')
      .click()
    await page.locator('#removeFavoriteFolderChoices').click()
    await expect(page.locator('#favoriteFolderBackdrop')).toBeHidden()
    await expect(cards).toHaveCount(2)
    await page.locator('[data-history-library="history"]').click()
    await expect(page.locator('#imageHistoryTitle')).toContainText('生成记录')
    await expect(cards.filter({ hasText: 'mixed' })).toHaveCount(1)
    await expect(cards.filter({ hasText: 'mixed' })).toContainText('数量 2')
  })

  test(`${version}: folder covers follow automatic, explicit and none rules`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(4)
    await expect(
      page.getByRole('button', { name: '设为封面', exact: true }),
    ).toHaveCount(0)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    const cover = folder.locator('.favorite-folder-cover')
    await expect(cover).toHaveAttribute('data-cover-image-id', 'a')
    await folder.getByRole('checkbox', { name: '隐藏图片' }).check()
    await expect(cover).toHaveCount(0)
    await folder.locator('.favorite-folder-open').click()
    await expect(cards).toHaveCount(3)
    const second = cards.filter({ hasText: 'mixed' }).nth(1)
    await second.hover()
    await second.getByRole('button', { name: '设为封面', exact: true }).click()
    await expect(second.getByRole('button', { name: '取消封面' })).toBeVisible()
    await page.locator('#favoriteFolderBack').click()
    await expect(cover).toHaveAttribute('data-cover-image-id', 'c')
    await page.reload()
    await page.locator('[data-history-library="favorites"]').click()
    await expect(cover).toHaveAttribute('data-cover-image-id', 'c')
    await folder.locator('.favorite-folder-open').click()
    await cards
      .filter({ hasText: 'mixed' })
      .nth(1)
      .getByRole('button', { name: '取消封面' })
      .click()
    await page.locator('#favoriteFolderBack').click()
    await expect(cover).toHaveCount(0)
    await folder.getByRole('checkbox', { name: '隐藏图片' }).uncheck()
    await expect(cover).toHaveCount(0)
    await page.reload()
    await page.locator('[data-history-library="favorites"]').click()
    await expect(cover).toHaveCount(0)
    await folder.locator('.favorite-folder-open').click()
    const onlyHidden = cards.filter({ hasText: 'only-hidden' })
    await onlyHidden.hover()
    await onlyHidden
      .getByRole('button', { name: '设为封面', exact: true })
      .click()
    await onlyHidden.locator('[data-history-action="favorite"]').click()
    await page.locator('#removeFavoriteFolderChoices').click()
    await expect(cards).toHaveCount(2)
    await page.locator('#favoriteFolderBack').click()
    await expect(cover).toHaveAttribute('data-cover-image-id', 'a')
    const saved = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('orbit-image-favorite-folders-v1') || '[]',
      ),
    )
    expect(saved.find((item: any) => item.id === 'secret')).not.toHaveProperty(
      'coverImageId',
    )
  })

  test(`${version}: cover export/import preserves none and remaps explicit image IDs on merge`, async ({
    page,
  }) => {
    await seed(page)
    await page.evaluate(() => {
      const folders = JSON.parse(
        localStorage.getItem('orbit-image-favorite-folders-v1') || '[]',
      )
      folders[0].coverImageId = 'c'
      folders[0].hidden = true
      folders[1].coverImageId = null
      localStorage.setItem(
        'orbit-image-favorite-folders-v1',
        JSON.stringify(folders),
      )
    })
    await page.goto(url)
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(3)
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const pending = page.waitForEvent('download')
    await page.locator('[data-data-scope="image"]').click()
    const download = await pending
    const payload = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(payload.favoriteFolders[0].coverImageId).toBe('c')
    expect(payload.favoriteFolders[1].coverImageId).toBeNull()
    let mode = '覆盖'
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? mode : undefined),
    )
    async function importPayload() {
      await page.locator('#settings-tab-data').click()
      await page.locator('#workspaceImportFile').setInputFiles({
        name: 'covers.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(payload)),
      })
      await expect(page.locator('#toast')).toContainText(mode + '导入')
    }
    await importPayload()
    let folders = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('orbit-image-favorite-folders-v1') || '[]',
      ),
    )
    expect(folders[0].coverImageId).toBe('c')
    expect(folders[1].coverImageId).toBeNull()
    mode = '合并'
    payload.images.find((image: any) => image.id === 'c').src +=
      encodeURIComponent('<!--new-image-->')
    await importPayload()
    folders = await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('orbit-image-favorite-folders-v1') || '[]',
      ),
    )
    expect(folders[0].coverImageId).not.toBe('c')
    expect(typeof folders[0].coverImageId).toBe('string')
    expect(folders[1].coverImageId).toBeNull()
  })

  test(`${version}: deleting an explicit cover falls back to the first remaining folder image`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(4)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    await folder.locator('.favorite-folder-open').click()
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(3)
    const target = cards.filter({ hasText: 'only-hidden' })
    await target.hover()
    await target.getByRole('button', { name: '设为封面', exact: true }).click()
    await expect(target.getByRole('button', { name: '取消封面' })).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await target.locator('[data-history-action="delete"]').click()
    await expect(cards).toHaveCount(2)
    await page.locator('#favoriteFolderBack').click()
    await expect(folder.locator('.favorite-folder-cover')).toHaveAttribute(
      'data-cover-image-id',
      'a',
    )
    await page.reload()
    await page.locator('[data-history-library="favorites"]').click()
    await expect(folder.locator('.favorite-folder-cover')).toHaveAttribute(
      'data-cover-image-id',
      'a',
    )
  })

  test(`${version}: cover actions and hidden toggles fit a mobile folder card`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)
    await page.goto(url)
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(4)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    await expect(folder.locator('.favorite-folder-cover')).toBeVisible()
    await folder.locator('.favorite-folder-open').click()
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(3)
    const button = cards
      .nth(1)
      .getByRole('button', { name: '设为封面', exact: true })
    await expect(button).toBeVisible()
    const cardRect = await cards.nth(1).boundingBox()
    const buttonRect = await button.boundingBox()
    expect(buttonRect!.width).toBeGreaterThanOrEqual(56)
    expect(buttonRect!.x + buttonRect!.width).toBeLessThanOrEqual(
      cardRect!.x + cardRect!.width,
    )
    await button.click()
    await expect(
      cards.nth(1).getByRole('button', { name: '取消封面' }),
    ).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
  })

  test(`${version}: favorite UI alignment tooltips entry points and cover hover screenshots`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(4)
    const mixed = cards.filter({ hasText: 'mixed' })
    await mixed.locator('[data-history-action="favorite"]').hover()
    await expect(page.locator('.custom-tooltip.show')).toHaveText(
      '收藏到文件夹',
    )
    await mixed.locator('[data-history-action="favorite"]').click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeVisible()
    const save = page.locator('#saveFavoriteFolderChoices')
    const footer = page.locator('.favorite-dialog .modal-footer')
    let saveRect = await save.boundingBox()
    let footerRect = await footer.boundingBox()
    expect(saveRect!.x + saveRect!.width).toBeGreaterThan(
      footerRect!.x + footerRect!.width - 40,
    )
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-favorite-popup.png`,
    })
    await page.locator('#cancelFavoriteFolderDialog').click()
    // Unfavorited popup must keep Save on the right even with the left action hidden.
    await cards
      .filter({ hasText: 'plain1' })
      .locator('[data-history-action="favorite"]')
      .click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeHidden()
    saveRect = await save.boundingBox()
    footerRect = await footer.boundingBox()
    expect(saveRect!.x + saveRect!.width).toBeGreaterThan(
      footerRect!.x + footerRect!.width - 40,
    )
    await page.locator('#cancelFavoriteFolderDialog').click()
    await page.locator('[data-history-library="favorites"]').click()
    await page.locator('#newFavoriteFolder').click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeHidden()
    saveRect = await save.boundingBox()
    footerRect = await footer.boundingBox()
    expect(saveRect!.x + saveRect!.width).toBeGreaterThan(
      footerRect!.x + footerRect!.width - 40,
    )
    await page.locator('#cancelFavoriteFolderDialog').click()
    await page.locator('[data-history-library="history"]').click()
    await mixed.locator('.history-image-button').click()
    await page.locator('#lightboxFavorite').click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeVisible()
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-details-favorite-popup.png`,
    })
    await page.keyboard.press('Escape')
    await expect(page.locator('#imageLightbox')).toBeVisible()
    await page.locator('#lightboxImage').click()
    await page.locator('#viewerFavorite').click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('#chatImageViewer')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.locator('[data-history-library="favorites"]').click()
    await page.addStyleTag({
      content:
        '#imageHistory { grid-template-columns: repeat(auto-fill,250px) !important; }',
    })
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    async function expectOneLine() {
      const boxes = await folder
        .locator('.favorite-folder-actions')
        .evaluate((row) =>
          Array.from(row.children).map((child) => {
            const r = child.getBoundingClientRect()
            return { y: r.y + r.height / 2, right: r.right }
          }),
        )
      expect(
        Math.max(...boxes.map((b) => b.y)) - Math.min(...boxes.map((b) => b.y)),
      ).toBeLessThan(3)
      expect(Math.max(...boxes.map((b) => b.right))).toBeLessThanOrEqual(
        (await folder.boundingBox())!.x + (await folder.boundingBox())!.width,
      )
    }
    await expectOneLine()
    await folder.getByRole('button', { name: '删除收藏夹' }).hover()
    await expect(page.locator('.custom-tooltip.show')).toHaveText('删除收藏夹')
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-folder-cards.png`,
    })
    await folder.locator('.favorite-folder-open').click()
    await expect(cards).toHaveCount(3)
    const cover = cards.first().locator('.favorite-cover-button')
    const nonCover = cards.nth(1).locator('.favorite-cover-button')
    await page.locator('#imageHistoryTitle').hover()
    await expect(cover).toHaveClass(/is-auto-cover/)
    await expect(cover.locator('.cover-label-idle')).toHaveText('封面')
    await expect(cover).toHaveCSS('opacity', '1')
    await expect(nonCover).toHaveCSS('opacity', '0')
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-folder-images-idle.png`,
    })
    await cards.nth(1).hover()
    await expect(nonCover).toHaveCSS('opacity', '1')
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-folder-images-hover.png`,
    })
    await nonCover.click()
    await page.locator('#imageHistoryTitle').hover()
    await expect(nonCover).toHaveClass(/is-cover/)
    await expect(nonCover).not.toHaveClass(/is-auto-cover/)
    await expect(nonCover.locator('.cover-label-idle')).toHaveText('封面')
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-folder-explicit-cover.png`,
    })
    await nonCover.hover()
    await expect(nonCover.locator('.cover-label-hover')).toBeVisible()
    await expect(nonCover.locator('.cover-label-hover')).toHaveText('取消封面')
    await page.setViewportSize({ width: 390, height: 844 })
    // Remove the screenshot-only 250px grid override for the real mobile layout.
    await page.addStyleTag({
      content:
        '#imageHistory { grid-template-columns: repeat(2,minmax(0,1fr)) !important; }',
    })
    await page.locator('#favoriteFolderBack').click()
    await expectOneLine()
    await page.screenshot({
      animations: 'disabled',
      path: `/workspace/screens/${version}-folder-cards-mobile.png`,
    })
  })

  test(`${version}: already-favorited task popup offers cancel favorite too`, async ({
    page,
  }) => {
    await seed(page)
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('orbit-chat-images-v1', 1)
        req.onsuccess = () => resolve(req.result)
      })
      await new Promise<void>((resolve) => {
        const tx = db.transaction('generations', 'readwrite')
        tx.objectStore('generations').put({
          id: 'failed-favorite',
          type: 'generation-task',
          status: 'error',
          prompt: 'failed favorite',
          config: {},
          favoriteFolderIds: ['secret'],
          startedAt: 3000,
          finishedAt: 4000,
        })
        tx.oncomplete = () => resolve()
      })
      db.close()
    })
    await page.goto(url)
    await page
      .locator(
        '[data-task-id="failed-favorite"] [data-generation-action="favorite-task"]',
      )
      .click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeVisible()
    await page.locator('#removeFavoriteFolderChoices').click()
    await expect(page.locator('#favoriteFolderBackdrop')).toBeHidden()
    await page.reload()
    await page
      .locator(
        '[data-task-id="failed-favorite"] [data-generation-action="favorite-task"]',
      )
      .click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeHidden()
  })

  test(`${version}: numeric legacy image IDs still show and persist cancel favorite`, async ({
    page,
  }) => {
    await seed(page)
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('orbit-chat-images-v1', 1)
        req.onsuccess = () => resolve(req.result)
      })
      await new Promise<void>((resolve) => {
        const tx = db.transaction('generations', 'readwrite')
        const store = tx.objectStore('generations')
        const readImage = store.get('a')
        readImage.onsuccess = () => {
          store.delete('a')
          store.put({ ...readImage.result, id: 101 })
        }
        const readBatch = store.get('mixed')
        readBatch.onsuccess = () =>
          store.put({ ...readBatch.result, imageIds: [101, 'b', 'c'] })
        tx.oncomplete = () => resolve()
      })
      db.close()
    })
    await page.goto(url)
    const mixed = page
      .locator('#imageHistory .history-item')
      .filter({ hasText: 'mixed' })
    await expect(mixed).toHaveCount(1)
    await mixed.locator('.history-image-button').click()
    await page.locator('#lightboxFavorite').click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeVisible()
    await page.locator('#removeFavoriteFolderChoices').click()
    await expect(page.locator('#favoriteFolderBackdrop')).toBeHidden()
    await page.locator('#lightboxFavorite').click()
    await expect(page.locator('#removeFavoriteFolderChoices')).toBeHidden()
  })

  test(`${version}: bulk deletion affects visible images only, preserving hidden favorites`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    await expect(page.locator('#imageHistory .history-item')).toHaveCount(4)
    await page.locator('[data-history-library="favorites"]').click()
    const folder = page
      .locator('.favorite-folder-card')
      .filter({ hasText: '私密收藏' })
    await folder.getByRole('checkbox', { name: '隐藏图片' }).check()
    await page.locator('[data-history-library="history"]').click()
    const cards = page.locator('#imageHistory .history-item')
    await expect(page.locator('#imageHistoryTitle')).toContainText('生成记录')
    await expect(cards.filter({ hasText: 'mixed' })).toHaveCount(1)
    await expect(cards).toHaveCount(3)
    await cards.first().hover()
    await cards.first().locator('.history-select').check()
    await page.locator('#historySelectAll').click()
    await expect(page.locator('#imageHistory .selected')).toHaveCount(3)
    page.once('dialog', (dialog) => dialog.accept())
    await page.locator('#historyDeleteSelected').click()
    await expect(cards).toHaveCount(0)
    await page.locator('[data-history-library="favorites"]').click()
    await folder.locator('.favorite-folder-open').click()
    await expect(cards).toHaveCount(3)
    await page.reload()
    await expect(cards).toHaveCount(0)
    await page.locator('[data-history-library="favorites"]').click()
    await folder.getByRole('checkbox', { name: '隐藏图片' }).uncheck()
    await page.locator('[data-history-library="history"]').click()
    await expect(cards).toHaveCount(2)
  })

  test(`${version}: dragging from a thumbnail selects cards without opening viewer`, async ({
    page,
  }) => {
    await seed(page)
    await page.goto(url)
    const cards = page.locator('#imageHistory .history-item')
    await expect(cards).toHaveCount(4)
    await expect(page.locator('.selecto-selection')).toHaveCount(1)
    const first = await cards
      .first()
      .locator('.history-image-button')
      .boundingBox()
    const second = await cards
      .nth(1)
      .locator('.history-image-button')
      .boundingBox()
    if (!first || !second) throw new Error('Missing thumbnail rectangles')
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 4)
    await page.mouse.down()
    await page.mouse.move(
      second.x + second.width / 2,
      second.y + (second.height * 3) / 4,
      { steps: 15 },
    )
    await expect(page.locator('#imageHistory .selected')).toHaveCount(2)
    await page.mouse.up()
    await expect(page.locator('#imageHistory .selected')).toHaveCount(2)
    await expect(page.locator('#imageLightbox')).toBeHidden()
    await expect(page.locator('#historySelectionBar')).toBeVisible()
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 4)
    await page.mouse.down()
    await page.mouse.move(
      second.x + second.width / 2,
      second.y + (second.height * 3) / 4,
      { steps: 15 },
    )
    await page.mouse.up()
    await expect(page.locator('#imageHistory .selected')).toHaveCount(0)
    await cards.first().hover()
    await cards.first().locator('.history-select').check()
    await page.locator('.history-heading').click({ position: { x: 8, y: 8 } })
    await expect(page.locator('#imageHistory .selected')).toHaveCount(1)
    await page.locator('#imagePrompt').click()
    await expect(page.locator('#imageHistory .selected')).toHaveCount(0)
    await expect(page.locator('#historySelectionBar')).toBeHidden()
  })
}
