const STORAGE_KEY = 'orbit-chat-state-v1';

const defaultState = {
  settings: {
    chatBaseUrl: '',
    chatApiKey: '',
    chatModel: 'gpt-4o-mini',
    imageBaseUrl: '',
    imageApiKey: '',
    imageModel: 'gpt-image-1',
    imageOptions: { ratio: 'auto', quality: 'auto', format: 'png', background: 'auto', moderation: 'auto', count: 1 },
    systemPrompt: '你是一位简洁, 直接的中文助手',
    reasoningEffort: 'auto',
    demoMode: true
  },
  contextMode: 'client',
  conversations: [],
  activeConversationId: null
};

let state = loadState();
let pendingAttachment = null;
let toastTimer = null;
let requestController = null;
let imageHistory = [];
let storedImages = new Map();
let editingMessageId = null;
let imageReferences = [];
let currentImage = null;

const IMAGE_DB_NAME = 'orbit-chat-images-v1';
const IMAGE_STORE_NAME = 'generations';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return createInitialState();
    return {
      ...defaultState,
      ...saved,
      settings: { ...defaultState.settings, ...(saved.settings || {}), imageOptions: { ...defaultState.settings.imageOptions, ...(saved.settings?.imageOptions || {}) } },
      conversations: Array.isArray(saved.conversations) ? saved.conversations : []
    };
  } catch (error) {
    return createInitialState();
  }
}

