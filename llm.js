// 三个打标模式共用的 LLM 配置与调用层：配置存一份，任何模式导出时都能直接用。
(() => {
  'use strict';

  const CONFIG_KEY = 'picLabeling_llm_config_v1';
  const LEGACY_CONFIG_KEYS = ['taxonomy_llm_config_v1'];

  // 请求地址留空时使用同域代理转发，避免浏览器跨域。
  const COMPANY = { endpoint: '/api/agent/report', model: 'standard' };

  // 常用 OpenAI 兼容服务的快捷填充项：点击后仅预填地址和模型，不改变调用方式。
  const QUICK_SERVICES = [
    { name: '本机代理', endpoint: '/api/agent/report', model: 'standard' },
    { name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    {
      name: '火山方舟',
      endpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seed-1-6-250615',
    },
    { name: 'Kimi', endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
    {
      name: '通义千问',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: 'qwen-plus',
    },
    { name: '本机 Ollama', endpoint: 'http://localhost:11434/v1', model: 'llama3' },
  ];

  const SYSTEM_PROMPT =
    '你是图片打标与算法验收分析助手。请严格依据随请求提供的数据回答，不编造不存在的结果。输出适合保存为 TXT 的中文结论，优先给出明确数据、主要问题、风险和可执行建议。';

  function defaultConfig() {
    return { endpoint: COMPANY.endpoint, model: COMPANY.model, apiKey: '' };
  }

  function normalizeEndpoint(endpoint) {
    const value = String(endpoint || '').trim().replace(/\s+/g, '');
    if (!value) return value;
    if (value.includes('?') || /chat\/completions|\/(messages|responses)$/.test(value)) return value;
    const trimmed = value.replace(/\/+$/, '');
    if (/\/v\d+$/.test(trimmed)) return `${trimmed}/chat/completions`;
    if (/^https?:\/\/[^/]+$/.test(trimmed)) return `${trimmed}/v1/chat/completions`;
    return trimmed;
  }

  function readStored() {
    const keys = [CONFIG_KEY, ...LEGACY_CONFIG_KEYS];
    for (const key of keys) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || 'null');
        if (parsed && typeof parsed === 'object') {
          if (key !== CONFIG_KEY) localStorage.setItem(CONFIG_KEY, JSON.stringify(parsed));
          return parsed;
        }
      } catch {
        // 忽略损坏的配置，继续尝试下一个来源
      }
    }
    return null;
  }

  function load() {
    return { ...defaultConfig(), ...(readStored() || {}) };
  }

  function resolve(raw) {
    const config = { ...defaultConfig(), ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!config.endpoint) config.endpoint = COMPANY.endpoint;
    if (!config.model) config.model = COMPANY.model;
    config.endpoint = normalizeEndpoint(config.endpoint);
    return config;
  }

  const changeListeners = new Set();

  function onConfigChange(listener) {
    if (typeof listener === 'function') changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  }

  function emitChange(config) {
    changeListeners.forEach((listener) => listener(config));
  }

  function save(raw) {
    const config = resolve(raw);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    emitChange(config);
    return config;
  }

  function clear() {
    [CONFIG_KEY, ...LEGACY_CONFIG_KEYS].forEach((key) => localStorage.removeItem(key));
    emitChange(defaultConfig());
  }

  function isLocalEndpoint(endpoint) {
    return /localhost|127\.0\.0\.1/.test(String(endpoint || ''));
  }

  function isConfigured(raw) {
    const config = resolve(raw);
    return Boolean(
      config.endpoint && config.model && (config.apiKey || isLocalEndpoint(config.endpoint)),
    );
  }

  function extractText(payload) {
    if (typeof payload === 'string') return payload.trim();
    if (!payload || typeof payload !== 'object') return '';
    for (const key of ['output_text', 'content', 'text', 'result', 'answer']) {
      if (typeof payload[key] === 'string' && payload[key].trim()) return payload[key].trim();
    }
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
    const choice = payload.choices?.[0];
    if (typeof choice?.message?.content === 'string') return choice.message.content.trim();
    if (Array.isArray(choice?.message?.content)) {
      const text = choice.message.content
        .map((item) => (typeof item === 'string' ? item : item?.text || item?.content || ''))
        .join('');
      if (text.trim()) return text.trim();
    }
    if (typeof choice?.text === 'string') return choice.text.trim();
    if (Array.isArray(payload.output)) {
      const text = payload.output
        .flatMap((item) => item?.content || [])
        .map((item) => item?.text || item?.content || '')
        .join('');
      if (text.trim()) return text.trim();
    }
    if (payload.data && payload.data !== payload) return extractText(payload.data);
    return '';
  }

  function networkErrorHint(config) {
    if (/^https?:\/\//.test(config.endpoint)) {
      if (isLocalEndpoint(config.endpoint)) {
        return '连不上本机服务：确认 Ollama 等本机模型已启动，且允许浏览器跨域（Ollama 需设置 OLLAMA_ORIGINS=*）。';
      }
      return '浏览器无法直接访问该地址（跨域 CORS）。可改用同域地址 /api/agent/report，并通过 node server.js 或部署后的站点打开。';
    }
    return '同域代理不可用：请用 node server.js 启动（不要直接用 file:// 打开 HTML），或确认部署已包含 server.js 代理。';
  }

  function httpErrorHint(status, detail) {
    const tail = detail ? `接口返回：${detail}` : '';
    if (status === 401 || status === 403) return `鉴权失败（${status}）：检查 API Key 是否正确或过期。${tail}`;
    if (status === 404) return `地址不存在（404）：请求地址通常以 /v1/chat/completions 结尾，检查是否填错或缺少 /v1。${tail}`;
    if (status === 400 || status === 422) return `请求被拒绝（${status}）：多数是模型名称写错或该服务不支持当前参数。${tail}`;
    if (status === 429) return `触发限流（429）：稍后重试或更换额度充足的 Key。${tail}`;
    if (status >= 500) return `服务端错误（${status}）：上游服务或代理异常。${tail}`;
    return `HTTP ${status}：${detail || '未知错误'}`;
  }

  async function call(rawConfig, { instruction, context, maxTokens } = {}) {
    const config = resolve(rawConfig);
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const body = {
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: context
            ? `${instruction}\n\n以下是隐藏附带的验收 JSON 数据：\n${JSON.stringify(context)}`
            : instruction,
        },
      ],
      temperature: 0.2,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
    };

    let response;
    try {
      response = await fetch(config.endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch {
      throw new Error(networkErrorHint(config));
    }
    const raw = await response.text();
    let payload = raw;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = raw;
    }
    if (!response.ok) {
      const detail =
        (typeof payload?.error?.message === 'string' ? payload.error.message : '') ||
        extractText(payload) ||
        String(raw || '').slice(0, 200);
      throw new Error(httpErrorHint(response.status, detail));
    }
    const text = extractText(payload);
    if (!text) {
      throw new Error('接口连通但没找到文本内容：自建代理请把回复放在 content、text、result 或 answer 字段里。');
    }
    return text;
  }

  function companyHintSuffix(config, message) {
    return config.endpoint === COMPANY.endpoint && /502|404|同域代理|上游/i.test(message)
      ? ' 请确认已用 node server.js 启动，或让运维设置 MODEL_ROUTER_UPSTREAM 环境变量。'
      : '';
  }

  // 生成共用的 API 配置弹窗，各模式只需提供 toast 与配置变更回调。
  function createApiDialog({ toast, onChange } = {}) {
    const notify = typeof toast === 'function' ? toast : () => {};
    if (onChange) onConfigChange(onChange);
    const modal = document.createElement('section');
    modal.className = 'modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal__backdrop" data-close="1"></div>
      <div class="modal__panel card modal__panel--small">
        <div class="card__title">API</div>
        <div class="card__body taxonomyApiForm">
          <p class="taxonomyApiIntro">
            只需填三项：API Key、请求地址、模型名称。任意 OpenAI 兼容服务（OpenAI、DeepSeek、火山方舟、Kimi、通义等）均可调用。
          </p>
          <div class="taxonomyApiQuick" data-role="quick">
            <span class="taxonomyApiQuick__label">常用服务（点击自动填充地址和模型）：</span>
          </div>
          <label class="taxonomyApiField">
            <span>API Key</span>
            <input class="textInput" data-role="key" type="password" autocomplete="off" placeholder="服务商控制台申请的 Key" />
            <span class="taxonomyApiHint">
              以 <code>Authorization: Bearer Key</code> 方式鉴权，兼容绝大多数服务；本机模型（如 Ollama）可留空。
            </span>
          </label>
          <label class="taxonomyApiField">
            <span>请求地址（Base URL）</span>
            <input class="textInput" data-role="endpoint" />
            <span class="taxonomyApiHint">
              填到 <code>https://域名/v1</code> 即可，会自动补全为 <code>/chat/completions</code> 接口。
            </span>
          </label>
          <label class="taxonomyApiField">
            <span>模型名称</span>
            <input class="textInput" data-role="model" />
            <span class="taxonomyApiHint">
              例如 <code>gpt-4o-mini</code>、<code>deepseek-chat</code>，按服务商模型列表填写。
            </span>
          </label>
          <p class="taxonomyApiWarning">
            配置仅保存在本机浏览器，三个打标模式共用。纯前端无法隐藏 API Key，请勿在公共设备保存。
          </p>
          <div class="taxonomyApiTest">
            <button class="btn" data-role="test">测试连接</button>
            <span class="taxonomyApiStatus" data-role="status"></span>
          </div>
          <div class="row taxonomyApiActions">
            <button class="btn btn--primary" data-role="save">保存</button>
            <button class="btn" data-role="clear">清除配置</button>
            <button class="btn" data-role="close">关闭</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const pick = (role) => modal.querySelector(`[data-role="${role}"]`);
    const fields = { key: pick('key'), endpoint: pick('endpoint'), model: pick('model') };
    const status = pick('status');

    function setStatus(text, tone = '') {
      status.textContent = text;
      status.dataset.tone = tone;
    }

    function formConfig() {
      return {
        endpoint: normalizeEndpoint(fields.endpoint.value.trim()),
        model: fields.model.value.trim(),
        apiKey: fields.key.value.trim(),
      };
    }

    QUICK_SERVICES.forEach((service) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'taxonomyApiQuick__btn';
      button.textContent = service.name;
      button.addEventListener('click', () => {
        fields.endpoint.value = service.endpoint;
        fields.model.value = service.model;
        setStatus(`已填充「${service.name}」默认地址和模型，可继续修改`);
      });
      pick('quick').appendChild(button);
    });

    function open() {
      const config = resolve(load());
      fields.endpoint.value = config.endpoint;
      fields.model.value = config.model;
      fields.key.value = config.apiKey;
      setStatus(config.apiKey ? '已保存，可点「测试连接」验证' : '填好三项后点保存，可先用「测试连接」验证');
      modal.hidden = false;
    }

    function close() {
      modal.hidden = true;
    }

    pick('save').addEventListener('click', () => {
      const form = formConfig();
      if (!form.endpoint) return notify('保存失败', '请填写请求地址（Base URL）');
      if (!form.model) return notify('保存失败', '请填写模型名称');
      if (!form.apiKey && !isLocalEndpoint(form.endpoint)) return notify('保存失败', '请填写 API Key');
      const config = save(form);
      fields.endpoint.value = config.endpoint;
      close();
      notify('已保存', 'API 配置已保存，所有打标模式共用');
    });

    pick('clear').addEventListener('click', () => {
      if (!window.confirm('清除当前浏览器保存的 API Key 和配置？所有模式都会失效。')) return;
      clear();
      const defaults = defaultConfig();
      fields.endpoint.value = defaults.endpoint;
      fields.model.value = defaults.model;
      fields.key.value = '';
      setStatus('配置已清除');
      notify('已清除', '本地 API 配置已删除');
    });

    pick('test').addEventListener('click', async () => {
      const form = formConfig();
      if (!form.apiKey && !isLocalEndpoint(form.endpoint)) return setStatus('请先填写 API Key', 'bad');
      const config = resolve(form);
      fields.endpoint.value = config.endpoint;
      pick('test').disabled = true;
      setStatus('正在测试连接…');
      try {
        const reply = await call(config, { instruction: '连接测试，请只回复：OK', maxTokens: 16 });
        setStatus(`连接成功，模型回复：${reply.slice(0, 30)}`, 'ok');
      } catch (error) {
        setStatus('连接失败', 'bad');
        const message = String(error?.message || error);
        notify('连接失败', message + companyHintSuffix(config, message), 9000);
      } finally {
        pick('test').disabled = false;
      }
    });

    pick('close').addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target.dataset.close === '1') close();
    });

    return { open, close, element: modal };
  }

  // 生成共用的「AI 结论」导出区块：调用方提供数据范围与是否有数据的判断。
  function createExportPanel({
    mount,
    dialog,
    toast,
    contexts = [],
    hasData = () => true,
    placeholder = '例如：请总结主要问题、风险和优化优先级，并给出可直接汇报的结论',
    fileName = () => `AI结论_${new Date().toISOString().slice(0, 10)}.txt`,
  } = {}) {
    if (!mount) return null;
    const notify = typeof toast === 'function' ? toast : () => {};
    const block = document.createElement('div');
    block.className = 'taxonomyAiExport';
    block.innerHTML = `
      <div class="taxonomyAiExport__head">
        <span>AI 结论</span>
        <span class="taxonomyAiExport__headRight">
          <select class="selectInput" data-role="context" aria-label="发送给 AI 的数据范围">
            ${contexts.map((item) => `<option value="${item.value}">${item.label}</option>`).join('')}
          </select>
          <button class="btn" data-role="api">API</button>
        </span>
      </div>
      <textarea class="textInput taxonomyAiPrompt" data-role="prompt" placeholder="${placeholder}"></textarea>
      <div class="taxonomyAiExport__actions">
        <span class="taxonomyAiStatus" data-role="status"></span>
        <button class="btn" data-role="send">发送</button>
      </div>
      <textarea class="textInput taxonomyAiResult" data-role="result" placeholder="LLM 返回内容" readonly hidden></textarea>
      <button class="btn taxonomyAiDownload" data-role="download" disabled hidden>导出 AI 结论 TXT</button>`;
    mount.appendChild(block);

    const pick = (role) => block.querySelector(`[data-role="${role}"]`);
    const status = pick('status');
    const result = pick('result');
    const download = pick('download');
    const contextSelect = pick('context');
    if (contexts.length < 2) contextSelect.hidden = true;

    function setStatus(text, tone = '') {
      status.textContent = text;
      status.dataset.tone = tone;
    }

    function updateApiButton() {
      pick('api').dataset.configured = isConfigured(load()) ? '1' : '';
    }

    pick('api').addEventListener('click', () => dialog?.open());

    pick('send').addEventListener('click', async () => {
      const config = resolve(load());
      if (!isConfigured(config)) {
        dialog?.open();
        return notify('尚未配置', '请先粘贴 API Key 并保存');
      }
      const instruction = pick('prompt').value.trim();
      if (!instruction) return notify('无法发送', '请先输入希望 AI 完成的任务');
      if (!hasData()) return notify('无法发送', '当前没有可分析的数据');

      const selected = contexts.find((item) => item.value === contextSelect.value) || contexts[0];
      const context = selected?.build?.() ?? null;
      const sizeKb = Math.ceil(JSON.stringify(context ?? {}).length / 1024);

      pick('send').disabled = true;
      result.hidden = true;
      download.hidden = true;
      download.disabled = true;
      setStatus(`发送中 · ${selected?.label || '数据'} ${sizeKb} KB`);
      try {
        result.value = await call(config, { instruction, context });
        result.hidden = false;
        download.hidden = false;
        download.disabled = false;
        setStatus('生成完成', 'ok');
      } catch (error) {
        setStatus('生成失败', 'bad');
        const message = String(error?.message || error);
        notify('API 调用失败', message + companyHintSuffix(config, message), 8000);
      } finally {
        pick('send').disabled = false;
      }
    });

    download.addEventListener('click', () => {
      const text = result.value.trim();
      if (!text) return;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = typeof fileName === 'function' ? fileName() : String(fileName);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    updateApiButton();
    onConfigChange(updateApiButton);
    return { element: block, updateApiButton };
  }

  window.PicLabelingLlm = {
    CONFIG_KEY,
    COMPANY,
    QUICK_SERVICES,
    defaultConfig,
    normalizeEndpoint,
    load,
    save,
    clear,
    resolve,
    isConfigured,
    isLocalEndpoint,
    extractText,
    call,
    companyHintSuffix,
    onConfigChange,
    createApiDialog,
    createExportPanel,
  };
})();
