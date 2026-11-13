import { readBackup } from './helpers/backup'
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
async function seed(page: Page, url: string) {
  await page.route(
    'https://cdn.jsdelivr.net/npm/selecto@1.26.2/dist/selecto.min.js',
    (r) =>
      r.fulfill({
        body: readFileSync('node_modules/selecto/dist/selecto.min.js'),
        contentType: 'application/javascript',
      }),
  )
  await page.goto(url)
  await page.evaluate(async () => {
    localStorage.setItem(
      'orbit-chat-state-v1',
      JSON.stringify({
        settings: {
          demoMode: true,
          chatStream: true,
          chatModel: 'other-model',
          systemPrompt: 'other-system',
        },
        contextMode: 'single',
        activeConversationId: 'other',
        conversations: [
          {
            id: 'source',
            title: '原始对话',
            createdAt: 1,
            params: { temperature: 0.4, nested: { value: 'original' } },
            chatContext: {
              settings: {
                chatModel: 'source-model',
                systemPrompt: 'source-system',
                reasoningEffort: 'high',
                chatStream: true,
                chatWebSearch: false,
              },
              contextMode: 'client',
            },
            messages: [
              {
                id: 'm1',
                role: 'user',
                content: '原始问题',
                imageIds: ['shared-img'],
                createdAt: 1,
                attachments: [{ name: '附加元数据', nested: { value: 1 } }],
              },
              {
                id: 'm2',
                role: 'assistant',
                content: '原始回答',
                reasoning: '完整思考过程',
                imageIds: [],
                createdAt: 2,
              },
            ],
          },
          { id: 'other', title: '其他对话', createdAt: 2, messages: [] },
        ],
      }),
    )
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const q = indexedDB.open('orbit-chat-images-v1')
      q.onupgradeneeded = () =>
        q.result.createObjectStore('generations', { keyPath: 'id' })
      q.onsuccess = () => resolve(q.result)
      q.onerror = () => reject(q.error)
    })
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32)
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('generations', 'readwrite')
      tx.objectStore('generations').put({
        id: 'shared-img',
        type: 'image',
        src: canvas.toDataURL(),
        createdAt: 1,
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  })
  await page.reload()
  await page.locator('[data-view="chat"]').click()
}
async function stored(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('orbit-chat-state-v1')!),
  )
}
for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 复制对话深拷贝消息参数、新ID、上下文切换、共享图片GC与导出导入`, async ({
    page,
  }) => {
    await seed(page, url)
    const source = page.locator('.conversation-row').filter({
      has: page.locator('.conversation-title', { hasText: '原始对话' }),
    })
    await source.hover()
    await source.getByRole('button', { name: '对话操作' }).click()
    await page.getByRole('menuitem', { name: '复制对话', exact: true }).click()
    await expect(page.locator('.conversation-item.active')).toContainText(
      '原始对话（副本）',
    )
    await expect(page.locator('.message')).toHaveCount(2)
    await expect(page.locator('.message-image')).toHaveCount(1)
    await expect
      .poll(async () => (await stored(page)).conversations.length)
      .toBe(3)
    const state = await stored(page),
      copy = state.conversations.find(
        (c: any) => c.title === '原始对话（副本）',
      ),
      original = state.conversations.find((c: any) => c.id === 'source')
    expect(copy.id).not.toBe(original.id)
    expect(copy.messages.map((m: any) => m.id)).not.toEqual(
      original.messages.map((m: any) => m.id),
    )
    expect(copy.messages.map(({ id, ...m }: any) => m)).toEqual(
      original.messages.map(({ id, ...m }: any) => m),
    )
    expect(copy.params).toEqual(original.params)
    expect(state.settings.chatModel).toBe('source-model')
    expect(state.settings.systemPrompt).toBe('source-system')
    expect(state.contextMode).toBe('client')
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-data-scope="chat"]').click(),
    ])
    const buffer = await readFile((await download.path())!)
    const payload = readBackup(buffer)
    expect(
      payload.conversations.find((c: any) => c.id === copy.id).chatContext,
    ).toEqual(copy.chatContext)
    expect(payload.images).toHaveLength(1)
    await page.locator('#cancelSettings').click()
    page.once('dialog', (d) => d.accept())
    await page
      .locator('.message.assistant')
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await expect(page.locator('.message')).toHaveCount(1)
    await page.locator('#chatModelQuick').fill('copy-model')
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-prompts').click()
    await page.locator('#systemPrompt').fill('copy-system')
    await page.locator('#saveSettings').click()
    await page
      .locator('.conversation-item')
      .filter({ hasText: /^.*原始对话$/ })
      .click()
    await expect(page.locator('.message')).toHaveCount(2)
    await expect(page.locator('#chatModelQuick')).toHaveValue('source-model')
    await page
      .locator('.conversation-item')
      .filter({ hasText: '原始对话（副本）' })
      .click()
    await expect(page.locator('.message')).toHaveCount(1)
    await expect(page.locator('#chatModelQuick')).toHaveValue('copy-model')
    expect((await stored(page)).settings.systemPrompt).toBe('copy-system')
    const originalRow = page.locator('.conversation-row').filter({
      has: page
        .locator('.conversation-title')
        .filter({ hasText: /^原始对话$/ }),
    })
    page.once('dialog', (d) => d.accept())
    await originalRow.hover()
    await originalRow.getByRole('button', { name: '对话操作' }).click()
    await page.getByRole('menuitem', { name: '删除对话', exact: true }).click()
    await expect(page.locator('.conversation-item')).toHaveCount(2)
    await page.reload()
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-image')).toHaveCount(1)
    await expect
      .poll(() =>
        page
          .locator('.message-image')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBe(32)
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    page.on('dialog', (d) =>
      d.accept(d.type() === 'prompt' ? '覆盖' : undefined),
    )
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'fork.json',
      mimeType: 'application/json',
      buffer,
    })
    await expect(page.locator('#toast')).toContainText('覆盖导入')
    await page.locator('#cancelSettings').click()
    await expect(page.locator('.conversation-item')).toHaveCount(3)
    const restored = (await stored(page)).conversations.find(
      (c: any) => c.id === copy.id,
    )
    expect(restored.messages).toHaveLength(2)
    expect(restored.chatContext).toEqual(copy.chatContext)
    expect(restored.params).toEqual(copy.params)
  })
  test(`${version} 正在流式生成的对话禁用复制，暂停后恢复`, async ({
    page,
  }) => {
    await seed(page, url)
    await page
      .locator('.conversation-item')
      .filter({ hasText: '原始对话' })
      .click()
    await page.locator('#messageInput').fill('正在生成时不可复制')
    await page.locator('#sendButton').click()
    const row = page
      .locator('.conversation-row')
      .filter({ has: page.locator('.conversation-item.active') })
    await row.hover()
    await row.getByRole('button', { name: '对话操作' }).click()
    await expect(
      page.getByRole('menuitem', { name: '复制对话', exact: true }),
    ).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.locator('#sendButton').click()
    await row.hover()
    await row.getByRole('button', { name: '对话操作' }).click()
    await expect(
      page.getByRole('menuitem', { name: '复制对话', exact: true }),
    ).toBeEnabled()
    await page.getByRole('menuitem', { name: '复制对话', exact: true }).click()
    await expect(page.locator('.conversation-item.active')).toContainText(
      '（副本）',
    )
  })
}