function createInitialState() {
  const id = createId();
  return {
    ...defaultState,
    settings: { ...defaultState.settings, imageOptions: { ...defaultState.settings.imageOptions } },
    conversations: [{ id, title: '新对话', createdAt: Date.now(), messages: [] }],
    activeConversationId: id
  };
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function openImageDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveImageHistory(image) {
  const db = await openImageDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(IMAGE_STORE_NAME, 'readwrite').objectStore(IMAGE_STORE_NAME).put(image);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function saveChatImage(src, name) {
  const record = { id: createId(), src, name, type: 'chat', createdAt: Date.now() };
  await saveImageHistory(record);
  storedImages.set(record.id, record);
  return record.id;
}

async function loadImageHistory() {
  try {
    const db = await openImageDb();
    const items = await new Promise((resolve, reject) => {
      const request = db.transaction(IMAGE_STORE_NAME, 'readonly').objectStore(IMAGE_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    storedImages = new Map(items.map((item) => [item.id, item]));
    imageHistory = items.filter((item) => item.type !== 'chat').sort((a, b) => b.createdAt - a.createdAt);
    renderImageHistory();
    renderMessages();
  } catch (error) {
    imageHistory = [];
  }
}

async function deleteImageHistory(id) {
  const db = await openImageDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(IMAGE_STORE_NAME, 'readwrite').objectStore(IMAGE_STORE_NAME).delete(id);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  imageHistory = imageHistory.filter((item) => item.id !== id);
  storedImages.delete(id);
  renderImageHistory();
}

async function clearStoredImages() {
  const db = await openImageDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(IMAGE_STORE_NAME, 'readwrite').objectStore(IMAGE_STORE_NAME).clear();
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  db.close();
  storedImages.clear();
  imageHistory = [];
}

function renderImageHistory() {
  const section = $('#imageHistorySection');
  const list = $('#imageHistory');
  if (!section || !list) return;
  section.hidden = imageHistory.length === 0;
  $('#imageHistoryCount').textContent = imageHistory.length;
  list.innerHTML = imageHistory.map((item) => `<article class="history-item"><button class="history-delete" data-history-id="${item.id}" title="删除记录" aria-label="删除记录">×</button><button class="history-image-button" data-history-image="${item.id}" aria-label="查看生成图片"><img src="${item.src}" alt="${escapeHtml(item.prompt)}"></button><div class="history-item-info"><div class="history-item-prompt">${escapeHtml(item.prompt)}</div><time class="history-item-time">${formatTime(item.createdAt)}</time></div><div class="history-actions"><button data-history-action="config" data-history-id="${item.id}" title="复制提示词, 参数和原参考图">复制配置</button><button data-history-action="edit" data-history-id="${item.id}" title="只把输出图带到新的生图任务">编辑输出</button><button data-history-action="new-chat" data-history-id="${item.id}">发到对话</button></div></article>`).join('');
  $$('.history-delete').forEach((button) => button.addEventListener('click', () => deleteImageHistory(button.dataset.historyId)));
  $$('.history-image-button').forEach((button) => button.addEventListener('click', () => {
    const item = imageHistory.find((entry) => entry.id === button.dataset.historyImage);
    if (item) openLightbox(item.src, item.prompt, item);
  }));
  $$('.history-actions button').forEach((button) => button.addEventListener('click', () => {
    const item = imageHistory.find((entry) => entry.id === button.dataset.historyId);
    if (!item) return;
    if (button.dataset.historyAction === 'config') applyImageConfig(item);
    if (button.dataset.historyAction === 'edit') editGeneratedImage(item);
    if (button.dataset.historyAction === 'new-chat') copyImageToNewChat(item);
  }));
}

function activeConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) || state.conversations[0];
}

function ensureActiveConversation() {
  if (!state.conversations.length) {
    const fresh = { id: createId(), title: '新对话', createdAt: Date.now(), messages: [] };
    state.conversations.push(fresh);
    state.activeConversationId = fresh.id;
  }
  if (!state.activeConversationId) state.activeConversationId = state.conversations[0].id;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function render() {
  ensureActiveConversation();
  renderConversations();
  renderMessages();
  $('#workspaceTitle').textContent = activeConversation().title;
  $('#modelBadge').textContent = state.settings.chatModel || 'gpt-4o-mini';
  renderConnection();
  $$('.context-option').forEach((button) => button.classList.toggle('active', button.dataset.context === state.contextMode));
  $('#contextDescription').textContent = state.contextMode === 'client' ? '每次请求带上本会话历史' : '每次只发送当前问题';
  setImageConfig(state.settings.imageOptions);
}

function renderConversations() {
  const list = $('#conversationList');
  $('#conversationCount').textContent = state.conversations.length;
  list.innerHTML = state.conversations
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((conversation) => `<button class="conversation-item ${conversation.id === state.activeConversationId ? 'active' : ''}" data-conversation-id="${conversation.id}"><span class="conversation-icon">${conversation.id === state.activeConversationId ? '●' : '○'}</span><span class="conversation-title">${escapeHtml(conversation.title)}</span></button>`)
    .join('');
  $$('.conversation-item').forEach((button) => button.addEventListener('click', () => {
    state.activeConversationId = button.dataset.conversationId;
    persist();
    render();
    $('#sidebar').classList.remove('open');
  }));
}

function renderMessages() {
  const conversation = activeConversation();
  const list = $('#messageList');
  const hasMessages = conversation.messages.length > 0;
  $('#welcomePanel').hidden = hasMessages;
  list.innerHTML = conversation.messages.map((message) => {
    const imageSrc = message.image || storedImages.get(message.imageHistoryId)?.src;
    const image = imageSrc ? `<img class="message-image" src="${imageSrc}" alt="用户上传的图片">` : '';
    const editAction = message.role === 'user' ? `<button class="message-action edit-message" data-message-id="${message.id}">修改</button>` : '';
    return `<article class="message ${message.role}"><div class="message-avatar">${message.role === 'assistant' ? 'O' : 'ME'}</div><div class="message-content"><div class="message-meta"><span class="message-role">${message.role === 'assistant' ? 'Orbit' : '你'}</span><span class="message-time">${formatTime(message.createdAt)}</span></div><div class="message-text">${escapeHtml(message.content)}</div>${image}<div class="message-actions">${editAction}<button class="message-action copy-message" data-message="${encodeURIComponent(message.content)}">复制</button></div></div></article>`;
  }).join('');
  $$('.copy-message').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(decodeURIComponent(button.dataset.message));
    showToast('已复制到剪贴板');
  }));
  $$('.edit-message').forEach((button) => button.addEventListener('click', () => beginMessageEdit(button.dataset.messageId)));
  const stage = $('.content-stage');
  if (hasMessages) requestAnimationFrame(() => { stage.scrollTop = stage.scrollHeight; });
}

function beginMessageEdit(messageId) {
  const message = activeConversation().messages.find((entry) => entry.id === messageId);
  if (!message) return;
  editingMessageId = messageId;
  $('#messageInput').value = message.content;
  autoResizeTextarea($('#messageInput'));
  clearAttachment();
  const imageSrc = message.image || storedImages.get(message.imageHistoryId)?.src;
  if (imageSrc) setChatAttachment(imageSrc, '原消息图片', message.imageHistoryId);
  $('#editingBanner').hidden = false;
  $('#messageInput').focus();
}

function cancelMessageEdit() {
  editingMessageId = null;
  $('#editingBanner').hidden = true;
  $('#messageInput').value = '';
  autoResizeTextarea($('#messageInput'));
  clearAttachment();
}

function setChatAttachment(data, name, imageHistoryId = '') {
  pendingAttachment = { data, name, imageHistoryId };
  $('#attachmentPreview').hidden = false;
  $('#attachmentPreview').innerHTML = `<img src="${data}" alt="待发送的图片"><button type="button" class="remove-attachment" aria-label="移除图片">×</button>`;
  $('.remove-attachment').addEventListener('click', clearAttachment);
}

function getImageConfig() {
  const config = {
    model: state.settings.imageModel,
    ratio: $('#imageRatio').value,
    quality: $('#imageQuality').value,
    format: $('#imageFormat').value,
    background: $('#imageBackground').value,
    moderation: $('#imageModeration').value,
    count: Math.min(10, Math.max(1, Number($('#imageCount').value) || 1))
  };
  state.settings.imageOptions = config;
  persist();
  return config;
}

function setImageConfig(config = {}) {
  if (config.model) state.settings.imageModel = config.model;
  if (config.ratio) $('#imageRatio').value = config.ratio;
  if (config.quality) $('#imageQuality').value = config.quality;
  if (config.format) $('#imageFormat').value = config.format;
  if (config.background) $('#imageBackground').value = config.background;
  if (config.moderation) $('#imageModeration').value = config.moderation;
  if (config.count) $('#imageCount').value = Math.min(10, Math.max(1, Number(config.count)));
  if (config.model) persist();
}

async function applyImageConfig(item) {
  $('#imagePrompt').value = item.prompt || '';
  setImageConfig(item.config);
  await setImageReferencesFromSources(item.referenceSources || []);
  setView('image');
  closeLightbox();
  $('#imagePrompt').focus();
  showToast('已复制提示词, 参数和原参考图');
}

async function copyImageToNewChat(item) {
  const imageHistoryId = item.id || await saveChatImage(item.src, 'generated-image');
  const conversation = { id: createId(), title: '图片对话', createdAt: Date.now(), messages: [] };
  state.conversations.push(conversation);
  state.activeConversationId = conversation.id;
  addMessage(createMessage('user', '请分析这张图片', '', imageHistoryId));
  closeLightbox();
  setView('chat');
  showToast('图片已复制到新对话');
}

function openLightbox(src, prompt = '', item = null) {
  currentImage = { ...(item || {}), src, prompt };
  $('#lightboxImage').src = src;
  $('#lightboxPrompt').textContent = prompt || '生成图片';
  $('#imageLightbox').hidden = false;
}

function closeLightbox() {
  $('#imageLightbox').hidden = true;
  $('#lightboxImage').src = '';
}

async function copyImageToClipboard(src) {
  try {
    const response = await fetch(src);
    const sourceBlob = await response.blob();
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('当前浏览器不支持图片剪贴板');
    const blob = sourceBlob.type === 'image/png' ? sourceBlob : await convertImageToPng(sourceBlob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('图片已复制');
  } catch (error) {
    showToast('复制图片失败, 可右键图片另存为');
  }
}

async function convertImageToPng(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function renderConnection(status = '') {
  const pill = $('#connectionPill');
  const text = $('#connectionText');
  pill.classList.remove('connected', 'loading');
  if (status === 'loading') {
    pill.classList.add('loading');
    text.textContent = '请求中';
    return;
  }
  if (state.settings.chatApiKey && state.settings.chatBaseUrl) {
    pill.classList.add('connected');
    text.textContent = '已连接';
  } else {
    text.textContent = '演示模式';
  }
}

function setView(view) {
  $$('.mode-tab').forEach((tab) => {
    const active = tab.dataset.view === view;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#chatView').hidden = view !== 'chat';
  $('#imageView').hidden = view !== 'image';
  $('#composerWrap').hidden = view !== 'chat';
}

function createMessage(role, content, image = '', imageHistoryId = '') {
  return { id: createId(), role, content, image, imageHistoryId, createdAt: Date.now() };
}

function addMessage(message) {
  const conversation = activeConversation();
  conversation.messages.push(message);
  if (message.role === 'user' && conversation.title === '新对话') conversation.title = message.content.slice(0, 24) || '图片对话';
  persist();
  render();
}

function buildApiEndpoint(input, suffix) {
  let value = input.trim().replace(/\/$/, '');
  if (!value) return '';
  if (value.endsWith(suffix)) return value;
  value = value.replace(/\/(chat\/completions|images\/generations|images\/edits)$/, '');
  if (value.endsWith('/v1') || value.endsWith('/api')) return `${value}${suffix}`;
  return value;
}

function buildModelsEndpoint(input) {
  const value = input.trim().replace(/\/$/, '').replace(/\/(chat\/completions|images\/generations|models)$/, '');
  if (!value) return '';
  return value.endsWith('/v1') || value.endsWith('/api') ? `${value}/models` : `${value}/models`;
}

function buildRequestMessages() {
  const conversation = activeConversation();
  const source = state.contextMode === 'single' ? conversation.messages.slice(-1) : conversation.messages;
  const messages = source.map((message) => {
    const imageSrc = message.image || storedImages.get(message.imageHistoryId)?.src;
    if (!imageSrc) return { role: message.role, content: message.content };
    return { role: message.role, content: [{ type: 'text', text: message.content }, { type: 'image_url', image_url: { url: imageSrc } }] };
  });
  if (state.settings.systemPrompt) messages.unshift({ role: 'system', content: state.settings.systemPrompt });
  return messages;
}

async function sendMessage() {
  const input = $('#messageInput');
  const content = input.value.trim();
  if (!content && !pendingAttachment) return;
  const attachment = pendingAttachment;
  input.value = '';
  autoResizeTextarea(input);
  clearAttachment();
  if (editingMessageId) {
    const conversation = activeConversation();
    const editIndex = conversation.messages.findIndex((message) => message.id === editingMessageId);
    if (editIndex >= 0) conversation.messages.splice(editIndex);
    editingMessageId = null;
    $('#editingBanner').hidden = true;
    persist();
  }
  let imageHistoryId = attachment?.imageHistoryId || '';
  if (attachment && !imageHistoryId) imageHistoryId = await saveChatImage(attachment.data, attachment.name);
  addMessage(createMessage('user', content || '请分析这张图片', '', imageHistoryId));
  $('#sendButton').disabled = true;
  $('#typingIndicator').hidden = false;
  renderConnection('loading');
  try {
    let responseText;
    if (state.settings.demoMode || !state.settings.chatApiKey || !state.settings.chatBaseUrl) responseText = await demoReply(content, Boolean(attachment));
    else responseText = await requestChat();
    addMessage(createMessage('assistant', responseText));
  } catch (error) {
    showToast(error.message || '请求失败, 请检查接口设置');
  } finally {
    requestController?.abort();
    requestController = null;
    $('#sendButton').disabled = false;
    $('#typingIndicator').hidden = true;
    renderConnection();
  }
}

function demoReply(content, hasImage) {
  return new Promise((resolve) => {
    window.setTimeout(() => {
      if (hasImage) resolve('我已经收到这张图片。当前是演示模式, 你配置真实接口后, 我会根据图片内容进行分析。\n\n你可以继续补充想了解的角度, 例如: 识别物体, 提取文字, 总结画面或给出修改建议');
      else if (/你好|嗨|hello/i.test(content)) resolve('你好, 我是 Orbit。先把接口配置好, 我就可以使用你的模型继续对话。现在也可以直接体验本地演示流程');
      else resolve(`这是演示模式的回复。\n\n我收到了: “${content || '一张图片'}”\n\n在设置中填写对话接口地址和 API Key 后, 这里会切换成真实模型响应。上下文当前使用“${state.contextMode === 'client' ? '客户端拼接' : '单轮请求'}”`);
    }, 780);
  });
}

async function requestChat() {
  const endpoint = buildApiEndpoint(state.settings.chatBaseUrl, '/chat/completions');
  requestController = new AbortController();
  const timeout = window.setTimeout(() => requestController.abort(), 60000);
  const body = { model: state.settings.chatModel, messages: buildRequestMessages(), temperature: 0.7, stream: false };
  if (state.settings.reasoningEffort && state.settings.reasoningEffort !== 'auto') body.reasoning_effort = state.settings.reasoningEffort;
  let response;
  try {
    response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.settings.chatApiKey}` }, body: JSON.stringify(body), signal: requestController.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('请求超时或已中断, 请检查接口地址和网络');
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `接口返回 ${response.status}`);
  const content = payload?.choices?.[0]?.message?.content;
  if (Array.isArray(content)) return content.map((part) => part.text || '').join('');
  if (!content) throw new Error('接口没有返回可显示的内容');
  return content;
}

async function generateImage() {
  const prompt = $('#imagePrompt').value.trim();
  if (!prompt) {
    showToast('先写下你想生成的画面');
    $('#imagePrompt').focus();
    return;
  }
  const config = getImageConfig();
  if (config.background === 'transparent' && config.format === 'jpeg') {
    showToast('透明背景只支持 PNG 或 WebP 格式');
    return;
  }
  const button = $('#generateImage');
  button.disabled = true;
  button.innerHTML = '<span>◌</span> 生成中';
  try {
    if (state.settings.demoMode || !state.settings.imageApiKey || !state.settings.imageBaseUrl) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await showDemoImage(prompt);
    } else {
      const hasReference = imageReferences.length > 0;
      const endpoint = buildApiEndpoint(state.settings.imageBaseUrl, hasReference ? '/images/edits' : '/images/generations');
      const request = { model: state.settings.imageModel, prompt, size: ratioToSize(config.ratio), n: config.count };
      if (config.quality !== 'auto') request.quality = config.quality;
      if (config.background !== 'auto') request.background = config.background;
      if (config.format !== 'png') request.output_format = config.format;
      if (config.moderation !== 'auto') request.moderation = config.moderation;
      let fetchOptions;
      if (hasReference) {
        const form = new FormData();
        form.append('model', request.model);
        form.append('prompt', request.prompt);
        form.append('size', request.size);
        form.append('n', String(request.n));
        if (request.quality) form.append('quality', request.quality);
        if (request.background) form.append('background', request.background);
        if (request.output_format) form.append('output_format', request.output_format);
        if (request.moderation) form.append('moderation', request.moderation);
        imageReferences.forEach((reference) => form.append('image[]', reference.file, reference.file.name));
        fetchOptions = { method: 'POST', headers: { Authorization: `Bearer ${state.settings.imageApiKey}` }, body: form };
      } else {
        fetchOptions = { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.settings.imageApiKey}` }, body: JSON.stringify(request) };
      }
      const response = await fetch(endpoint, fetchOptions);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `接口返回 ${response.status}`);
      const imageDataList = (payload?.data || []).map((item) => item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : '')).filter(Boolean);
      if (!imageDataList.length) throw new Error('接口没有返回图片地址');
      const referenceSources = imageReferences.map((reference) => reference.data);
      presentGeneratedImages(imageDataList, prompt, config, referenceSources);
    }
  } catch (error) {
    showToast(error.message || '生图失败, 请检查接口设置');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> 生成图片';
  }
}

