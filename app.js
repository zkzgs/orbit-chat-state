const STORAGE_KEY = 'orbit-chat-state-v1';

const defaultState = {
  settings: {
    chatBaseUrl: '',
    chatApiKey: '',
    chatModel: 'gpt-4o-mini',
    imageBaseUrl: '',
    imageApiKey: '',
    imageModel: 'gpt-image-1',
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
      settings: { ...defaultState.settings, ...(saved.settings || {}) },
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

async function loadImageHistory() {
  try {
    const db = await openImageDb();
    const items = await new Promise((resolve, reject) => {
      const request = db.transaction(IMAGE_STORE_NAME, 'readonly').objectStore(IMAGE_STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    imageHistory = items.sort((a, b) => b.createdAt - a.createdAt);
    renderImageHistory();
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
  renderImageHistory();
}

function renderImageHistory() {
  const section = $('#imageHistorySection');
  const list = $('#imageHistory');
  if (!section || !list) return;
  section.hidden = imageHistory.length === 0;
  $('#imageHistoryCount').textContent = imageHistory.length;
  list.innerHTML = imageHistory.map((item) => `<article class="history-item"><button class="history-delete" data-history-id="${item.id}" title="删除记录" aria-label="删除记录">×</button><button class="history-image-button" data-history-image="${item.id}" aria-label="查看生成图片"><img src="${item.src}" alt="${escapeHtml(item.prompt)}"></button><div class="history-item-info"><div class="history-item-prompt">${escapeHtml(item.prompt)}</div><time class="history-item-time">${formatTime(item.createdAt)}</time></div></article>`).join('');
  $$('.history-delete').forEach((button) => button.addEventListener('click', () => deleteImageHistory(button.dataset.historyId)));
  $$('.history-image-button').forEach((button) => button.addEventListener('click', () => {
    const item = imageHistory.find((entry) => entry.id === button.dataset.historyImage);
    if (item) showImage(item.src);
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
    const image = message.image ? `<img class="message-image" src="${message.image}" alt="用户上传的图片">` : '';
    return `<article class="message ${message.role}"><div class="message-avatar">${message.role === 'assistant' ? 'O' : 'ME'}</div><div class="message-content"><div class="message-meta"><span class="message-role">${message.role === 'assistant' ? 'Orbit' : '你'}</span><span class="message-time">${formatTime(message.createdAt)}</span></div><div class="message-text">${escapeHtml(message.content)}</div>${image}<div class="message-actions"><button class="message-action copy-message" data-message="${encodeURIComponent(message.content)}">复制</button></div></div></article>`;
  }).join('');
  $$('.copy-message').forEach((button) => button.addEventListener('click', async () => {
    await navigator.clipboard?.writeText(decodeURIComponent(button.dataset.message));
    showToast('已复制到剪贴板');
  }));
  const stage = $('.content-stage');
  if (hasMessages) requestAnimationFrame(() => { stage.scrollTop = stage.scrollHeight; });
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

function createMessage(role, content, image = '') {
  return { id: createId(), role, content, image, createdAt: Date.now() };
}

function addMessage(message) {
  const conversation = activeConversation();
  conversation.messages.push(message);
  if (message.role === 'user' && conversation.title === '新对话') conversation.title = message.content.slice(0, 24) || '图片对话';
  persist();
  render();
}

function buildApiEndpoint(input, suffix) {
  const value = input.trim().replace(/\/$/, '');
  if (!value) return '';
  if (value.endsWith(suffix)) return value;
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
    if (!message.image) return { role: message.role, content: message.content };
    return { role: message.role, content: [{ type: 'text', text: message.content }, { type: 'image_url', image_url: { url: message.image } }] };
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
  addMessage(createMessage('user', content || '请分析这张图片', attachment?.data || ''));
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
  const button = $('#generateImage');
  button.disabled = true;
  button.innerHTML = '<span>◌</span> 生成中';
  try {
    if (state.settings.demoMode || !state.settings.imageApiKey || !state.settings.imageBaseUrl) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      showDemoImage(prompt);
    } else {
      const endpoint = buildApiEndpoint(state.settings.imageBaseUrl, '/images/generations');
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.settings.imageApiKey}` }, body: JSON.stringify({ model: state.settings.imageModel, prompt, size: ratioToSize($('#imageRatio').value) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error?.message || `接口返回 ${response.status}`);
      const imageData = payload?.data?.[0]?.url || (payload?.data?.[0]?.b64_json ? `data:image/png;base64,${payload.data[0].b64_json}` : '');
      if (!imageData) throw new Error('接口没有返回图片地址');
       showImage(imageData);
       await saveGeneratedImage(imageData, prompt);
    }
  } catch (error) {
    showToast(error.message || '生图失败, 请检查接口设置');
  } finally {
    button.disabled = false;
    button.innerHTML = '<span>✦</span> 生成图片';
  }
}

function ratioToSize(ratio) {
  return ({ '1:1': '1024x1024', '16:9': '1536x1024', '9:16': '1024x1536' })[ratio] || '1024x1024';
}

function showImage(src) {
  const result = $('#imageResult');
  result.classList.add('has-image');
  result.innerHTML = `<img class="generated-image" src="${src}" alt="生成的图片">`;
}

async function saveGeneratedImage(src, prompt) {
  try {
    let storedSrc = src;
    if (!src.startsWith('data:')) {
      try {
        storedSrc = await downloadImageAsDataUrl(src);
      } catch (error) {
        // 某些生图服务的临时地址禁止跨域下载, 仍保留原地址供当前会话查看
      }
    }
    await saveImageHistory({ id: createId(), src: storedSrc, prompt, createdAt: Date.now() });
    await loadImageHistory();
  } catch (error) {
    showToast('图片已显示, 但无法写入本地历史');
  }
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
  showImage(src);
  saveGeneratedImage(src, prompt);
  showToast('已生成演示预览, 配置生图接口后可获得真实图片');
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
  state.settings = { chatBaseUrl: $('#chatBaseUrl').value.trim(), chatApiKey: $('#chatApiKey').value.trim(), chatModel: $('#chatModel').value.trim() || 'gpt-4o-mini', imageBaseUrl: $('#imageBaseUrl').value.trim(), imageApiKey: $('#imageApiKey').value.trim(), imageModel: $('#imageModel').value.trim() || 'gpt-image-1', systemPrompt: $('#systemPrompt').value.trim(), reasoningEffort: $('#reasoningEffort').value, demoMode: $('#demoMode').checked };
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

function clearLocalData() {
  if (!window.confirm('清除所有本地对话和接口设置?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state = createInitialState();
  closeSettings();
  pendingAttachment = null;
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
  window.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); newConversation(); } if (event.key === 'Escape' && !$('#settingsBackdrop').hidden) closeSettings(); });
}

bindEvents();
render();
loadImageHistory();
