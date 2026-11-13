export function agentImageFields(
  provider = 'openai',
  models = [],
  currentModel = '',
) {
  const select = (key, label, values, value = values[0]) => ({
    key,
    label,
    value,
    options: values.map((item) => ({
      value: item,
      label:
        {
          auto: '自动',
          low: key === 'moderation' ? '宽松' : '低',
          medium: '中',
          high: '高',
          xhigh: '极高',
          max: '最高',
          standard: '标准, DALL-E',
          hd: 'HD, DALL-E',
          opaque: '不透明',
          transparent: '透明',
          png: 'PNG',
          jpeg: 'JPEG',
          webp: 'WebP',
          gif: 'GIF',
          svg: 'SVG',
        }[item] || item,
    })),
  })
  const number = (key, label, value, min, max) => ({
    key,
    label,
    value,
    min,
    max,
  })
  /** @type {Array<{ key: string, label: string, value: string | number, options?: { value: string, label: string }[], min?: number, max?: number }>} */
  const fields = [
    select(
      'sizeMode',
      '尺寸方式',
      provider === 'openai' ? ['auto', 'ratio', 'custom'] : ['auto', 'ratio'],
    ),
    select(
      'resolution',
      '分辨率',
      provider === 'xai' ? ['1K', '1.5K', '2K'] : ['1K', '2K', '4K'],
    ),
    select('ratio', '比例', [
      'auto',
      '1:1',
      '3:2',
      '2:3',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '21:9',
    ]),
  ]
  const availableModels = [
    ...new Set([currentModel, ...models].filter(Boolean)),
  ]
  if (availableModels.length)
    fields.unshift(
      select(
        'model',
        '模型',
        availableModels,
        currentModel || availableModels[0],
      ),
    )
  const sizeMode = fields.find((field) => field.key === 'sizeMode')
  sizeMode.options = sizeMode.options.map((item) => ({
    ...item,
    label: { auto: '自动', ratio: '按比例', custom: '自定义宽高' }[item.value],
  }))
  if (provider === 'openai')
    fields.push(
      number('width', '宽度 (px)', 1024, 16, 3840),
      number('height', '高度 (px)', 1024, 16, 3840),
      select('quality', '质量', [
        'auto',
        'low',
        'medium',
        'high',
        'xhigh',
        'max',
        'standard',
        'hd',
      ]),
      select('reasoningEffort', '思考', ['auto', 'low', 'medium', 'high']),
      select('format', '格式', ['png', 'jpeg', 'webp', 'gif', 'svg']),
      number('compression', '输出压缩 (%)', 0, 0, 100),
      select('background', '输出透明度', ['auto', 'opaque', 'transparent']),
      select('moderation', '审核', ['auto', 'low']),
    )
  fields.push(number('count', '数量', 1, 1, 10))
  return fields
}

/** @returns {Record<string, string | number>} */
export function resolveAgentImageOptions(
  provider,
  values = {},
  models = [],
  currentModel = '',
) {
  // 不接收接口和底层提交策略; 模型仅限当前接口可用值。
  const options = {
    width: 1024,
    height: 1024,
    quality: 'auto',
    reasoningEffort: 'auto',
    format: 'png',
    compression: 0,
    background: 'auto',
    moderation: 'auto',
  }
  for (const field of agentImageFields(provider, models, currentModel)) {
    const value = values[field.key] ?? field.value
    if (
      field.options
        ? !field.options.some((item) => item.value === value)
        : !Number.isInteger(value) || value < field.min || value > field.max
    )
      throw new Error(`生图参数“${field.label}”无效`)
    options[field.key] = value
  }
  return options
}

function configuredImageTool(tool, provider, models, currentModel) {
  const fields = agentImageFields(provider, models, currentModel)
  return {
    ...tool,
    function: {
      ...tool.function,
      description:
        tool.function.description +
        ' 自行决定本次 image_options, 不沿用工作区参数; model 只能从用户配置的可用模型中选择。',
      parameters: {
        ...tool.function.parameters,
        properties: {
          ...tool.function.parameters.properties,
          image_options: {
            type: 'object',
            description:
              '当次生图参数。sizeMode=auto 时不指定尺寸; ratio 按比例和分辨率, custom 按宽高。只填写当前接口和模型支持的参数值。',
            properties: Object.fromEntries(
              fields.map((field) => [
                field.key,
                field.options
                  ? {
                      type: 'string',
                      enum: field.options.map((item) => item.value),
                      description: field.label,
                    }
                  : {
                      type: 'integer',
                      minimum: field.min,
                      maximum: field.max,
                      description: field.label,
                    },
              ]),
            ),
            required: fields.map((field) => field.key),
            additionalProperties: false,
          },
        },
        required: [...tool.function.parameters.required, 'image_options'],
      },
    },
  }
}