function ratioToSize(ratio) {
  return ({ auto: 'auto', '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' })[ratio] || 'auto';
}

function showImage(src, prompt = '', item = null) {
  const result = $('#imageResult');
  currentImage = { ...(item || {}), src, prompt: prompt || item?.prompt || '' };
  result.classList.add('has-image');
  result.innerHTML = `<button class="generated-image-button" id="generatedImageButton" aria-label="查看生成图片全图"><img class="generated-image" src="${src}" alt="生成的图片"></button><div class="image-result-toolbar"><button data-result-action="lightbox">查看全图</button><button data-result-action="config" title="复制提示词, 参数和原参考图">复制配置</button><button data-result-action="copy">复制图片</button><button data-result-action="new-chat">发到对话</button><button data-result-action="edit" title="只把输出图带到新的生图任务">编辑输出</button></div>`;
  $('#generatedImageButton').addEventListener('click', () => openLightbox(src, currentImage.prompt, currentImage));
  $$('[data-result-action]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.resultAction === 'lightbox') openLightbox(src, currentImage.prompt, currentImage);
    if (button.dataset.resultAction === 'config') applyImageConfig(currentImage);
    if (button.dataset.resultAction === 'copy') copyImageToClipboard(src);
    if (button.dataset.resultAction === 'new-chat') copyImageToNewChat(currentImage);
    if (button.dataset.resultAction === 'edit') editGeneratedImage(currentImage);
  }));
}

