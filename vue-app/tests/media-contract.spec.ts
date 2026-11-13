import { test, expect } from '@playwright/test'

for (const url of ['/index.html', '/vue-app/dist/index.html']) {
  test(url + ' 视频轮询、失败、取消和多图字段', async ({ page }) => {
    await page.goto(url)
    const result = await page.evaluate(async () => {
      const { nativeMediaRequest, requestNativeMedia } =
        await import('/vue-app/src/api/native-media.js')
      const settings = {
        imageProvider: 'xai',
        imageBaseUrl: 'https://video.test/v1',
        imageApiKey: 'test',
      }
      const config = {
        provider: 'xai',
        mediaType: 'video',
        model: 'grok-imagine-video',
        videoDuration: 6,
        videoResolution: '720p',
        ratio: '16:9',
        count: 1,
      }
      const refs = [
        { data: 'data:image/png;base64,A' },
        { data: 'data:image/png;base64,B' },
      ]
      const body = nativeMediaRequest(settings, config, 'test', refs).body
      const image = nativeMediaRequest(
        settings,
        { ...config, mediaType: 'image', sizeMode: 'ratio', resolution: '2K' },
        '[image 1] / [image 2]',
        refs,
      ).body
      const original = setTimeout
      window.setTimeout = ((
        work: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) =>
        original(
          work,
          delay === 3000 ? 1 : delay,
          ...args,
        )) as typeof setTimeout
      const phases: string[] = []
      const remotes: any[] = []
      let count = 0
      const success = await requestNativeMedia(
        async (endpoint: string) => {
          count++
          return new Response(
            JSON.stringify(
              count === 1
                ? { request_id: 'job' }
                : count === 2
                  ? { status: 'pending', progress: 50 }
                  : {
                      status: 'done',
                      video: {
                        url: 'https://video.test/file.mp4',
                        duration: 6,
                      },
                    },
            ),
            { headers: { 'content-type': 'application/json' } },
          )
        },
        settings,
        config,
        'test',
        [],
        new AbortController().signal,
        (phase: string) => phases.push(phase),
        () => {},
        (remote: any) => remotes.push(remote),
      )
      let failure: any
      count = 0
      try {
        await requestNativeMedia(
          async () =>
            new Response(
              JSON.stringify(
                ++count === 1
                  ? { request_id: 'bad' }
                  : { status: 'failed', error: { message: '风控拒绝' } },
              ),
            ),
          settings,
          config,
          'test',
          [],
          new AbortController().signal,
        )
      } catch (error: any) {
        failure = {
          message: error.message,
          events: error.upstream.responses.length,
        }
      }
      const controller = new AbortController()
      let aborted = false
      try {
        await requestNativeMedia(
          async () => {
            controller.abort()
            return new Response(JSON.stringify({ request_id: 'cancel' }))
          },
          settings,
          config,
          'test',
          [],
          controller.signal,
        )
      } catch {
        aborted = true
      }
      return { body, image, success, phases, remotes, failure, aborted }
    })
    expect(result.body.reference_images).toHaveLength(2)
    expect(result.body).not.toHaveProperty('image')
    expect(result.body.duration).toBe(6)
    expect(result.image.images).toHaveLength(2)
    expect(result.image.prompt).toBe('<IMAGE_0> / <IMAGE_1>')
    expect(result.image.resolution).toBe('2k')
    expect(result.success.images[0].responseMeta.mediaType).toBe('video')
    expect(result.success.upstream.responses).toHaveLength(3)
    expect(result.remotes[0].requestId).toBe('job')
    expect(result.failure).toEqual({ message: '风控拒绝', events: 2 })
    expect(result.aborted).toBe(true)
  })
  test(url + ' Agent 工具失败和未完成记录可重放', async ({ page }) => {
    await page.goto(url)
    const result = await page.evaluate(async () => {
      const { runImageAgent, agentMessages, remapAgentMessage, agentImageIds } =
        await import('/vue-app/src/api/image-agent.js')
      let requests = 0
      let generated = 0
      const rounds: any[] = []
      const response = await runImageAgent({
        settings: {
          chatModel: 'chat',
          chatBaseUrl: 'https://agent.test',
          chatApiKey: 'test',
        },
        messages: [{ role: 'user', content: '画猫' }],
        imageIds: ['allowed'],
        signal: new AbortController().signal,
        fetch: async () =>
          new Response(
            JSON.stringify({
              choices: [
                {
                  message:
                    ++requests === 1
                      ? {
                          tool_calls: [
                            {
                              id: 'call',
                              type: 'function',
                              function: {
                                name: 'generate_image',
                                arguments: JSON.stringify({
                                  prompt: '猫',
                                  reference_image_ids: ['foreign'],
                                }),
                              },
                            },
                          ],
                        }
                      : { content: '参考图不属于当前对话' },
                },
              ],
            }),
          ),
        generate: async () => {
          generated++
          return { imageIds: [] }
        },
        onRound: (round: any) => rounds.push(round),
      })
      const message = { toolRounds: rounds }
      const replay = agentMessages(message)
      const interrupted = agentMessages({
        toolRounds: [{ assistant: rounds[0].assistant, results: [] }],
      })
      const valid = {
        toolRounds: [
          {
            assistant: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'ok',
                  type: 'function',
                  function: {
                    name: 'generate_image',
                    arguments: JSON.stringify({
                      prompt: '猫',
                      reference_image_ids: ['a'],
                    }),
                  },
                },
              ],
            },
            results: [
              {
                role: 'tool',
                tool_call_id: 'ok',
                content: JSON.stringify({ imageIds: ['b'], status: 'success' }),
              },
            ],
          },
        ],
      }
      remapAgentMessage(valid, (ids: string[]) => ids.map((id) => 'new-' + id))
      return {
        response,
        generated,
        replay,
        interrupted,
        ids: agentImageIds(valid),
      }
    })
    expect(result.generated).toBe(0)
    expect(result.response.content).toContain('不属于当前对话')
    expect(JSON.parse(result.replay[1].content).status).toBe('error')
    expect(JSON.parse(result.interrupted[1].content).error).toContain('已中断')
    expect(result.ids).toEqual(['new-a', 'new-b'])
  })
}