const imageTool = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      '按用户要求生成或编辑图片。使用当前生图接口配置。参考图只能从当前对话提供的图片 ID 中选择。',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '完整图片提示词, 按参考图片顺序使用 [image 1] 等标记',
        },
        reference_image_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '需要作为参考的图片 ID, 无参考图时传空数组',
        },
      },
      required: ['prompt', 'reference_image_ids'],
      additionalProperties: false,
    },
  },
}

const retryTool = {
  type: 'function',
  function: {
    name: 'retry_image',
    description:
      '由对话模型判断重试本轮失败或效果不符的图片任务, 沿用原参考图, 生图参数按当前策略选择。',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        tool_call_id: {
          type: 'string',
          description:
            '原样填写本轮工具结果中的 retry_tool_call_id, 不要使用 taskId 或图片 ID。只在本次用户消息的工具流程内有效。',
        },
        prompt: {
          type: 'string',
          description: '重试的完整图片提示词, 可根据结果修正',
        },
      },
      required: ['tool_call_id', 'prompt'],
      additionalProperties: false,
    },
  },
}

export function chatReasoningMessages(messages, settings) {
  if (settings.chatSendReasoning) return messages
  return messages.map(({ reasoning_content, ...message }) => message)
}

export async function requestToolChat(
  fetchApi,
  settings,
  messages,
  signal,
  onChunk,
  onUnsupportedSearch,
  tools = [imageTool],
) {
  const body = {
    model: settings.chatModel,
    messages: chatReasoningMessages(messages, settings),
    ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    stream: Boolean(onChunk),
  }
  if (settings.reasoningEffort && settings.reasoningEffort !== 'auto')
    body.reasoning_effort = settings.reasoningEffort
  if (settings.chatWebSearch) body.web_search_options = {}
  const send = () =>
    fetchApi(
      settings.chatBaseUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.chatApiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      },
      settings,
    )
  let response = await send()
  if (
    !response.ok &&
    body.web_search_options &&
    [400, 404, 422].includes(response.status)
  ) {
    delete body.web_search_options
    onUnsupportedSearch?.()
    response = await send()
  }
  if (!response.ok) {
    const raw = await response.text()
    let message = raw.slice(0, 500)
    try {
      message = JSON.parse(raw).error?.message || message
    } catch {}
    throw new Error(message || `接口返回 ${response.status}`)
  }
  let content = '',
    reasoning = ''
  const calls = new Map()
  function consume(message, delta = false) {
    const text =
      typeof message?.content === 'string'
        ? message.content
        : (message?.content || []).map((part) => part.text || '').join('')
    content += text
    reasoning +=
      message?.reasoning_content ||
      message?.reasoning_text ||
      (typeof message?.reasoning === 'string' ? message.reasoning : '') ||
      ''
    for (const [index, call] of (message?.tool_calls || []).entries()) {
      const key = call.index ?? index
      const previous = calls.get(key) || {
        id: '',
        type: 'function',
        function: { name: '', arguments: '' },
      }
      if (call.id) previous.id = call.id
      if (call.type) previous.type = call.type
      if (call.function?.name)
        previous.function.name = delta
          ? previous.function.name + call.function.name
          : call.function.name
      if (call.function?.arguments)
        previous.function.arguments = delta
          ? previous.function.arguments + call.function.arguments
          : call.function.arguments
      calls.set(key, previous)
    }
    onChunk?.(content, reasoning)
  }
  if (
    response.headers.get('content-type')?.includes('text/event-stream') &&
    response.body
  ) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '',
      done = false
    const line = (value) => {
      if (!value.trim().startsWith('data:')) return
      const data = value.trim().slice(5).trim()
      if (data === '[DONE]') {
        done = true
        return
      }
      if (!data) return
      let payload
      try {
        payload = JSON.parse(data)
      } catch {
        return
      }
      if (payload.error)
        throw new Error(payload.error.message || '对话请求失败')
      consume(
        payload.choices?.[0]?.delta || payload.choices?.[0]?.message,
        true,
      )
    }
    try {
      while (!done) {
        const next = await reader.read()
        buffer += decoder.decode(next.value, { stream: !next.done })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const item of lines) {
          line(item)
          if (done) break
        }
        if (next.done) {
          if (buffer.trim() && !done) line(buffer)
          break
        }
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  } else {
    const payload = await response.json()
    if (payload.error) throw new Error(payload.error.message || '对话请求失败')
    consume(payload.choices?.[0]?.message)
  }
  const tool_calls = [...calls.values()]
  if (!content && !reasoning && !tool_calls.length)
    throw new Error('接口没有返回可显示的内容')
  return { content, reasoning, tool_calls }
}