async function editGeneratedImage(item) {
  try {
    const dataUrl = item.src.startsWith('data:') ? item.src : await downloadImageAsDataUrl(item.src);
    await setImageReferencesFromSources([dataUrl]);
    $('#imagePrompt').value = '';
    setImageConfig(defaultState.settings.imageOptions);
    setView('image');
    closeLightbox();
    $('#imagePrompt').focus();
    showToast('已将输出图作为新任务的参考图');
  } catch (error) {
    showToast('无法读取这张图片, 请先下载到本地再上传');
  }
}

function dataUrlToFile(dataUrl, name) {
  const [header, encoded] = dataUrl.split(',');
  const mime = header.match(/data:(.*?);/)?.[1] || 'image/png';
  if (!header.includes(';base64')) return new File([decodeURIComponent(encoded)], name, { type: mime });
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type: mime });
}

async function saveGeneratedImage(src, prompt, config = getImageConfig(), referenceSources = imageReferences.map((reference) => reference.data)) {
  let storedSrc = src;
  if (!src.startsWith('data:')) {
    try {
      storedSrc = await downloadImageAsDataUrl(src);
    } catch (error) {
      // 某些生图服务的临时地址禁止跨域下载, 仍保留原地址供当前会话查看
    }
  }
  const record = { id: createId(), src: storedSrc, prompt, config, referenceSources, type: 'generation', createdAt: Date.now() };
  await saveImageHistory(record);
  storedImages.set(record.id, record);
  imageHistory.unshift(record);
  renderImageHistory();
  return record;
}

