import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { readBackup } from './helpers/backup'
import { chooseDataScope } from './helpers/data-scope'

const versions = [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]
const scopes = [
  'chat',
  'image',
  'config',
  'workspace',
  'chat-config',
  'image-config',
  'all',
]
const keys = (scope: string) =>
  scope === 'all'
    ? ['chat', 'image', 'config']
    : scope === 'workspace'
      ? ['chat', 'image']
      : scope.split('-')
async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('orbit-chat-images-v1')
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    const result = await new Promise<any[]>((resolve, reject) => {
      const r = db
        .transaction('generations')
        .objectStore('generations')
        .getAll()
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => reject(r.error)
    })
    db.close()
    return result
  })
}
async function state(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-chat-state-v1')!),
  )
}
async function seed(page: Page, url: string) {
  await page.goto(url)
  await page.evaluate(async () => {
    const profile = (kind: string, id: string, name: string) => ({
      id,
      name,
      baseUrl: 'https://old.example/v1',
      apiKey: 'test-old',
      model: `${kind}-old`,
      models: [`${kind}-old`, `${kind}-extra`],
      createdAt: 1,
      updatedAt: 1,
    })
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          demoMode: false,
          chatBaseUrl: 'https://old.example/v1',
          chatApiKey: 'test-old',
          chatModel: 'chat-old',
          imageBaseUrl: 'https://old.example/v1',
          imageApiKey: 'test-old',
          imageModel: 'image-old',
          imagePromptTemplates: [
            {
              id: 'prompt',
              name: '站点/提示/旧模板',
              prompt: 'old',
              referenceImageIds: ['t'],
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        },
        connectionProfiles: {
          chat: [
            profile('chat', 'old', '站点/分组/旧模板'),
            {
              ...profile('chat', 'new', '站点/其他/新模板'),
              model: 'chat-new',
              apiKey: 'test-new',
              models: ['chat-new'],
            },
            profile('chat', 'plain', '普通模板'),
          ],
          image: [profile('image', 'image', '站点/生图/模板')],
        },
        activeConnectionProfiles: { chat: 'old', image: 'image' },
        conversations: [
          {
            id: 'chat',
            title: 'keep chat',
            createdAt: 1,
            messages: [
              {
                id: 'msg',
                role: 'user',
                content: 'old message',
                imageIds: ['x', 'a'],
                createdAt: 1,
              },
            ],
          },
        ],
        activeConversationId: 'chat',
        contextMode: 'client',
      }),
    )
    localStorage.setItem(
      'orbit-image-favorite-folders-v1',
      JSON.stringify([
        { id: 'c', name: '目标收藏夹', isDefault: true },
        { id: 'other', name: '其他收藏夹' },
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
      for (const id of ['x', 'a', 'b', 'z', 't'])
        store.put({
          id,
          type: 'image',
          src:
            'data:image/svg+xml,' +
            encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><text>${id}</text></svg>`,
            ),
          createdAt: 1,
          favoriteFolderIds:
            id === 'a'
              ? ['c', 'other']
              : ['b', 'z'].includes(id)
                ? ['other']
                : [],
        })
      for (const id of ['a', 'b'])
        store.put({
          id: `batch-${id}`,
          batchId: `batch-${id}`,
          type: 'generation-batch',
          imageIds: [id],
          referenceImageIds: [],
          imageCount: 1,
          prompt: id,
          config: { model: 'image-old', count: 1 },
          createdAt: 1,
          startedAt: 1,
        })
      store.put({
        id: 'failed',
        type: 'generation-task',
        status: 'error',
        prompt: 'failed task',
        config: { model: 'image-old', count: 1 },
        referenceImageIds: [],
        favoriteFolderIds: ['other'],
        startedAt: 1,
        finishedAt: 2,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload()
  await expect(page.locator('#imageHistory .history-select')).toHaveCount(3)
}
async function settings(page: Page, tab: string) {
  await page.locator('#topbarSettings').click()
  await page.locator(`#settings-tab-${tab}`).click()
}
async function template(page: Page, id: string, value: string) {
  await page.locator(`#${id}`).selectOption(value, { force: true })
}

for (const [version, url] of versions) {
  test(`${version}: API edits clear models without fetching; templates preserve model and list`, async ({
    page,
  }) => {
    let requests = 0
    await page.route('https://old.example/**', (route) => {
      requests++
      return route.fulfill({ json: { data: [{ id: 'fetched' }] } })
    })
    await seed(page, url)
    await settings(page, 'chat')
    for (const kind of ['chat', 'image']) {
      await page.locator(`#settings-tab-${kind}`).click()
      for (const field of ['BaseUrl', 'ApiKey']) {
        await template(
          page,
          `${kind}ProfileSelect`,
          kind === 'chat' ? 'old' : 'image',
        )
        const input = page.locator(`#${kind}${field}`),
          original = await input.inputValue()
        await input.fill(original)
        await expect(page.locator(`#${kind}Model`)).toHaveValue(`${kind}-old`)
        await input.fill(original + 'changed')
        await expect(page.locator(`#${kind}ProfileSelect`)).toHaveValue(
          kind === 'chat' ? 'old' : 'image',
        )
        await expect(page.locator(`#${kind}Model`)).toHaveValue('')
        await page.locator(`#${kind}Model`).focus()
        await expect(
          page
            .locator('.model-dropdown:visible .model-option')
            .filter({ hasText: `${kind}-old` }),
        ).toHaveCount(0)
        await page.locator('#settingsTitle').click()
      }
    }
    const overwrite = async (dialog: import('@playwright/test').Dialog) => {
      await dialog.accept(
        dialog.type() === 'prompt' ? '站点/生图/模板' : undefined,
      )
    }
    page.on('dialog', overwrite)
    await page.locator('#imageModel').fill('image-replacement')
    await page.locator('#saveImageProfile').click()
    page.off('dialog', overwrite)
    await page.locator('#imageModel').focus()
    await expect(page.locator('.model-dropdown:visible')).not.toContainText(
      'image-old',
    )
    await page.locator('#settingsTitle').click()
    expect(requests).toBe(0)
    await page.locator('#settings-tab-chat').click()
    await template(page, 'chatProfileSelect', 'new')
    await expect(page.locator('#chatModel')).toHaveValue('chat-new')
    await page.locator('#chatModel').focus()
    await expect(page.locator('.model-dropdown:visible')).toContainText(
      'chat-new',
    )
    await page.locator('#settingsTitle').click()
    await page.locator('#saveSettings').click()
    await page.reload()
    await settings(page, 'chat')
    await expect(page.locator('#chatModel')).toHaveValue('chat-new')
  })
  test(`${version}: late model-list response cannot restore a changed connection cache`, async ({
    page,
  }) => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    await page.route('https://old.example/v1/models', async (route) => {
      await gate
      await route.fulfill({ json: { data: [{ id: 'stale-model' }] } })
    })
    await seed(page, url)
    await settings(page, 'chat')
    await page.locator('#chatModel').focus()
    const request = page.waitForRequest('https://old.example/v1/models')
    await page.locator('.model-dropdown:visible .model-refresh').click()
    await request
    await page.locator('#chatApiKey').fill('changed-key')
    release()
    await page.locator('#chatModel').focus()
    await expect(
      page.locator('.model-dropdown:visible .model-refresh'),
    ).not.toBeDisabled()
    await expect(page.locator('#chatModel')).toHaveValue('')
    await page.locator('#chatModel').focus()
    await expect(page.locator('.model-dropdown:visible')).not.toContainText(
      'stale-model',
    )
    await page.locator('#settingsTitle').click()
    await page.locator('#saveSettings').click()
    await page.reload()
    await settings(page, 'chat')
    await expect(page.locator('#chatModel')).toHaveValue('')
  })
  test(`${version}: grouped templates support typed filtering and plain names`, async ({
    page,
  }) => {
    await seed(page, url)
    await settings(page, 'chat')
    const host = page.locator('#chatProfileSelect').locator('..'),
      search = host.getByRole('searchbox')
    await host.locator('.custom-select-trigger').click()
    await expect(host.locator('.template-group-label')).toContainText([
      '站点 / 分组',
      '站点 / 其他',
    ])
    await search.pressSequentially('新模板')
    await expect(host.getByRole('option')).toHaveCount(1)
    await host.getByRole('option').click()
    await expect(page.locator('#chatModel')).toHaveValue('chat-new')
    await host.locator('.custom-select-trigger').click()
    await search.fill('普通模板')
    await host.getByRole('option', { name: '普通模板' }).click()
    await expect(page.locator('#chatModel')).toHaveValue('chat-old')
    await host.locator('.custom-select-trigger').click()
    await search.fill('no match')
    await expect(host.locator('.custom-select-menu')).toContainText(
      '无匹配模板',
    )
    await page.locator('#settingsTitle').click()
    await page.locator('#settings-tab-image').click()
    const imageHost = page.locator('#imageProfileSelect').locator('..')
    await imageHost.locator('.custom-select-trigger').click()
    await imageHost.getByRole('searchbox').fill('生图')
    await expect(imageHost.getByRole('option')).toHaveCount(1)
    await page.setViewportSize({ width: 420, height: 860 })
    await page.screenshot({
      path: `/workspace/screens/orbit-six-${version}-templates.png`,
    })
  })
  test(`${version}: noncredential model fields keep API secrets masked`, async ({
    page,
  }) => {
    await seed(page, url)
    await settings(page, 'chat')
    await expect(page.locator('#chatModel')).toHaveAttribute('type', 'search')
    await expect(page.locator('#chatModel')).toHaveAttribute(
      'autocomplete',
      'off',
    )
    await expect(page.locator('#chatModel')).toHaveAttribute(
      'name',
      /orbit-.*-model/,
    )
    await expect(page.locator('#chatApiKey')).toHaveAttribute(
      'type',
      'password',
    )
    await expect(page.locator('#chatApiKey')).toHaveAttribute(
      'autocomplete',
      'new-password',
    )
    await page.locator('[data-target="chatApiKey"]').click()
    await expect(page.locator('#chatApiKey')).toHaveAttribute('type', 'text')
  })
  test(`${version}: export initially selects all, clear initially selects none`, async ({
    page,
  }) => {
    await seed(page, url)
    await settings(page, 'data')
    await page.locator('#exportWorkspace').click()
    for (const key of ['chat', 'image', 'config'])
      await expect(page.locator(`[data-data-scope="${key}"]`)).toBeChecked()
    await page.locator('#cancelDataScope').click()
    await page.locator('#resetLocalData').click()
    for (const key of ['chat', 'image', 'config'])
      await expect(page.locator(`[data-data-scope="${key}"]`)).not.toBeChecked()
    await expect(page.locator('#confirmDataScope')).toBeDisabled()
    await page.setViewportSize({ width: 420, height: 860 })
    await page.screenshot({
      path: `/workspace/screens/orbit-six-${version}-scopes.png`,
    })
  })
  for (const scope of scopes) {
    test(`${version}: export ${scope} has exactly selected records and assets`, async ({
      page,
    }) => {
      page.on('dialog', (dialog) => dialog.accept())
      await seed(page, url)
      await settings(page, 'data')
      await page.locator('#exportWorkspace').click()
      const download = page.waitForEvent('download')
      await chooseDataScope(page, scope)
      const payload = readBackup(
          await readFile((await (await download).path())!),
        ) as any,
        selected = keys(scope)
      expect(payload.scope).toBe(scope)
      expect(payload.conversations?.length || 0).toBe(
        selected.includes('chat') ? 1 : 0,
      )
      expect(payload.imageHistory?.length || 0).toBe(
        selected.includes('image') ? 2 : 0,
      )
      expect(!!payload.apiConfig).toBe(selected.includes('config'))
      const ids = [
        ...new Set([
          ...(selected.includes('chat') ? ['x', 'a'] : []),
          ...(selected.includes('image') ? ['a', 'b', 'z'] : []),
          ...(selected.includes('config') ? ['t'] : []),
        ]),
      ].sort()
      expect(payload.images.map((item: any) => item.id).sort()).toEqual(ids)
    })
    test(`${version}: clear ${scope} preserves unselected records and shared assets on reload`, async ({
      page,
    }) => {
      page.on('dialog', (dialog) => dialog.accept())
      await seed(page, url)
      await settings(page, 'data')
      await page.locator('#resetLocalData').click()
      await chooseDataScope(page, scope)
      await expect(page.locator('#settingsBackdrop')).toBeHidden()
      await page.reload()
      const current = await state(page),
        items = await records(page),
        selected = keys(scope)
      expect(
        current.conversations.some((item: any) => item.id === 'chat'),
      ).toBe(!selected.includes('chat'))
      expect(
        items.filter((item) => item.type === 'generation-batch').length,
      ).toBe(selected.includes('image') ? 0 : 2)
      expect(current.settings.chatApiKey).toBe(
        selected.includes('config') ? '' : 'test-old',
      )
      for (const id of ['x', 'a', 'b', 'z', 't']) {
        const keep =
          (['x', 'a'].includes(id) && !selected.includes('chat')) ||
          (['a', 'b', 'z'].includes(id) && !selected.includes('image')) ||
          (id === 't' && !selected.includes('config'))
        expect(
          items.some((item) => item.id === id),
          `asset ${id}`,
        ).toBe(keep)
      }
    })
  }
  test(`${version}: imported config merges incoming identities and survives cancel and reload`, async ({
    page,
  }) => {
    await seed(page, url)
    await settings(page, 'data')
    page.on('dialog', (dialog) =>
      dialog.type() === 'prompt'
        ? dialog.accept('合并')
        : dialog.message().includes('是否保存')
          ? dialog.dismiss()
          : dialog.accept(),
    )
    const payload = {
      version: 12,
      scope: 'config',
      images: [],
      apiConfig: {
        settings: {
          chatBaseUrl: 'https://import.example/v1',
          chatApiKey: 'import-key',
          chatModel: 'import-model',
          imagePromptTemplates: [
            {
              id: 'prompt',
              name: '导入/模板',
              prompt: 'new',
              referenceImageIds: [],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
        connectionProfiles: {
          chat: [
            {
              id: 'old',
              name: '导入/分组/模板',
              baseUrl: 'https://import.example/v1',
              apiKey: 'import-key',
              model: 'import-model',
              models: ['import-model'],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
        activeConnectionProfiles: { chat: 'old' },
        modelCatalog: { chat: ['import-model'] },
      },
    }
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'config.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload)),
    })
    await page.locator('#settings-tab-chat').click()
    await expect(page.locator('#chatModel')).toHaveValue('import-model')
    await page.locator('#chatModel').focus()
    await expect(page.locator('.model-dropdown:visible')).toContainText(
      'import-model',
    )
    await expect(page.locator('.model-dropdown:visible')).not.toContainText(
      'chat-extra',
    )
    await page.locator('#settingsTitle').click()
    await page.locator('#chatModel').fill('unsaved')
    await page.locator('#closeSettings').click()
    await page.reload()
    const current = await state(page)
    expect(current.settings.chatModel).toBe('import-model')
    expect(current.settings.chatApiKey).toBe('import-key')
    expect(
      current.settings.imagePromptTemplates.find(
        (item: any) => item.id === 'prompt',
      ).prompt,
    ).toBe('new')
    expect(current.connectionProfiles.chat).toHaveLength(3)
    expect(
      current.connectionProfiles.chat.find((item: any) => item.id === 'old')
        .name,
    ).toBe('导入/分组/模板')
    expect(
      current.conversations.find((item: any) => item.id === 'chat').messages[0]
        .content,
    ).toBe('old message')
    expect(
      (await records(page)).filter((item) => item.type === 'generation-batch'),
    ).toHaveLength(2)
  })
  for (const scope of scopes) {
    test(`${version}: import ${scope} immediately merges only selected scopes and survives cancel`, async ({
      page,
    }) => {
      await seed(page, url)
      await settings(page, 'data')
      page.on('dialog', (dialog) =>
        dialog.type() === 'prompt'
          ? dialog.accept('合并')
          : dialog.message().includes('是否保存')
            ? dialog.dismiss()
            : dialog.accept(),
      )
      const selected = keys(scope)
      const payload = {
        version: 12,
        scope,
        conversations: [
          {
            id: 'chat',
            title: 'imported chat',
            createdAt: 1,
            messages: [
              {
                id: 'msg',
                role: 'user',
                content: 'imported message',
                imageIds: [],
                createdAt: 1,
              },
            ],
          },
          {
            id: 'new-chat',
            title: 'new chat',
            createdAt: 2,
            messages: [
              {
                id: 'new-msg',
                role: 'user',
                content: 'new message',
                imageIds: [],
                createdAt: 2,
              },
            ],
          },
        ],
        activeConversationId: 'chat',
        images:
          selected.includes('image') || selected.includes('chat')
            ? [
                {
                  id: 'a',
                  type: 'image',
                  src:
                    'data:image/svg+xml,' +
                    encodeURIComponent(
                      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><text>imported a</text></svg>',
                    ),
                  createdAt: 2,
                  favoriteFolderIds: ['c'],
                },
              ]
            : [],
        imageHistory: [
          {
            id: 'batch-a',
            batchId: 'batch-a',
            type: 'generation-batch',
            imageIds: ['a'],
            referenceImageIds: [],
            imageCount: 1,
            prompt: 'imported image',
            config: { model: 'image-old', count: 1 },
            createdAt: 2,
            startedAt: 2,
          },
        ],
        imageTasks: [
          {
            id: 'failed',
            type: 'generation-task',
            status: 'error',
            prompt: 'imported task',
            config: { model: 'image-old', count: 1 },
            referenceImageIds: [],
            favoriteFolderIds: ['c'],
            startedAt: 2,
            finishedAt: 3,
          },
        ],
        favoriteFolders: [
          { id: 'c', name: 'imported folder', isDefault: true },
        ],
        apiConfig: {
          settings: { chatApiKey: 'imported-key', chatModel: 'imported-model' },
        },
      }
      await page.locator('#workspaceImportFile').setInputFiles({
        name: 'scoped.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(payload)),
      })
      await expect(page.locator('#toast')).toContainText(/已.*导入/)
      await page.locator('#closeSettings').click()
      await page.reload()
      const current = await state(page),
        items = await records(page)
      expect(
        current.conversations.find((item: any) => item.id === 'chat')
          .messages[0].content,
      ).toBe(selected.includes('chat') ? 'imported message' : 'old message')
      expect(
        current.conversations.some((item: any) => item.id === 'new-chat'),
      ).toBe(selected.includes('chat'))
      expect(items.find((item) => item.id === 'batch-a').prompt).toBe(
        selected.includes('image') ? 'imported image' : 'a',
      )
      expect(
        items.filter((item) => item.type === 'generation-batch'),
      ).toHaveLength(2)
      expect(items.find((item) => item.id === 'failed').prompt).toBe(
        selected.includes('image') ? 'imported task' : 'failed task',
      )
      expect(current.settings.chatApiKey).toBe(
        selected.includes('config') ? 'imported-key' : 'test-old',
      )
      if (selected.includes('config'))
        expect(current.activeConnectionProfiles.chat).toBe('')
      if (selected.includes('image')) {
        const importedImageId = items.find((item) => item.id === 'batch-a')
          .imageIds[0]
        expect(
          items.find((item) => item.id === importedImageId).favoriteFolderIds,
        ).toEqual(['c'])
        if (selected.includes('chat')) expect(importedImageId).toBe('a')
        else {
          expect(importedImageId).not.toBe('a')
          expect(
            items.find((item) => item.id === 'a').favoriteFolderIds.sort(),
          ).toEqual(['c', 'other'])
        }
        expect(items.filter((item) => item.id === 'a')).toHaveLength(1)
        expect(items.find((item) => item.id === 'b').favoriteFolderIds).toEqual(
          ['other'],
        )
      } else {
        expect(
          items.find((item) => item.id === 'a').favoriteFolderIds.sort(),
        ).toEqual(['c', 'other'])
      }
    })
  }
  test(`${version}: bulk favorites append idempotently and remove only current membership`, async ({
    page,
  }) => {
    await seed(page, url)
    for (let i = 0; i < 2; i++) {
      await page.locator('.history-select').first().check({ force: true })
      await page.locator('#historySelectAll').click()
      await page.locator('#historyFavoriteSelected').click()
      await page.getByRole('checkbox', { name: '收藏到 目标收藏夹' }).check()
      await expect(page.locator('#removeFavoriteFolderChoices')).toBeHidden()
      await page.locator('#saveFavoriteFolderChoices').click()
      await expect(page.locator('#favoriteFolderBackdrop')).toBeHidden()
      const data = await records(page)
      for (const id of ['a', 'b', 'failed'])
        expect(
          data.find((item) => item.id === id).favoriteFolderIds.sort(),
        ).toEqual(['c', 'other'])
    }
    await page.locator('[data-history-library="favorites"]').click()
    await page
      .locator('.favorite-folder-card')
      .filter({ hasText: '目标收藏夹' })
      .locator('.favorite-folder-open')
      .click()
    await page.locator('.history-select').first().check({ force: true })
    await page.locator('#historySelectAll').click()
    await expect(page.locator('#historyFavoriteSelected')).toHaveText(
      '从当前收藏夹移除',
    )
    await page.locator('#historyFavoriteSelected').click()
    await expect(page.locator('#toast')).toContainText('已从当前收藏夹移除')
    await expect(page.locator('#historySelectionBar')).toBeHidden()
    await page.reload()
    const data = await records(page)
    for (const id of ['a', 'b', 'failed'])
      expect(data.find((item) => item.id === id).favoriteFolderIds).toEqual([
        'other',
      ])
    expect(
      data.filter((item) => item.type === 'generation-batch'),
    ).toHaveLength(2)
    expect(data.find((item) => item.id === 'z').favoriteFolderIds).toEqual([
      'other',
    ])
  })
}