export async function runImageAgent(options) {
  const messages = [...options.messages]
  const available = new Set(options.imageIds)
  const retryErrors = Boolean(options.settings.imageAgentRetryErrors)
  const retryMismatch = Boolean(
    options.settings.imageAgentRetryMismatch &&
    options.settings.imageAgentPreview,
  )
  const retryLimit = options.settings.imageAgentRetryLimit ?? 2
  const allowRetry = (retryErrors || retryMismatch) && retryLimit > 0
  const autoParameters = Boolean(options.settings.imageAgentAutoParameters)
  const imageModels = [
    ...new Set(
      [options.settings.imageModel, ...(options.imageModels || [])].filter(
        Boolean,
      ),
    ),
  ]
  const tools = (allowRetry ? [imageTool, retryTool] : [imageTool]).map(
    (tool) =>
      autoParameters
        ? configuredImageTool(
            tool,
            options.settings.imageProvider,
            imageModels,
            options.settings.imageModel,
          )
        : tool,
  )
  const attempts = new Map()
  let retries = 0
  messages.unshift({
    role: 'system',
    content: `只有用户要求生图或改图时才使用 generate_image, 日常聊天直接回答。可引用的当前对话图片 ID: ${[...available].join(', ') || '无'}。工具成功后按返回结果回答, 不要虚构图片链接。${options.settings.imageAgentInstruction ? `\n\n用户补充要求: ${options.settings.imageAgentInstruction}` : ''}`,
  })
  messages[0].content += allowRetry
    ? `\n用户允许你判断是否重试图片任务: 失败后重试${retryErrors ? '允许' : '不允许'}, 效果不符时重试${retryMismatch ? '允许' : '不允许'}。本轮最多额外重试 ${retryLimit} 次, 共用次数。工具返回后仍在同一次用户消息的工具流程中, 可以继续检查结果并调用 retry_image。tool_call_id 必须原样使用工具结果中的 retry_tool_call_id, 不要猜测或使用 taskId、图片 ID。该句柄只在本次流程内有效, 跨用户消息继续改图请引用图片 ID 调用 generate_image。重试沿用原参考图并可修正提示词。不要把重试伪装成 generate_image 新任务; 达到上限后如实说明。没有结果预览时不要声称检查过画面。`
    : '\n用户未允许本轮图片重试, 不要因生成失败或效果不满自行再次生图。'
  messages[0].content += autoParameters
    ? `\n当前默认生图模型为 ${options.settings.imageModel}。根据用户要求选择每次 image_options, model 只能从用户可用模型列表中选, 重试时也可修正参数。接口、数量提交策略、背景实现策略和请求图片压缩由客户端控制。`
    : '\n生图参数沿用用户的生图工作区配置, 不要自行设置 image_options。'
  let used = 0
  const rounds = 5 + (allowRetry ? retryLimit : 0)
  for (let index = 0; index < rounds; index++) {
    if (options.signal.aborted) throw options.signal.reason
    options.onStatus?.({ status: '正在等待对话模型', prompt: '' })
    const result = await requestToolChat(
      options.fetch,
      options.settings,
      messages,
      options.signal,
      options.onChunk,
      options.onUnsupportedSearch,
      index === rounds - 1 ? [] : tools,
    )
    if (!result.tool_calls.length) return result
    if (index === rounds - 1) throw new Error('已达到本轮图片工具调用上限')
    const assistant = {
      role: 'assistant',
      content: result.content || null,
      ...(result.reasoning ? { reasoning_content: result.reasoning } : {}),
      tool_calls: result.tool_calls,
    }
    const results = []
    const previewIds = []
    messages.push(assistant)
    for (const call of result.tool_calls) {
      let output
      let retryId
      try {
        if (
          call.type !== 'function' ||
          !['generate_image', 'retry_image'].includes(call.function.name)
        )
          throw new Error('未知工具')
        const args = JSON.parse(call.function.arguments)
        if (!args.prompt?.trim()) throw new Error('图片工具参数不完整')
        let ids
        const isRetry = call.function.name === 'retry_image'
        if (isRetry) {
          const previous = attempts.get(args.tool_call_id)
          if (!previous)
            throw new Error(
              '只能重试本轮已执行的图片任务, 请原样使用工具结果中的 retry_tool_call_id, 不要使用 taskId 或图片 ID',
            )
          if (previous.hasImages ? !retryMismatch : !retryErrors)
            throw new Error(
              previous.hasImages
                ? '未允许效果不符时重试, 或未开启结果预览'
                : '未允许生图失败后重试',
            )
          if (retries >= retryLimit)
            throw new Error('本轮图片重试次数已达到上限')
          ids = previous.ids
        } else {
          if (used >= 8) throw new Error('本轮图片生成次数已达到上限')
          ids = args.reference_image_ids
        }
        if (!Array.isArray(ids)) throw new Error('图片工具参数不完整')
        if (ids.length > 16 || ids.some((id) => !available.has(id)))
          throw new Error('参考图不属于当前对话或数量超过限制')
        const parameters = autoParameters
          ? resolveAgentImageOptions(
              options.settings.imageProvider,
              args.image_options,
              imageModels,
              options.settings.imageModel,
            )
          : undefined
        if (isRetry) retries++
        else used++
        const attempt = { ids, hasImages: false }
        retryId = isRetry ? args.tool_call_id : call.id
        attempts.set(retryId, attempt)
        options.onStatus?.({
          status: isRetry
            ? `正在重试图片 (${retries}/${retryLimit})`
            : '正在生成图片',
          prompt: args.prompt,
        })
        output = await options.generate(args.prompt, ids, parameters)
        if (!output) throw new Error('生成任务已中止')
        attempt.hasImages = Boolean(output.imageIds?.length)
        for (const id of output.imageIds || []) available.add(id)
        if (options.settings.imageAgentPreview)
          previewIds.push(...(output.imageIds || []))
        options.onStatus?.({
          status: attempt.hasImages
            ? '图片已生成, 正在整理回复'
            : '图片生成失败, 正在等待对话模型',
          prompt: '',
        })
      } catch (error) {
        if (options.signal.aborted) throw options.signal.reason
        output = { status: 'error', error: error.message, imageIds: [] }
      }
      if (allowRetry)
        output = {
          ...output,
          ...(retryId ? { retry_tool_call_id: retryId } : {}),
          retryRemaining: Math.max(0, retryLimit - retries),
        }
      const tool = {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output),
      }
      results.push(tool)
      messages.push(tool)
      // 每次工具完成即保存, 后续对话失败也不会丢失已生成的图片。
      await options.onRound({ assistant, results: [...results] })
    }
    if (previewIds.length) {
      const content = []
      for (const id of new Set(previewIds)) {
        if (options.signal.aborted) throw options.signal.reason
        try {
          const url = await options.preview(id)
          content.push(
            { type: 'text', text: `生成结果图片 ID: ${id}` },
            { type: 'image_url', image_url: { url } },
          )
        } catch (error) {
          if (options.signal.aborted) throw options.signal.reason
          content.push({
            type: 'text',
            text: `生成结果图片 ID: ${id}, 预览读取失败, 请勿据此重新生成`,
          })
        }
      }
      // 预览只用于本轮检查, 历史仍保存图片 ID 和工具结果。
      messages.push({ role: 'user', content })
    }
  }
  throw new Error('已达到本轮图片工具调用上限')
}

