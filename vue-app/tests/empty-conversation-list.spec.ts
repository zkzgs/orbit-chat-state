import { test, expect, type Page } from '@playwright/test'

async function open(page: Page, url: string) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('orbit-chat-state-v1')) {
      localStorage.setItem(
        'orbit-chat-state-v1',
        JSON.stringify({
          settings: { demoMode: true },
          contextMode: 'client',
          conversations: [
            {
              id: 'conversation-test',
              title: '新对话',
              createdAt: 1,
              messages: [],
            },
          ],
          activeConversationId: 'conversation-test',
        }),
      )
    }
  })
  await page.goto(url)
  await expect(page.locator('#imageView')).toBeVisible()
  await page.locator('[data-view="chat"]').click()
}

function storedConversations(page: Page) {
  return page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem('orbit-chat-state-v1') || '{}')
        .conversations || []
    ).map((item: { id: string; title: string; messages: unknown[] }) => ({
      id: item.id,
      title: item.title,
      messageCount: item.messages?.length || 0,
    })),
  )
}

for (const [version, url] of [
  ['HTML', '/index.html'],
  ['Vue', '/vue-app/dist/index.html'],
]) {
  test(`${version} 空的新对话不进入侧栏, 发出首条消息后才出现`, async ({
    page,
  }) => {
    await open(page, url)
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(0)
    await expect(page.locator('#conversationCount')).toHaveText('0')
    await expect(page.locator('#messageInput')).toBeVisible()
    for (let index = 0; index < 3; index++)
      await page.locator('#newChatButton').click()
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(0)
    await expect
      .poll(() => storedConversations(page))
      .toEqual([
        {
          id: 'conversation-test',
          title: '新对话',
          messageCount: 0,
        },
      ])

    await page.locator('#messageInput').fill('第一条有效对话')
    await page.locator('#sendButton').click()
    const firstItem = page
      .locator('#conversationList .conversation-item')
      .filter({ hasText: '第一条有效对话' })
    await expect(firstItem).toHaveCount(1)
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(1)
    await expect(page.locator('#conversationCount')).toHaveText('1')

    await page.locator('#newChatButton').click()
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(1)
    await expect(page.locator('.message')).toHaveCount(0)
    await expect(page.locator('#messageInput')).toHaveValue('')
    await expect
      .poll(async () => (await storedConversations(page)).length)
      .toBe(2)
    await expect
      .poll(
        async () =>
          (await storedConversations(page)).filter(
            (item) => item.messageCount === 0,
          ).length,
      )
      .toBe(1)

    await firstItem.click()
    await expect(page.locator('.message.user')).toContainText('第一条有效对话')
    await expect
      .poll(async () => (await storedConversations(page)).length)
      .toBe(1)

    await page.locator('#newChatButton').click()
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(1)
    await expect(page.locator('.message')).toHaveCount(0)
    await page.locator('#messageInput').fill('第二条有效对话')
    await page.locator('#sendButton').click()
    await expect(
      page
        .locator('#conversationList .conversation-item')
        .filter({ hasText: '第二条有效对话' }),
    ).toBeVisible()
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(2)
    await expect(page.locator('#conversationCount')).toHaveText('2')
  })

  test(`${version} 空对话切走后保留输入草稿, 新建对话可回到该草稿`, async ({
    page,
  }) => {
    await open(page, url)
    await page.locator('#messageInput').fill('已有对话')
    await page.locator('#sendButton').click()
    const listed = page
      .locator('#conversationList .conversation-item')
      .filter({ hasText: '已有对话' })
    await expect(listed).toHaveCount(1)

    await page.locator('#newChatButton').click()
    await expect(page.locator('.message')).toHaveCount(0)
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(1)
    await page.locator('#messageInput').fill('还没发出的草稿')
    await expect(page.locator('#messageInput')).toHaveValue('还没发出的草稿')

    await listed.click()
    await expect(page.locator('.message.user')).toContainText('已有对话')
    await expect(page.locator('#messageInput')).toHaveValue('')
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(1)
    await expect
      .poll(async () => (await storedConversations(page)).length)
      .toBe(2)
    await expect
      .poll(
        async () =>
          (await storedConversations(page)).filter(
            (item) => item.messageCount === 0,
          ).length,
      )
      .toBe(1)

    await page.locator('#newChatButton').click()
    await expect(page.locator('.message')).toHaveCount(0)
    await expect(page.locator('#messageInput')).toHaveValue('还没发出的草稿')
    await expect(
      page.locator('#conversationList .conversation-item'),
    ).toHaveCount(1)
    await expect
      .poll(async () => (await storedConversations(page)).length)
      .toBe(2)
  })
}