function presentGeneratedImages(imageDataList, prompt, config, referenceSources) {
  const firstSrc = imageDataList[0];
  showImage(firstSrc, prompt, { config, referenceSources });

  // 本地持久化不阻塞预览, 避免大图写入时界面一直显示生成中
  Promise.allSettled(imageDataList.map((src) => saveGeneratedImage(src, prompt, config, referenceSources))).then((results) => {
    const firstRecord = results[0]?.status === 'fulfilled' ? results[0].value : null;
    if (firstRecord && currentImage?.src === firstSrc) currentImage = firstRecord;
    if (results.some((result) => result.status === 'rejected')) showToast('图片已显示, 但部分图片无法写入本地历史');
  });
}

async function downloadImageAsDataUrl(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error('无法下载图片');
  const blob = await response.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function loadModels(kind) {
  const isChat = kind === 'chat';
  const button = isChat ? $('#loadChatModels') : $('#loadImageModels');
  const endpoint = buildModelsEndpoint(isChat ? $('#chatBaseUrl').value : $('#imageBaseUrl').value);
  const apiKey = isChat ? $('#chatApiKey').value.trim() : $('#imageApiKey').value.trim();
  if (!endpoint || !apiKey) {
    showToast('请先填写对应的接口地址和 API Key');
    return;
  }
  button.disabled = true;
  button.textContent = '获取中';
  try {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || `接口返回 ${response.status}`);
    const models = Array.isArray(payload?.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
    if (!models.length) throw new Error('接口没有返回可用模型列表');
    $(`#${isChat ? 'chatModelOptions' : 'imageModelOptions'}`).innerHTML = models.map((model) => `<option value="${escapeHtml(model)}"></option>`).join('');
    showToast(`已获取 ${models.length} 个模型`);
  } catch (error) {
    showToast(error.message || '获取模型失败, 也可以直接手动填写模型名');
  } finally {
    button.disabled = false;
    button.textContent = '获取模型';
  }
}

function showDemoImage(prompt) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760"><rect width="1200" height="760" fill="#152536"/><circle cx="925" cy="160" r="125" fill="#e6f36b" opacity=".85"/><path d="M0 590 285 360l176 125 170-203 369 308H0Z" fill="#2d5960"/><path d="M0 670 260 488l185 115 155-124 367 191H0Z" fill="#173a4a"/><rect x="45" y="55" width="430" height="72" rx="10" fill="#0d1725" opacity=".83"/><text x="78" y="101" fill="#ecf2f9" font-family="sans-serif" font-size="24">${escapeHtml(prompt.slice(0, 27))}</text><text x="78" y="711" fill="#94a8b8" font-family="sans-serif" font-size="16">Orbit Image Studio · Demo preview</text></svg>`;
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const config = getImageConfig();
  const referenceSources = imageReferences.map((reference) => reference.data);
  presentGeneratedImages([src], prompt, config, referenceSources);
  showToast('已生成演示预览, 配置生图接口后可获得真实图片');
}