export function agentMessages(message) {
  return (message.toolRounds || []).flatMap((round) => [
    round.assistant,
    ...round.assistant.tool_calls.map(
      (call) =>
        round.results.find((item) => item.tool_call_id === call.id) || {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            status: 'error',
            error: '上次工具调用已中断',
            imageIds: [],
          }),
        },
    ),
  ])
}

export function agentImageIds(message) {
  const ids = []
  for (const round of message.toolRounds || []) {
    for (const call of round.assistant.tool_calls) {
      if (call.function.name !== 'generate_image') continue
      try {
        ids.push(
          ...(JSON.parse(call.function.arguments).reference_image_ids || []),
        )
      } catch {}
    }
    for (const result of round.results) {
      try {
        ids.push(...(JSON.parse(result.content).imageIds || []))
      } catch {}
    }
  }
  return ids
}

export function remapAgentMessage(message, remap) {
  for (const round of message.toolRounds || []) {
    for (const call of round.assistant.tool_calls) {
      if (call.function.name !== 'generate_image') continue
      try {
        const args = JSON.parse(call.function.arguments)
        args.reference_image_ids = remap(args.reference_image_ids)
        call.function.arguments = JSON.stringify(args)
      } catch {}
    }
    for (const result of round.results) {
      try {
        const output = JSON.parse(result.content)
        output.imageIds = remap(output.imageIds)
        result.content = JSON.stringify(output)
      } catch {}
    }
  }
}
