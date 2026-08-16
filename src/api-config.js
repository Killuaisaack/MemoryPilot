// MemoryPilot API Config - auto-transformed

export async function openApiConfig() {
(async () => {
  const PANEL = 'mp_api_panel';
  const STYLE = 'mp_api_style';
  const SKEY = 'mp_api_config';
  const META_NS = 'MemoryPilot';
  const $ = id => document.getElementById(id);
  const h = s => String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const ctx = window.SillyTavern?.getContext?.();
  const esc = s => String(s ?? '').replace(/\\/g,'\\\\').replace(/"/g,'\\"');

  const normalizeOpenAIBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
  const normalizeClaudeBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/v1\/messages$/i,'');
  const normalizeGeminiBase = s => String(s ?? '').trim().replace(/\/+$/,'').replace(/\/models\/.*$/i,'');

  const defaultsByProvider = {
    openai: {
      label: 'OpenAI兼容',
      url: 'https://api.openai.com/v1',
      models: []
    },
    claude: {
      label: 'Claude原生',
      url: 'https://api.anthropic.com',
      models: ['claude-opus-4-6','claude-sonnet-4-5','claude-haiku-4-5']
    },
    gemini: {
      label: 'Gemini原生',
      url: 'https://generativelanguage.googleapis.com/v1beta',
      models: ['gemini-2.5-pro','gemini-2.5-flash','gemini-2.5-flash-lite']
    }
  };

  const metaRoot = () => { try { return ctx?.chatMetadata?.extensions?.[META_NS] || {}; } catch { return {}; } };
  // Storage: extensionSettings (server-synced, outside chat file)
  const _EXT_NAME = 'MemoryPilot';
  const _getStore = () => {
    const c = window.SillyTavern?.getContext?.();
    if (!c?.extensionSettings) return null;
    if (!c.extensionSettings[_EXT_NAME]) c.extensionSettings[_EXT_NAME] = {};
    const charId = c?.characterId;
    const charObj = Number.isInteger(charId) ? c?.characters?.[charId] : null;
    const charScope = String(charObj?.avatar ?? charObj?.name ?? c?.chatMetadata?.character_name ?? c?.name2 ?? '');
    const ck = `${String(c.chatId ?? c.chatMetadata?.chat_file_name ?? 'default')}::${charScope}`;
    if (!c.extensionSettings[_EXT_NAME][ck]) c.extensionSettings[_EXT_NAME][ck] = {};
    return c.extensionSettings[_EXT_NAME][ck];
  };
  let _saveTimer = null;
  const _saveDebounced = () => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => {
      try { window.SillyTavern?.getContext?.()?.saveSettingsDebounced?.(); } catch {}
    }, 10000);
  };
  const syncMeta = async (patch, immediate) => {
    // Only save sticky state to extensionSettings, skip ephemeral stuff
    if (!patch) return;
    const dominated = ['turnCounter','recallEvery','mp_recall_pin','mp_recall_ctx','mp_pending_ops'];
    const dominated_set = new Set(dominated);
    const dominated_only = Object.keys(patch).every(k => dominated_set.has(k));
    if (dominated_only) return; // skip ephemeral-only patches
    const store = _getStore();
    if (!store) return;
    for (const [k, v] of Object.entries(patch)) {
      if (dominated_set.has(k)) continue;
      if (k === 'mp_memories' && Array.isArray(v)) continue; // memories stored separately
      store[k] = v;
    }
    _saveDebounced();
  };

  const load = async () => {
    try { const r = localStorage.getItem(SKEY); if (r && r.trim()) return JSON.parse(r); } catch {}
    try { const store = _getStore(); if (store && store[SKEY]) return store[SKEY]; } catch {}
    try { const meta = ctx.chatMetadata?.extensions?.['MemoryPilot']; if (meta && meta[SKEY]) return meta[SKEY]; } catch {}
    return {};
  };

  const save = async c => {
    const text = JSON.stringify(c || {});
    try { localStorage.setItem(SKEY, text); } catch {}
    const store = _getStore();
    if (store) { store[SKEY] = c || {}; _saveDebounced(); }
  };

  if ($(PANEL)) { $(PANEL).remove(); $(STYLE)?.remove(); return; }
  try { document.getElementById('mp_main_panel')?.remove(); document.getElementById('mp_main_style')?.remove(); } catch {}
  try { document.getElementById('mp_recall_monitor_panel')?.remove(); document.getElementById('mp_recall_monitor_style')?.remove(); } catch {}

  const cfg = await load();
  const provider = cfg.provider || 'openai';

  const st = document.createElement('style');
  st.id = STYLE;
  st.textContent = `
    #${PANEL} { position:fixed;inset:0;z-index:10002;display:flex;align-items:flex-start;justify-content:center;padding:max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)) 12px;box-sizing:border-box;font-family:-apple-system,sans-serif; }
    #${PANEL} .mask { position:absolute;inset:0;background:rgba(0,0,0,0.5);backdrop-filter:blur(4px); }
    #${PANEL} .card { position:relative;width:100%;max-width:560px;max-height:calc(100dvh - max(24px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));background:#222327;border-radius:14px;border:1px solid rgba(255,255,255,0.08);padding:20px;box-shadow:0 16px 48px rgba(0,0,0,0.5);overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain; }
    #${PANEL} h3 { margin:0 24px 16px 0;color:#fff;font-size:16px; }
    #${PANEL} .f { margin-bottom:12px; }
    #${PANEL} .f label { display:block;color:#aaa;font-size:11px;margin-bottom:3px; }
    #${PANEL} .f input, #${PANEL} .f select { width:100%;padding:9px;border-radius:8px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:13px;box-sizing:border-box; }
    #${PANEL} .f input:focus, #${PANEL} .f select:focus { outline:none;border-color:rgba(124,107,240,0.5); }
    #${PANEL} .btn { padding:7px 14px;border-radius:7px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:#ddd;font-size:12px;cursor:pointer; }
    #${PANEL} .btn:hover { background:rgba(255,255,255,0.1);color:#fff; }
    #${PANEL} .btn-p { background:rgba(124,107,240,0.25);border-color:rgba(124,107,240,0.4);color:#a5b4fc; }
    #${PANEL} .btn-p:hover { background:rgba(124,107,240,0.35); }
    #${PANEL} .hint { font-size:10px;color:#888;margin-top:3px;line-height:1.45; }
    #${PANEL} .row { display:flex;gap:8px;align-items:center;margin-bottom:12px; }
    #${PANEL} .close { position:absolute;top:12px;right:14px;background:none;border:none;color:#888;font-size:20px;cursor:pointer;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:50%; }
    #${PANEL} .close:hover { color:#fff;background:rgba(255,255,255,0.08); }
    #${PANEL} .status { margin-top:10px;padding:8px 12px;border-radius:6px;font-size:12px; }
    #${PANEL} .status.ok { background:rgba(74,222,128,0.12);color:#4ade80; }
    #${PANEL} .status.err { background:rgba(248,113,113,0.12);color:#f87171; }
    @media(max-width:560px) {
      #${PANEL} { padding:max(8px, env(safe-area-inset-top)) 8px max(8px, env(safe-area-inset-bottom)) 8px; }
      #${PANEL} .card { max-width:100%;max-height:calc(100dvh - max(16px, env(safe-area-inset-top) + env(safe-area-inset-bottom)));padding:16px;border-radius:10px; }
      #${PANEL} .row { flex-direction:column;align-items:stretch; }
      #${PANEL} .row .btn { width:100%; }
    }
    @media(max-width:420px) {
      #${PANEL} { padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0; }
      #${PANEL} .card { border-radius:0;max-height:100dvh;border-left:none;border-right:none;padding:14px 12px; }
      #${PANEL} h3 { font-size:15px; }
    }
    /* ===== MemoryPilot Day — unified settings surface ===== */
    #${PANEL}{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#352f3c}
    #${PANEL} .mask{background:rgba(55,48,63,.22);backdrop-filter:blur(3px)}
    #${PANEL} .card{max-width:760px;background:#f8f6fb;border-color:#ddd7e5;padding:0;box-shadow:0 18px 54px rgba(63,51,76,.18);color-scheme:light}
    #${PANEL} .topline{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;background:#fff;border-bottom:1px solid #e8e3ed}
    #${PANEL} .topactions{display:flex;align-items:center;gap:4px}
    #${PANEL} .help{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:#756d7e;font-size:17px;cursor:pointer}
    #${PANEL} .help:hover{color:#3f3748;background:#f0ecf5}
    #${PANEL} h3{margin:0;color:#302a37;font-size:18px;letter-spacing:.01em}
    #${PANEL} .close{position:static;color:#756d7e;background:transparent}
    #${PANEL} .close:hover{color:#3f3748;background:#f0ecf5}
    #${PANEL} .hubnav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e8e3ed}
    #${PANEL} .hubtab{min-height:38px;border:1px solid #ded8e6;border-radius:10px;background:#faf9fb;color:#625a6b;font-size:12px;font-weight:600;cursor:pointer}
    #${PANEL} .hubtab:hover{background:#f1edf6;border-color:#c9bfd8}
    #${PANEL} .hubtab.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181}
    #${PANEL} .settingsnav{display:flex;gap:6px;overflow-x:auto;padding:8px 14px;background:#f4f1f7;border-bottom:1px solid #e3dfe8;scrollbar-width:none}
    #${PANEL} .settingsnav::-webkit-scrollbar{display:none}
    #${PANEL} .settab{flex:0 0 auto;padding:7px 12px;border:1px solid #ddd7e5;border-radius:8px;background:#fff;color:#665e6f;font-size:11px;cursor:pointer}
    #${PANEL} .settab.on{background:#e9e1f2;color:#694f85;border-color:#b9a7cd}
    #${PANEL} .formbody{padding:16px 18px 20px}
    #${PANEL} .sectionintro{margin:0 0 14px;color:#4a424f;font-size:13px;font-weight:700}
    #${PANEL} .f label{color:#5d5565;font-size:12px;margin-bottom:5px}
    #${PANEL} .f input,#${PANEL} .f select{min-height:42px;padding:9px 11px;background:#fff!important;color:#342e3a!important;border:1px solid #d9d3e0!important;box-shadow:none!important;filter:none!important;text-shadow:none!important;-webkit-appearance:auto;appearance:auto}
    #${PANEL} .f input:focus,#${PANEL} .f select:focus{border-color:#9e88b8!important;box-shadow:0 0 0 3px rgba(126,102,155,.12)!important}
    #${PANEL} .f input::placeholder{color:#a39ba9}
    #${PANEL} .btn{background:#fff;border-color:#d8d2df;color:#504858;box-shadow:none}
    #${PANEL} .btn:hover{background:#f0ecf4;color:#3e3547}
    #${PANEL} .btn-p{background:#e9e1f2;border-color:#b9a7cd;color:#674f80}
    #${PANEL} .btn-p:hover{background:#ded2eb;color:#533b6d}
    #${PANEL} .hint{color:#766e7e}
    #${PANEL} .status.ok{background:#e7f4ea;color:#3f7450}
    #${PANEL} .status.err{background:#fbe9ea;color:#a84450}
    @media(max-width:560px){
      #${PANEL}{padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom) 0}
      #${PANEL} .card{max-height:100dvh;border-radius:0;border-left:0;border-right:0}
      #${PANEL} .topline{padding:11px 13px}
      #${PANEL} .hubnav{padding:7px 8px;gap:5px}
      #${PANEL} .hubtab{min-height:36px;font-size:11px}
      #${PANEL} .settingsnav{padding:7px 9px}
      #${PANEL} .formbody{padding:14px 12px 20px}
      #${PANEL} .row{flex-direction:row;flex-wrap:wrap}
      #${PANEL} .row .btn{width:auto;flex:1}
    }
  `;
  document.head.appendChild(st);

  const root = document.createElement('div');
  root.id = PANEL;
  root.innerHTML = `
    <div class="mask"></div>
    <div class="card">
      <div class="topline"><h3>MemoryPilot</h3><div class="topactions"><button class="help" id="mpa_help" aria-label="打开新手指引" title="新手指引">?</button><button class="close" id="mpa_close" aria-label="关闭">&times;</button></div></div>
      <nav class="hubnav" aria-label="MemoryPilot 主导航">
        <button class="hubtab" data-hub="memory">记忆管理</button>
        <button class="hubtab" data-hub="monitor">召回监控</button>
        <button class="hubtab on" data-hub="settings">设置</button>
      </nav>
      <nav class="settingsnav" aria-label="设置分类">
        <button class="settab on">API 配置</button>
        <button class="settab" data-open-panel="recall">召回设置</button>
        <button class="settab" data-open-panel="filter">文本过滤</button>
        <button class="settab" data-open-panel="data">数据管理</button>
      </nav>
      <div class="formbody">
      <div class="sectionintro">楼层总结与关键词处理 API</div>

      <div class="f">
        <label>Provider</label>
        <select id="mpa_provider">
          <option value="openai" ${provider==='openai'?'selected':''}>OpenAI兼容</option>
          <option value="claude" ${provider==='claude'?'selected':''}>Claude原生</option>
          <option value="gemini" ${provider==='gemini'?'selected':''}>Gemini原生</option>
        </select>
      </div>

      <div class="f"><label>API URL</label><input id="mpa_url" value="${h(cfg.url||defaultsByProvider[provider].url)}" placeholder=""></div>
      <div class="f"><label>API Key</label><input id="mpa_key" type="password" value="${h(cfg.key||'')}" placeholder=""></div>

      <div class="f" id="mpa_ver_wrap" style="display:${provider==='claude'?'block':'none'}">
        <label>Anthropic-Version</label>
        <input id="mpa_aver" value="${h(cfg.anthropicVersion||'2023-06-01')}" placeholder="2023-06-01">
      </div>

      <div class="f"><label>Max Output Tokens</label><input id="mpa_maxtok" value="${h(cfg.maxTokens==null?'':String(cfg.maxTokens))}" placeholder="留空则不传"></div>
      <div class="f"><label>Temperature</label><input id="mpa_temp" value="${h(cfg.temperature==null?'':String(cfg.temperature))}" placeholder="留空则不传"></div>
      <div class="f"><label>Top P</label><input id="mpa_topp" value="${h(cfg.topP==null?'':String(cfg.topP))}" placeholder="留空则不传"></div>
      <div class="f" id="mpa_topk_wrap"><label>Top K</label><input id="mpa_topk" value="${h(cfg.topK==null?'':String(cfg.topK))}" placeholder="Claude / Gemini 可用"></div>
      <div class="f" id="mpa_pp_wrap"><label>Presence Penalty</label><input id="mpa_pp" value="${h(cfg.presencePenalty==null?'':String(cfg.presencePenalty))}" placeholder="OpenAI兼容可用"></div>
      <div class="f" id="mpa_fp_wrap"><label>Frequency Penalty</label><input id="mpa_fp" value="${h(cfg.frequencyPenalty==null?'':String(cfg.frequencyPenalty))}" placeholder="OpenAI兼容可用"></div>

      <div class="row">
        <button class="btn" id="mpa_fetch">拉取模型列表</button>
        <button class="btn" id="mpa_fill">填入推荐默认值</button>
        <span class="hint" id="mpa_fstat"></span>
      </div>

      <div class="f"><label>选择模型</label>
        <select id="mpa_model"><option value="">-- 请先拉取或手动填写 --</option></select>
      </div>

      <div class="f"><label>或手动输入模型名</label><input id="mpa_manual" value="${h(cfg.model||'')}" placeholder="model name"></div>
      <div class="hint" id="mpa_hint"></div>

      <button class="btn btn-p" id="mpa_save" style="width:100%;padding:10px;font-size:13px;">保存</button>
      <div id="mpa_status"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('[data-hub="memory"]')?.addEventListener('click', () => window.MemoryPilot?.openPanel?.('list'));
  root.querySelector('[data-hub="monitor"]')?.addEventListener('click', () => window.MemoryPilot?.openMonitor?.());
  $('mpa_help').onclick = async () => { await window.MemoryPilot?.openPanel?.('list'); setTimeout(() => document.getElementById('mp_help')?.click(), 180); };
  root.querySelectorAll('[data-open-panel]').forEach(btn => btn.addEventListener('click', () => window.MemoryPilot?.openPanel?.('cfg', btn.getAttribute('data-open-panel'))));

  const applyProviderUI = (mode) => {
    const def = defaultsByProvider[mode] || defaultsByProvider.openai;
    $('mpa_hint').textContent =
      mode === 'openai' ? '用于 OpenAI 兼容网关，发送到 /chat/completions。'
      : mode === 'claude' ? 'Claude 原生会请求 /v1/messages，并附带 x-api-key 与 anthropic-version。'
      : 'Gemini 原生会请求 /models/{model}:generateContent，并使用 x-goog-api-key。';
    $('mpa_ver_wrap').style.display = mode === 'claude' ? 'block' : 'none';
    $('mpa_topk_wrap').style.display = (mode === 'claude' || mode === 'gemini') ? 'block' : 'none';
    $('mpa_pp_wrap').style.display = mode === 'openai' ? 'block' : 'none';
    $('mpa_fp_wrap').style.display = mode === 'openai' ? 'block' : 'none';
    if (!$('mpa_url').value.trim()) $('mpa_url').value = def.url;
    const models = Array.isArray(cfg.models) && cfg.provider===mode ? cfg.models : def.models;
    const sel = $('mpa_model');
    if (models?.length) {
      sel.innerHTML = ['<option value="">-- 请选择 --</option>'].concat(
        models.map(m => `<option value="${h(m)}" ${m===(cfg.model||'')?'selected':''}>${h(m)}</option>`)
      ).join('');
    } else {
      sel.innerHTML = '<option value="">-- 请先拉取或手动填写 --</option>';
    }
  };

  applyProviderUI(provider);

  const close = () => { $(PANEL)?.remove(); $(STYLE)?.remove(); };
  $('mpa_close').onclick = close;
  root.querySelector('.mask').onclick = close;

  $('mpa_provider').onchange = () => {
    const mode = $('mpa_provider').value;
    const def = defaultsByProvider[mode] || defaultsByProvider.openai;
    $('mpa_url').value = def.url;
    if (mode === 'claude' && !$('mpa_aver').value.trim()) $('mpa_aver').value = '2023-06-01';
    applyProviderUI(mode);
  };

  $('mpa_fill').onclick = () => {
    const mode = $('mpa_provider').value;
    const def = defaultsByProvider[mode] || defaultsByProvider.openai;
    $('mpa_url').value = def.url;
    if (mode === 'claude') $('mpa_aver').value = '2023-06-01';
    applyProviderUI(mode);
    $('mpa_fstat').textContent = '已填入默认地址';
  };

  $('mpa_fetch').onclick = async () => {
    const mode = $('mpa_provider').value;
    const url = $('mpa_url').value.trim();
    const key = $('mpa_key').value.trim();
    if (!url || !key) { $('mpa_fstat').textContent = '请先填 URL 和 Key'; return; }
    $('mpa_fstat').textContent = '拉取中...';
    try {
      let models = [];
      if (mode === 'openai') {
        const res = await fetch(normalizeOpenAIBase(url) + '/models', {
          headers: { 'Authorization': 'Bearer ' + key }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        models = (data.data || []).map(m => m.id).filter(Boolean).sort();
      } else if (mode === 'claude') {
        const res = await fetch(normalizeClaudeBase(url) + '/v1/models', {
          headers: {
            'x-api-key': key,
            'anthropic-version': $('mpa_aver').value.trim() || '2023-06-01'
          }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        models = (data.data || []).map(m => m.id || m.name).filter(Boolean);
      } else {
        const res = await fetch(normalizeGeminiBase(url) + '/models', {
          headers: { 'x-goog-api-key': key }
        });
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        models = (data.models || []).map(m => String(m.name || '').replace(/^models\//,'')).filter(Boolean);
      }

      if (!models.length) throw new Error('未返回模型');
      const sel = $('mpa_model');
      sel.innerHTML = ['<option value="">-- 请选择 --</option>'].concat(
        models.map(m => `<option value="${h(m)}">${h(m)}</option>`)
      ).join('');
      $('mpa_fstat').textContent = models.length + ' 个模型';
      cfg.models = models;
      cfg.provider = mode;
    } catch (e) {
      $('mpa_fstat').textContent = '失败: ' + e.message;
    }
  };

  $('mpa_save').onclick = async () => {
    const mode = $('mpa_provider').value;
    const rawUrl = $('mpa_url').value.trim();
    const normalizedUrl = mode === 'claude' ? normalizeClaudeBase(rawUrl) : mode === 'gemini' ? normalizeGeminiBase(rawUrl) : normalizeOpenAIBase(rawUrl);
    const c = {
      provider: mode,
      url: normalizedUrl,
      key: $('mpa_key').value.trim(),
      model: $('mpa_model').value || $('mpa_manual').value.trim(),
      models: cfg.models || defaultsByProvider[mode].models || [],
      maxTokens: $('mpa_maxtok').value.trim()==='' ? undefined : Number($('mpa_maxtok').value.trim()),
      temperature: $('mpa_temp').value.trim()==='' ? undefined : Number($('mpa_temp').value.trim()),
      topP: $('mpa_topp').value.trim()==='' ? undefined : Number($('mpa_topp').value.trim()),
      topK: $('mpa_topk').value.trim()==='' ? undefined : Number($('mpa_topk').value.trim()),
      presencePenalty: $('mpa_pp').value.trim()==='' ? undefined : Number($('mpa_pp').value.trim()),
      frequencyPenalty: $('mpa_fp').value.trim()==='' ? undefined : Number($('mpa_fp').value.trim()),
      anthropicVersion: $('mpa_aver')?.value?.trim?.() || '2023-06-01'
    };
    await save(c);
    $('mpa_status').innerHTML = '<div class="status ok">已保存，并同步到当前聊天文件</div>';
    toastr?.success?.('API 配置已保存');
  };
})();
}
