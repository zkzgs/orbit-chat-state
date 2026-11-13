import { test, expect } from '@playwright/test'
import { remapAgentMessage, runImageAgent } from '../src/api/image-agent.js'

function call(id: string, name: string, args: object) {
  return {
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  }
}

test('Agent 步骤按轮次保留思考、工具、等待、图片和重试', async () => {
  const collected: string[][] = []
  const requests: any[] = []
  let lastSteps: any[] = []
  const result = await runImageAgent({
    settings: {
      chatBaseUrl: 'https://api.example.com/chat/completions',
      chatSendReasoning: true,
      imageAgentPreview: true,
      imageAgentRetryErrors: true,
      imageAgentRetryMismatch: true,
      imageAgentRetryLimit: 5,
    },
    messages: [{ role: 'user', content: '生成一只猫' }],
    imageIds: [],
    signal: new AbortController().signal,
    fetch: async (_: string, { body }: any) => {
      const request = JSON.parse(body)
      requests.push(request)
      const tools = request.messages.filter((item: any) => item.role === 'tool')
      if (!tools.length)
        return Response.json({
          choices: [
            {
              message: {
                reasoning_content: '先生成一只猫',
                tool_calls: [
                  call('gen-1', 'generate_image', {
                    prompt: '一只猫',
                    reference_image_ids: [],
                  }),
                ],
              },
            },
          ],
        })
      if (tools.length === 1)
        return Response.json({
          choices: [
            {
              message: {
                reasoning_content: '帽子不对，需要重试',
                tool_calls: [
                  call('retry-1', 'retry_image', {
                    tool_call_id: 'gen-1',
                    prompt: '一只戴红帽的猫',
                  }),
                ],
              },
            },
          ],
        })
      return Response.json({
        choices: [{ message: { content: '已按要求重试完成' } }],
      })
    },
    generate: async (prompt: string) => ({
      status: 'success',
      imageIds: [prompt.includes('红帽') ? 'img-retry' : 'img-1'],
    }),
    preview: async () => 'data:image/png;base64,test',
    onRound: () => {},
    onSteps: (steps: any[]) => {
      lastSteps = steps
      collected.push(steps.map((step) => step.type))
    },
  })
  const final = collected.at(-1) || []
  expect(result.content).toBe('已按要求重试完成')
  expect(requests).toHaveLength(3)
  expect(
    requests[1].messages.some(
      (item: any) =>
        item.role === 'assistant' &&
        item.reasoning_content === '先生成一只猫' &&
        item.tool_calls?.[0]?.function?.name === 'generate_image',
    ),
  ).toBe(true)
  expect(
    requests[2].messages.some(
      (item: any) =>
        item.role === 'assistant' &&
        item.reasoning_content === '帽子不对，需要重试' &&
        item.tool_calls?.[0]?.function?.name === 'retry_image',
    ),
  ).toBe(true)
  expect(JSON.parse(requests[1].messages.find((item: any) => item.role === 'tool').content).retryRemaining).toBe(5)
  expect(lastSteps.filter((step) => step.type === 'waiting').every((step) => step.endedAt)).toBe(true)
  expect(final).toEqual([
    'thinking',
    'tool_call',
    'waiting',
    'image',
    'thinking',
    'retry',
    'waiting',
    'image',
    'summary',
  ])
  const last = (run: any) => run
  const snapshot = collected
    .map((types) => types.join('>'))
    .filter((item, index, list) => list[index - 1] !== item)
  expect(snapshot.join(' | ')).toContain('thinking>tool_call>waiting')
  expect(snapshot.join(' | ')).toContain('waiting>image')
  expect(snapshot.at(-1)).toBe(final.join('>'))
  const message = {
    toolRounds: [
      {
        assistant: {
          role: 'assistant',
          content: null,
          tool_calls: [
            call('ok', 'generate_image', {
              prompt: '猫',
              reference_image_ids: ['a'],
            }),
          ],
        },
        results: [
          {
            role: 'tool',
            tool_call_id: 'ok',
            content: JSON.stringify({ imageIds: ['b'] }),
          },
        ],
      },
    ],
    steps: [{ type: 'image', imageIds: ['b'] }],
  }
  remapAgentMessage(message, (ids: string[]) => ids.map((id) => 'new-' + id))
  expect(message.steps[0].imageIds).toEqual(['new-b'])
  void last
})
