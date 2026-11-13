import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { unzipSync } from 'fflate'

async function open(
  page: Page,
  url: string,
  options: { mobile?: boolean; large?: boolean; reused?: boolean } = {},
) {
  if (options.mobile) await page.setViewportSize({ width: 390, height: 740 })
  await page.goto(url)
  await expect(page.locator('#imageView')).toBeVisible()
  await page.evaluate(
    async ({ large, reused }) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 24
      canvas.getContext('2d')!.fillRect(0, 0, 24, 24)
      const png = canvas.toDataURL()
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: {
            theme: 'light',
            demoMode: false,
            chatApiKey: 'test',
            chatBaseUrl: 'https://chat-ui.test/v1',
            chatModel: 'test',
            chatStream: false,
            ...(reused
              ? {
                  imagePromptTemplates: [
                    {
                      id: 'external-template',
                      name: '外部图片模板',
                      prompt: '测试',
                      referenceImageIds: ['external'],
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ],
                }
              : {}),
          },
          activeConversationId: 'a',
          conversations: [
            {
              id: 'a',
              title: '第一段对话标题应当占满可用空间',
              createdAt: 2,
              messages: [
                {
                  id: 'u',
                  role: 'user',
                  content: '原来的问题',
                  imageIds: reused
                    ? ['input', 'output', 'external']
                    : ['input'],
                  createdAt: 1,
                },
                {
                  id: 'm',
                  role: 'assistant',
                  content:
                    '|名称|说明|\n|:---|---:|\n|**表格**|内容|\n\n---\n\n```js\nconst n = 1\n```\n\n<img src=x onerror="window.hacked=1">\n\n[危险](javascript:alert(1))',
                  imageIds: ['output'],
                  createdAt: 2,
                },
              ],
            },
            {
              id: 'b',
              title: '第二段对话',
              createdAt: 1,
              messages: [
                {
                  id: 'other',
                  role: reused ? 'assistant' : 'user',
                  content: '另一段内容',
                  imageIds: reused ? ['external'] : [],
                  createdAt: 1,
                },
              ],
            },
          ],
        }),
      )
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('orbit-chat-images-v1')
        request.onupgradeneeded = () =>
          request.result.createObjectStore('generations', { keyPath: 'id' })
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('generations', 'readwrite')
        const store = tx.objectStore('generations')
        store.clear()
        const config = {
          model: 'test',
          count: 1,
          format: 'png',
          quality: 'auto',
        }
        store.put({
          id: 'input',
          type: 'image',
          src: png,
          name: '输入图',
          createdAt: 1,
        })
        store.put({
          id: 'output',
          type: 'image',
          src: large
            ? 'data:image/png;base64,' +
              btoa(atob(png.split(',')[1]) + 'A'.repeat(8 * 1024 * 1024))
            : png,
          name: '输出图',
          createdAt: 2,
          batchId: 'batch',
          config,
        })
        if (reused) {
          canvas.getContext('2d')!.fillStyle = 'red'
          canvas.getContext('2d')!.fillRect(0, 0, 24, 24)
          store.put({
            id: 'external',
            type: 'image',
            src: canvas.toDataURL(),
            name: '其他对话生成的图片',
            createdAt: 3,
          })
        }
        store.put({
          id: 'batch',
          batchId: 'batch',
          taskId: '',
          type: 'generation-batch',
          imageIds: ['output'],
          referenceImageIds: ['input'],
          prompt: '非常长的关键词 '.repeat(120),
          config,
          createdAt: 2,
          imageCount: 1,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        })
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      db.close()
    },
    { large: options.large || false, reused: options.reused || false },
  )
  await page.reload()
  await expect(page.locator('.history-item.success')).toHaveCount(1)
  await page.locator('[data-view="chat"]').click()
  await expect(page.locator('.message')).toHaveCount(2)
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} Markdown 表格、分隔线和代码块可读且不执行原始HTML`, async ({
    page,
  }) => {
    await open(page, url)
    const message = page.locator('.message.assistant .message-text')
    await expect(message.locator('table th')).toHaveCount(2)
    await expect(message.locator('table td strong')).toHaveText('表格')
    await expect(message.locator('hr')).toHaveCount(1)
    await expect(message.locator('pre code')).toHaveText('const n = 1\n')
    await expect(message).toContainText('<img src=x onerror=')
    expect(await page.evaluate(() => (window as any).hacked)).toBeUndefined()
    await expect(message.locator('a')).not.toHaveAttribute(
      'href',
      /javascript:/,
    )
    expect(await message.evaluate((el) => getComputedStyle(el).color)).toBe(
      'rgb(0, 0, 0)',
    )
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )
    expect(overflow).toBe(false)
    await page.screenshot({
      path: `.cache/screens/chat-ui-markdown-${version}.png`,
    })
  })

  test(`${version} 草稿、附件与编辑状态按对话保留, 切换工作区不清空`, async ({
    page,
  }) => {
    await open(page, url)
    await page.locator('#messageInput').fill('对话 A 的草稿')
    await page.locator('#fileUpload').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('附件文本'),
    })
    const text = await page.locator('#messageInput').inputValue()
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第二段对话' })
      .click()
    await expect(page.locator('#messageInput')).toHaveValue('')
    await page.locator('#messageInput').fill('对话 B 的草稿')
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第一段' })
      .click()
    await expect(page.locator('#messageInput')).toHaveValue(text)
    await page.locator('[data-view="image"]').click()
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('#messageInput')).toHaveValue(text)
    await page
      .locator('.message.user .message-action')
      .filter({ hasText: '修改' })
      .click()
    await expect(page.locator('#editingBanner')).toBeVisible()
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第二段对话' })
      .click()
    await expect(page.locator('#editingBanner')).toBeHidden()
    await expect(page.locator('#messageInput')).toHaveValue('对话 B 的草稿')
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第一段' })
      .click()
    await expect(page.locator('#editingBanner')).toBeVisible()
    await expect(page.locator('#attachmentPreview img')).toHaveCount(1)
    await page.locator('#newChatButton').click()
    await expect(page.locator('#messageInput')).toHaveValue('')
    await page.locator('#messageInput').fill('空会话草稿')
    await page.locator('#newChatButton').click()
    await expect(page.locator('#messageInput')).toHaveValue('空会话草稿')
    await expect(page.locator('.conversation-item')).toHaveCount(3)
  })

  test(`${version} 侧栏可完全收起, 溢出标题循环滚动且操作按钮与行背景一致`, async ({
    page,
  }) => {
    await open(page, url)
    await expect(page.locator('#openSettings')).toHaveCount(0)
    const stage = page.locator('.content-stage')
    const before = (await stage.boundingBox())!.width
    await page.locator('#openSidebar').click()
    await expect(page.locator('#sidebar')).toBeHidden()
    expect((await stage.boundingBox())!.width).toBeGreaterThan(before + 200)
    await page.locator('[data-view="image"]').click()
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('#sidebar')).toBeHidden()
    await page.locator('#openSidebar').click()
    await expect(page.locator('#sidebar')).toBeVisible()
    const row = page.locator('.conversation-row').first()
    const title = row.locator('.conversation-title')
    await title.evaluate((el) => {
      el.textContent = '这是一个需要滚动显示的非常长的对话标题'.repeat(3)
    })
    await row.hover()
    await expect(title.locator('.conversation-title-track')).toBeVisible()
    const colors = await row.evaluate((el) => ({
      row: getComputedStyle(el.querySelector('.conversation-item')!)
        .backgroundColor,
      button: getComputedStyle(el.querySelector('.conversation-more')!)
        .backgroundColor,
    }))
    expect(colors.row).toBe(colors.button)
    const track = title.locator('.conversation-title-track')
    await expect
      .poll(() => track.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe('none')
    await page.locator('#messageInput').hover()
    await expect(track).toHaveCount(0)
    await page.screenshot({
      path: `.cache/screens/chat-sidebar-${version}.png`,
    })
  })

  test(`${version} 手机侧栏开合与无障碍状态一致, 主体没有横向溢出`, async ({
    page,
  }) => {
    await open(page, url, { mobile: true })
    const toggle = page.locator('#openSidebar')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#sidebar')).toHaveClass(/open/)
    await page.locator('#closeSidebar').click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      )
      .toBeLessThanOrEqual(1)
  })

  test(`${version} 多个代码文件一次加入草稿, 超限和二进制不产生半份内容`, async ({
    page,
  }) => {
    await open(page, url)
    const input = page.locator('#messageInput')
    await input.fill('原有文字')
    await page.locator('#fileUpload').setInputFiles([
      {
        name: 'example.js',
        mimeType: 'application/javascript',
        buffer: Buffer.from('const count = 1'),
      },
      {
        name: 'example.ts',
        mimeType: '',
        buffer: Buffer.from('const title: string = "中文"'),
      },
      {
        name: 'example.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<h1>测试</h1>'),
      },
      {
        name: 'utf16.txt',
        mimeType: 'text/plain',
        buffer: Buffer.concat([
          Buffer.from([255, 254]),
          Buffer.from('中文内容', 'utf16le'),
        ]),
      },
    ])
    await expect(input).toHaveValue(
      /example\.js[\s\S]*example\.ts[\s\S]*example\.html[\s\S]*中文内容/,
    )
    const value = await input.inputValue()
    await page.locator('#fileUpload').setInputFiles([
      {
        name: 'valid.ts',
        mimeType: '',
        buffer: Buffer.from('should not append'),
      },
      {
        name: 'binary.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from([1, 0, 2]),
      },
    ])
    await expect(page.locator('#toast')).toContainText('不是可读取的文本文件')
    await expect(input).toHaveValue(value)
    await page.locator('#fileUpload').setInputFiles({
      name: 'large.ts',
      mimeType: '',
      buffer: Buffer.from('x'.repeat(200001)),
    })
    await expect(page.locator('#toast')).toContainText('20 万字符')
    await expect(input).toHaveValue(value)
    await page.locator('#fileUpload').setInputFiles({
      name: 'old.doc',
      mimeType: 'application/msword',
      buffer: Buffer.from('not a text document'),
    })
    await expect(page.locator('#toast')).toContainText('暂不支持此文件类型')
    await expect(input).toHaveValue(value)
  })

  test(`${version} PDF 原样直传, 草稿和历史保留附件, ZIP 可恢复且删除不遗留正文`, async ({
    page,
  }) => {
    await open(page, url)
    const requests: any[] = []
    await page.route('https://chat-ui.test/**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ json: { data: [] } })
        return
      }
      requests.push(route.request().postDataJSON())
      await route.fulfill({
        json: { choices: [{ message: { content: '已收到文件' } }] },
      })
    })
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
    )
    await page.locator('#fileUpload').setInputFiles({
      name: '测试文件.pdf',
      mimeType: 'application/pdf',
      buffer: pdf,
    })
    await expect(page.locator('#fileAttachmentPreview')).toContainText(
      '测试文件.pdf',
    )
    await expect(page.locator('#messageInput')).toHaveValue('')
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第二段' })
      .click()
    await expect(page.locator('#fileAttachmentPreview')).toBeHidden()
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第一段' })
      .click()
    await expect(page.locator('#fileAttachmentPreview')).toContainText(
      '测试文件.pdf',
    )
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '已收到文件',
    )
    const part = requests[0].messages.at(-1).content[0]
    expect(part.type).toBe('file')
    expect(part.file.filename).toBe('测试文件.pdf')
    expect(Buffer.from(part.file.file_data.split(',')[1], 'base64')).toEqual(
      pdf,
    )
    expect(part.file.file_data).toMatch(/^data:application\/pdf;base64,/)
    await expect(page.locator('#fileAttachmentPreview')).toBeHidden()
    await page.reload()
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message.user .chat-file')).toContainText(
      '测试文件.pdf',
    )
    await page.locator('#messageInput').fill('继续分析')
    await page.locator('#sendButton').click()
    await expect.poll(() => requests.length).toBe(2)
    expect(
      requests[1].messages
        .flatMap((message: any) =>
          Array.isArray(message.content) ? message.content : [],
        )
        .filter((part: any) => part.type === 'file'),
    ).toHaveLength(1)
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
    const state = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('orbit-chat-state-v1')!),
    )
    const file = state.conversations
      .flatMap((conversation: any) => conversation.messages)
      .find((message: any) => message.files?.length).files[0]
    expect(Object.keys(file).sort()).toEqual(['id', 'name', 'size'])
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-data-scope="chat"]').click(),
    ])
    const buffer = await readFile((await download.path())!)
    const archive = unzipSync(buffer)
    const manifest = JSON.parse(
      Buffer.from(archive['manifest.json']).toString(),
    )
    const exported = manifest.conversations
      .flatMap((conversation: any) => conversation.messages)
      .find((message: any) => message.files?.length).files[0]
    expect(exported.archiveFile).toMatch(/^files\/\d+\.pdf$/)
    expect(Buffer.from(archive[exported.archiveFile])).toEqual(pdf)
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
    )
    await page.locator('#resetLocalData').click()
    await page.locator('[data-data-scope="chat"]').click()
    const storedFiles = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open('orbit-chat-files-v1')
            request.onsuccess = () => {
              const db = request.result
              const count = db.transaction('files').objectStore('files').count()
              count.onsuccess = () => {
                resolve(count.result)
                db.close()
              }
              count.onerror = () => reject(count.error)
            }
            request.onerror = () => reject(request.error)
          }),
      )
    await expect.poll(storedFiles).toBe(0)
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page
      .locator('#workspaceImportFile')
      .setInputFiles({ name: 'chat.zip', mimeType: 'application/zip', buffer })
    await expect(page.locator('#toast')).toContainText('合并导入')
    await expect.poll(storedFiles).toBe(1)
    await page.locator('#closeSettings').click()
    await page.locator('#messageInput').fill('导入后继续')
    await page.locator('#sendButton').click()
    await expect.poll(() => requests.length).toBe(3)
    const restored = requests[2].messages
      .flatMap((message: any) =>
        Array.isArray(message.content) ? message.content : [],
      )
      .find((part: any) => part.type === 'file')
    expect(
      Buffer.from(restored.file.file_data.split(',')[1], 'base64'),
    ).toEqual(pdf)
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
    await page
      .locator('.message.user')
      .filter({ has: page.locator('.chat-file') })
      .getByRole('button', { name: '删除', exact: true })
      .click()
    await expect.poll(storedFiles).toBe(0)
  })

  test(`${version} 浅色强调色统一, 主文字为黑色且辅助信息为灰色, 下拉选中项清晰`, async ({
    page,
  }) => {
    await open(page, url)
    const color = await page
      .locator('.brand-mark')
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    const accent = await page
      .locator('html')
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--accent').trim(),
      )
    expect(color).toBe('rgb(37, 99, 235)')
    expect(accent).toBe('#2563eb')
    await expect(page.locator('.conversation-item').last()).toHaveCSS(
      'color',
      'rgb(0, 0, 0)',
    )
    await expect(page.locator('.message.assistant .message-text')).toHaveCSS(
      'color',
      'rgb(0, 0, 0)',
    )
    const placeholder = await page
      .locator('#messageInput')
      .evaluate((el) => getComputedStyle(el, '::placeholder').color)
    expect(placeholder).not.toBe('rgb(0, 0, 0)')
    await expect(page.locator('.message-time').first()).not.toHaveCSS(
      'color',
      'rgb(0, 0, 0)',
    )
    await page.screenshot({
      path: `.cache/screens/chat-ui-colors-${version}.png`,
    })
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-display').click()
    await page
      .locator('#themeSetting')
      .locator('..')
      .locator('.custom-select-trigger')
      .click()
    const choices = page.locator(
      '.custom-select-menu:visible .custom-select-option',
    )
    await expect(choices.first()).toHaveCSS('color', 'rgb(0, 0, 0)')
    await expect(choices.filter({ hasText: '浅色' })).toHaveCSS('color', color)
    await expect(choices.filter({ hasText: '浅色' })).toHaveCSS(
      'background-color',
      'rgba(37, 99, 235, 0.1)',
    )
    await page.screenshot({
      path: `.cache/screens/chat-ui-theme-options-${version}.png`,
    })
  })

  test(`${version} 隐私模式下悬停图片引用可直接看清预览, 离开后关闭`, async ({
    page,
  }) => {
    await open(page, url)
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-display').click()
    await page
      .locator('.toggle-row')
      .filter({ has: page.locator('#imagePrivacyEnabled') })
      .click()
    await page.locator('#saveSettings').click()
    const checkPreview = async (id: string, text: string) => {
      await page.locator(`#${id}`).fill(text)
      if (await page.locator('.image-mention-menu:visible').count())
        await page.locator(`#${id}`).press('Escape')
      await page.locator(`#${id}Mirror .image-mention-token`).hover()
      const preview = page.locator('.image-mention-tooltip:visible img')
      await expect(preview).toBeVisible()
      await expect(preview).toHaveCSS('filter', 'none')
      await expect(preview).toHaveCSS('opacity', '1')
      await expect(page.locator('.message-image').first()).toHaveCSS(
        'filter',
        'blur(18px)',
      )
      await page.mouse.move(0, 0)
      await expect(page.locator('.image-mention-tooltip:visible')).toHaveCount(
        0,
      )
    }
    await checkPreview('messageInput', '@图1')
    await page.locator('[data-view="image"]').click()
    await page.locator('[data-history-action="config"]').first().click()
    await checkPreview('imagePrompt', '@图1')
    await page.locator('#polishImagePrompt').click()
    await page.locator('#polishUseGenerationReferences').check()
    await checkPreview('polishSourcePrompt', '@生成参考图1')
  })

  test(`${version} 图片单独发送不补文字, 错误保留在消息中且不作为虚构回复重发`, async ({
    page,
  }) => {
    await open(page, url)
    let requests: any[] = []
    await page.route('https://chat-ui.test/**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ json: { data: [] } })
        return
      }
      requests.push(route.request().postDataJSON())
      await route.fulfill(
        requests.length === 2
          ? { status: 429, json: { error: { message: '测试限流错误' } } }
          : { json: { choices: [{ message: { content: '正常回复' } }] } },
      )
    })
    await page.locator('#imageUpload').setInputFiles({
      name: 'image.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII=',
        'base64',
      ),
    })
    await expect(page.locator('#attachmentPreview img')).toHaveCount(1)
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '正常回复',
    )
    expect(requests[0].messages.at(-1).content).toHaveLength(2)
    expect(requests[0].messages.at(-1).content[0].text).toContain('图片 ID:')
    expect(requests[0].messages.at(-1).content[1].type).toBe('image_url')
    await expect(
      page.locator('.message.user').last().locator('.message-text'),
    ).not.toContainText('请分析')
    await page.locator('#messageInput').fill('报错测试')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message-error')).toHaveText(
      '请求失败: 测试限流错误',
    )
    await page.reload()
    await page.locator('[data-view="chat"]').click()
    await expect(page.locator('.message-error')).toContainText('测试限流错误')
    await page.locator('#messageInput').fill('继续')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '正常回复',
    )
    await expect.poll(() => requests.length).toBe(3)
    expect(JSON.stringify(requests[2].messages)).not.toContain('测试限流错误')
  })

  for (const mobile of [false, true])
    test(`${version} ${mobile ? '手机' : '桌面'}图片引用候选位于视口内并区分输入输出`, async ({
      page,
    }) => {
      await open(page, url, { mobile })
      await page.locator('#messageInput').fill('@')
      const menu = page.locator('.image-mention-menu:visible')
      await expect(menu).toBeVisible()
      await expect(menu.locator('.image-mention-origin')).toHaveText([
        '输入',
        '输出',
      ])
      const inputTag = menu.locator('[data-origin="input"]')
      const outputTag = menu.locator('[data-origin="output"]')
      const tagColors = await Promise.all(
        [inputTag, outputTag].map((tag) =>
          tag.evaluate((el) => ({
            color: getComputedStyle(el).color,
            background: getComputedStyle(el).backgroundColor,
          })),
        ),
      )
      expect(tagColors[0].color).not.toBe(tagColors[1].color)
      expect(tagColors[0].background).not.toBe(tagColors[1].background)
      const box = await menu.boundingBox()
      const size = page.viewportSize()!
      expect(box!.y).toBeGreaterThanOrEqual(8)
      expect(box!.x).toBeGreaterThanOrEqual(8)
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height - 7)
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width - 7)
      await page.locator('#messageInput').press('ArrowDown')
      await page.locator('#messageInput').press('Enter')
      await expect(page.locator('#messageInput')).toHaveValue('@图2')
      await expect(
        page.locator('.message-image-label, .image-origin-tag'),
      ).toHaveCount(0)
      await expect(page.locator('.message-image')).toHaveCount(2)
    })

  test(`${version} 复用图片按当前对话生成关系标注, 导出按全局产出来源分类`, async ({
    page,
    browser,
  }) => {
    await open(page, url, { reused: true })
    await page.locator('#messageInput').fill('@')
    const menu = page.locator('.image-mention-menu:visible')
    await expect(menu.locator('.image-mention-origin')).toHaveText([
      '输入',
      '输出',
      '输入',
    ])
    await expect(
      page.locator('.message-image-label, .image-origin-tag'),
    ).toHaveCount(0)
    await page.locator('#messageInput').press('Escape')
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
    )
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    let config: Buffer | undefined
    for (const scope of ['chat', 'config']) {
      await page.locator('#exportWorkspace').click()
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator(`[data-data-scope="${scope}"]`).click(),
      ])
      const buffer = await readFile((await download.path())!)
      const manifest = JSON.parse(
        Buffer.from(unzipSync(buffer)['manifest.json']).toString(),
      )
      const external = manifest.images.find(
        (image: any) => image.id === 'external',
      )
      expect(external.origin).toBe('generated')
      expect(external.file).toMatch(/^outputs\//)
      if (scope === 'chat') {
        expect(
          manifest.images.find((image: any) => image.id === 'input').file,
        ).toMatch(/^inputs\//)
        expect(
          manifest.images.find((image: any) => image.id === 'output').file,
        ).toMatch(/^outputs\//)
      } else config = buffer
    }
    // 仅配置备份不含原对话, 再次导出仍应保留图片的真实来源。
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'config.zip',
      mimeType: 'application/zip',
      buffer: config!,
    })
    await expect(page.locator('#toast')).toContainText(/配置已导入|合并导入/)
    await page.locator('#cancelSettings').click()
    await page.locator('[data-view="chat"]').click()
    await page
      .locator('.conversation-item')
      .filter({ hasText: '第二段对话' })
      .click()
    await page.locator('#messageInput').fill('@')
    await expect(
      page.locator('.image-mention-menu:visible .image-mention-origin'),
    ).toHaveText(['输出'])
    const context = await browser.newContext()
    try {
      const isolated = await context.newPage()
      isolated.on('dialog', (dialog) =>
        dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
      )
      await isolated.goto(new URL(url, page.url()).href)
      await isolated.locator('#topbarSettings').click()
      await isolated.locator('#settings-tab-data').click()
      await isolated.locator('#workspaceImportFile').setInputFiles({
        name: 'config.zip',
        mimeType: 'application/zip',
        buffer: config!,
      })
      await expect(isolated.locator('#toast')).toContainText(
        /配置已导入|合并导入/,
      )
      await isolated.locator('#exportWorkspace').click()
      const [download] = await Promise.all([
        isolated.waitForEvent('download'),
        isolated.locator('[data-data-scope="config"]').click(),
      ])
      const buffer = await readFile((await download.path())!)
      const manifest = JSON.parse(
        Buffer.from(unzipSync(buffer)['manifest.json']).toString(),
      )
      expect(manifest.images).toHaveLength(1)
      expect(manifest.images[0].origin).toBe('generated')
      expect(manifest.images[0].file).toMatch(/^outputs\//)
    } finally {
      await context.close()
    }
  })

  test(`${version} 再次上传本对话生成的原图可复用输出引用, 发送后分类保持不变`, async ({
    page,
  }) => {
    await open(page, url)
    await page.route('https://chat-ui.test/**', (route) =>
      route.fulfill({
        json: { choices: [{ message: { content: '收到' } }] },
      }),
    )
    const source = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open('orbit-chat-images-v1')
        request.onsuccess = () => resolve(request.result)
      })
      const image = await new Promise<any>((resolve) => {
        const request = db
          .transaction('generations')
          .objectStore('generations')
          .get('output')
        request.onsuccess = () => resolve(request.result)
      })
      let blob: Blob
      if (image.src?.startsWith('data:'))
        blob = await (await fetch(image.src)).blob()
      else
        blob = await new Promise<Blob>((resolve) => {
          const request = db
            .transaction('image-assets')
            .objectStore('image-assets')
            .get('output')
          request.onsuccess = () => resolve(request.result.blob)
        })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      db.close()
      return Array.from(bytes)
    })
    await page.locator('#imageUpload').setInputFiles({
      name: '复制的原图.png',
      mimeType: 'image/png',
      buffer: Buffer.from(source),
    })
    await expect(page.locator('#attachmentPreview img')).toHaveCount(1)
    await page.locator('#messageInput').fill('@')
    await expect(
      page.locator('.image-mention-menu:visible .image-mention-origin'),
    ).toHaveText(['输入', '输出'])
    await page.locator('#messageInput').fill('这张图')
    await page.locator('#sendButton').click()
    await expect(page.locator('.message.assistant').last()).toContainText(
      '收到',
    )
    await expect(page.locator('#sendButton')).toHaveAttribute(
      'aria-label',
      '发送消息',
    )
    await page.locator('#messageInput').fill('@')
    await expect(
      page.locator('.image-mention-menu:visible .image-mention-origin'),
    ).toHaveText(['输入', '输出'])
    await expect(
      page.locator('.message-image-label, .image-origin-tag'),
    ).toHaveCount(0)
  })

  test(`${version} 对话侧栏可调宽, 标题不预留隐藏按钮空间, 可导出未选中会话`, async ({
    page,
  }) => {
    await open(page, url)
    const row = page
      .locator('.conversation-row')
      .filter({ hasText: '第二段对话' })
    expect(
      await row
        .locator('.conversation-item')
        .evaluate((el) => getComputedStyle(el).paddingRight),
    ).toBe('10px')
    const sidebar = page.locator('#sidebar')
    const before = (await sidebar.boundingBox())!.width
    const handle = (await page.locator('#sidebarResize').boundingBox())!
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100)
    await page.mouse.down()
    await page.mouse.move(handle.x + 100, handle.y + 100, { steps: 5 })
    await page.mouse.up()
    expect((await sidebar.boundingBox())!.width).toBeGreaterThan(before + 70)
    await row.hover()
    await row.getByRole('button', { name: '对话操作' }).click()
    const menu = page.locator('.conversation-row-menu')
    await expect(menu).toBeVisible()
    const triggerBox = (await row.locator('.conversation-more').boundingBox())!
    const menuBox = (await menu.boundingBox())!
    expect(menuBox.x).toBeGreaterThan(triggerBox.x + triggerBox.width)
    expect(menuBox.y).toBeGreaterThan(triggerBox.y + triggerBox.height)
    await page.screenshot({
      path: `.cache/screens/chat-ui-menu-${version}.png`,
    })
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      menu.getByRole('menuitem', { name: '导出 Markdown' }).click(),
    ])
    const content = await readFile((await download.path())!, 'utf8')
    expect(content).toContain('# 第二段对话')
    expect(content).toContain('另一段内容')
    expect(content).not.toContain('原来的问题')
    await expect(page.locator('.conversation-item.active')).toContainText(
      '第一段',
    )
  })

  test(`${version} 大图导入导出在同一位置显示进度, 范围弹窗关闭后仍可见`, async ({
    page,
  }) => {
    await open(page, url, { large: true })
    await page.evaluate(() => {
      ;(window as any).exportSeen = []
      ;(window as any).transferPositions = {}
      const observer = new MutationObserver(() => {
        for (const id of ['exportProgress', 'importProgress']) {
          const progress = document.getElementById(id)
          if (progress && progress.getBoundingClientRect().height > 0) {
            const rect = progress.getBoundingClientRect()
            ;(window as any).transferPositions[id] = {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              outsideSettings: !progress.closest('#settingsBackdrop'),
              className: progress.className.replace(' indeterminate', ''),
            }
            if (id === 'exportProgress') {
              const bar = progress.querySelector('[role="progressbar"]')
              ;(window as any).exportSeen.push(
                Number(bar?.getAttribute('aria-valuenow')),
              )
            }
          }
        }
      })
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        characterData: true,
      })
    })
    await page.locator('#topbarSettings').click()
    await page.locator('#settings-tab-data').click()
    await page.locator('#exportWorkspace').click()
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('[data-data-scope="workspace"]').click(),
    ])
    const seen = await page.evaluate(
      () => (window as any).exportSeen as number[],
    )
    expect(seen.some((n) => n > 0 && n < 100)).toBe(true)
    const buffer = await readFile((await download.path())!)
    const backup = JSON.parse(
      Buffer.from(unzipSync(buffer)['manifest.json']).toString(),
    )
    expect(backup.images).toHaveLength(2)
    expect(
      backup.images.find((image: any) => image.id === 'input').file,
    ).toMatch(/^inputs\//)
    expect(
      backup.images.find((image: any) => image.id === 'output').file,
    ).toMatch(/^outputs\//)
    await expect(page.locator('#exportProgress')).toBeHidden()
    page.on('dialog', (dialog) =>
      dialog.accept(dialog.type() === 'prompt' ? '合并' : undefined),
    )
    await page.locator('#workspaceImportFile').setInputFiles({
      name: 'roundtrip.zip',
      mimeType: 'application/zip',
      buffer,
    })
    await expect(page.locator('#toast')).toContainText('合并导入')
    await expect(page.locator('#importProgress')).toBeHidden()
    const positions = await page.evaluate(
      () => (window as any).transferPositions,
    )
    expect(positions.importProgress).toEqual(positions.exportProgress)
    expect(positions.importProgress.outsideSettings).toBe(true)
    await expect(page.locator('.message')).toHaveCount(2)
  })

  test(`${version} 长关键词与详情操作分行, 关闭按钮不弹多余提示`, async ({
    page,
  }) => {
    await open(page, url)
    await page.locator('[data-view="image"]').click()
    await page.locator('.history-image-button').click()
    await expect(page.locator('#imageLightbox')).toBeVisible()
    const prompt = (await page.locator('#lightboxPrompt').boundingBox())!
    const footer = (await page.locator('.lightbox-footer').boundingBox())!
    const actions = (await page.locator('.lightbox-actions').boundingBox())!
    expect(prompt.width).toBeGreaterThan(footer.width * 0.9)
    expect(prompt.height).toBeLessThanOrEqual(100)
    expect(actions.y).toBeGreaterThanOrEqual(prompt.y + prompt.height)
    await page.locator('#closeLightbox').hover()
    await expect(page.locator('.custom-tooltip.show')).toHaveCount(0)
    await page.screenshot({
      path: `.cache/screens/chat-ui-details-${version}.png`,
    })
  })
  test(`${version} 阅读历史时可回到底部, Agent 等图状态文字不会挤成竖排`, async ({
    page,
  }) => {
    await open(page, url)
    await page.route('https://chat-ui.test/**', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') {
        await route.fulfill({ json: { data: [] } })
        return
      }
      const body = request.postDataJSON()
      if (request.url().includes('/images/')) {
        await new Promise((resolve) => setTimeout(resolve, 500))
        await route.fulfill({
          json: {
            data: [
              {
                b64_json:
                  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGOQAAAAASUVORK5CYII=',
              },
            ],
          },
        })
      } else if (
        body.tools &&
        !body.messages.some((message: any) => message.role === 'tool')
      ) {
        await route.fulfill({
          json: {
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'call',
                      type: 'function',
                      function: {
                        name: 'generate_image',
                        arguments: JSON.stringify({
                          prompt: '长提示词与状态应该正常排列 '.repeat(40),
                          reference_image_ids: [],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        })
      } else
        await route.fulfill({
          json: {
            choices: [
              { message: { content: '一段很长的回复\n\n'.repeat(120) } },
            ],
          },
        })
    })
    await page.locator('#messageInput').fill('长回复')
    await page.locator('#sendButton').click()
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
    const stage = page.locator('.content-stage')
    await stage.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(page.locator('#scrollChatBottom')).toBeVisible()
    await page.locator('#scrollChatBottom').click()
    await expect
      .poll(() =>
        stage.evaluate(
          (el) => el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      )
      .toBeLessThan(80)
    await expect(page.locator('#scrollChatBottom')).toBeHidden()
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('orbit-chat-state-v1')!)
      Object.assign(state.settings, {
        imageBaseUrl: 'https://chat-ui.test/v1',
        imageApiKey: 'test',
        imageModel: 'image-test',
        chatImageTools: true,
      })
      if (state.conversations[0].chatContext)
        state.conversations[0].chatContext.settings.chatImageTools = true
      localStorage.setItem('orbit-chat-state-v1', JSON.stringify(state))
    })
    await page.reload()
    await page.locator('[data-view="chat"]').click()
    await page.locator('#messageInput').fill('帮我生成猫图')
    await page.locator('#sendButton').click()
    const status = page.locator('.agent-activity > span:nth-child(2)')
    await expect(status).toHaveText('正在生成图片')
    const rect = (await status.boundingBox())!
    expect(rect.width).toBeGreaterThan(60)
    expect(rect.height).toBeLessThan(25)
    await expect(page.locator('#sendButton')).not.toHaveClass(/is-stop/)
  })
}