async function handleImageReference(event) {
  const files = [...event.target.files].slice(0, 16 - imageReferences.length);
  if (!files.length) return;
  const references = await Promise.all(files.map(async (file) => ({ file, data: await fileToDataUrl(file) })));
  imageReferences.push(...references);
  renderImageReferences();
  event.target.value = '';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImageReferences() {
  const preview = $('#imageReferencePreview');
  preview.hidden = imageReferences.length === 0;
  preview.innerHTML = imageReferences.map((reference, index) => `<div class="reference-preview-item"><img src="${reference.data}" alt="生图参考图 ${index + 1}"><button type="button" class="remove-reference" data-reference-index="${index}" aria-label="移除参考图">×</button></div>`).join('');
  $$('.remove-reference').forEach((button) => button.addEventListener('click', () => {
    imageReferences.splice(Number(button.dataset.referenceIndex), 1);
    renderImageReferences();
  }));
}

async function setImageReferencesFromSources(sources) {
  imageReferences = sources.map((data, index) => ({ data, file: dataUrlToFile(data, `reference-${Date.now()}-${index}.png`) }));
  renderImageReferences();
}

function clearImageReferences() {
  imageReferences = [];
  renderImageReferences();
}

function openSettings() {
  $('#chatBaseUrl').value = state.settings.chatBaseUrl;
  $('#chatApiKey').value = state.settings.chatApiKey;
  $('#chatModel').value = state.settings.chatModel;
  $('#imageBaseUrl').value = state.settings.imageBaseUrl;
  $('#imageApiKey').value = state.settings.imageApiKey;
  $('#imageModel').value = state.settings.imageModel;
  $('#systemPrompt').value = state.settings.systemPrompt;
  $('#reasoningEffort').value = state.settings.reasoningEffort || 'auto';
  $('#demoMode').checked = state.settings.demoMode;
  $('#settingsBackdrop').hidden = false;
}

function closeSettings() {
  $('#settingsBackdrop').hidden = true;
}

function saveSettings() {
  state.settings = { chatBaseUrl: $('#chatBaseUrl').value.trim(), chatApiKey: $('#chatApiKey').value.trim(), chatModel: $('#chatModel').value.trim() || 'gpt-4o-mini', imageBaseUrl: $('#imageBaseUrl').value.trim(), imageApiKey: $('#imageApiKey').value.trim(), imageModel: $('#imageModel').value.trim() || 'gpt-image-1', imageOptions: state.settings.imageOptions, systemPrompt: $('#systemPrompt').value.trim(), reasoningEffort: $('#reasoningEffort').value, demoMode: $('#demoMode').checked };
  persist();
  closeSettings();
  render();
  showToast('设置已保存');
}

function newConversation() {
  const conversation = { id: createId(), title: '新对话', createdAt: Date.now(), messages: [] };
  state.conversations.push(conversation);
  state.activeConversationId = conversation.id;
  persist();
  render();
  $('#messageInput').focus();
  $('#sidebar').classList.remove('open');
}

function clearConversation() {
  const conversation = activeConversation();
  if (!conversation.messages.length) return;
  if (!window.confirm('清空当前对话内容?')) return;
  conversation.messages = [];
  conversation.title = '新对话';
  persist();
  render();
  showToast('当前对话已清空');
}

async function clearLocalData() {
  if (!window.confirm('清除所有本地对话和接口设置?')) return;
  localStorage.removeItem(STORAGE_KEY);
  await clearStoredImages();
  state = createInitialState();
  closeSettings();
  pendingAttachment = null;
  clearImageReferences();
  $('#attachmentPreview').hidden = true;
  render();
  showToast('本地数据已清除');
}

function handleAttachment(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingAttachment = { data: reader.result, name: file.name };
    $('#attachmentPreview').hidden = false;
    $('#attachmentPreview').innerHTML = `<img src="${reader.result}" alt="待发送的图片"><button type="button" class="remove-attachment" aria-label="移除图片">×</button>`;
    $('.remove-attachment').addEventListener('click', clearAttachment);
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function clearAttachment() {
  pendingAttachment = null;
  $('#attachmentPreview').hidden = true;
  $('#attachmentPreview').innerHTML = '';
}

function autoResizeTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function bindEvents() {
  $('#newChatButton').addEventListener('click', newConversation);
  $('#clearConversation').addEventListener('click', clearConversation);
  $('#openSettings').addEventListener('click', openSettings);
  $('#topbarSettings').addEventListener('click', openSettings);
  $('#openSettingsFromFootnote').addEventListener('click', openSettings);
  $('#closeSettings').addEventListener('click', closeSettings);
  $('#cancelSettings').addEventListener('click', closeSettings);
  $('#saveSettings').addEventListener('click', saveSettings);
  $('#resetLocalData').addEventListener('click', clearLocalData);
  $('#loadChatModels').addEventListener('click', () => loadModels('chat'));
  $('#loadImageModels').addEventListener('click', () => loadModels('image'));
  $('#sendButton').addEventListener('click', sendMessage);
  $('#generateImage').addEventListener('click', generateImage);
  $('#imageUpload').addEventListener('change', handleAttachment);
  $('#imageReferenceUpload').addEventListener('change', handleImageReference);
  $('#cancelEdit').addEventListener('click', cancelMessageEdit);
  $('#closeLightbox').addEventListener('click', closeLightbox);
  $('#lightboxReuse').addEventListener('click', () => currentImage && applyImageConfig(currentImage));
  $('#lightboxCopyImage').addEventListener('click', () => currentImage && copyImageToClipboard(currentImage.src));
  $('#lightboxCopyChat').addEventListener('click', () => currentImage && copyImageToNewChat(currentImage));
  $('#lightboxEdit').addEventListener('click', () => currentImage && editGeneratedImage(currentImage));
  $('#openSidebar').addEventListener('click', () => $('#sidebar').classList.add('open'));
  $('#closeSidebar').addEventListener('click', () => $('#sidebar').classList.remove('open'));
  $('#messageInput').addEventListener('input', (event) => autoResizeTextarea(event.target));
  $('#messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
  });
  $$('.mode-tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
  $$('.context-option').forEach((button) => button.addEventListener('click', () => { state.contextMode = button.dataset.context; persist(); render(); }));
  $$('.quick-action').forEach((button) => button.addEventListener('click', () => { $('#messageInput').value = button.dataset.prompt; $('#messageInput').focus(); autoResizeTextarea($('#messageInput')); }));
  $$('.show-key').forEach((button) => button.addEventListener('click', () => { const input = $(`#${button.dataset.target}`); input.type = input.type === 'password' ? 'text' : 'password'; button.textContent = input.type === 'password' ? '显示' : '隐藏'; }));
  window.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newConversation(); } if (event.key === 'Escape' && !$('#settingsBackdrop').hidden) closeSettings(); if (event.key === 'Escape' && !$('#imageLightbox').hidden) closeLightbox(); });
}

bindEvents();
render();
loadImageHistory();
