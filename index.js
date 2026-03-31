// MemoryPilot - SillyTavern Extension
// Storage: extensionSettings (server-synced, outside chat jsonl)
// Prompt injection: chatMetadata.variables only (for {{getvar::}} macro)
// ZERO STscript /setvar calls — immune to LWB_SNAP snapshot bloat

import { runRecall as runRecallV34 } from './src/recall-v34.js';
import { runRecall as runRecallV32 } from './src/recall-v32.js';
import { openPanel } from './src/panel.js';
import { openApiConfig } from './src/api-config.js';
import { openMonitor } from './src/monitor.js';
import { migrateIfNeeded, detectLegacyArtifacts, cleanupLegacyArtifacts, onChatChanged } from './src/storage.js';

const MODULE_NAME = 'MemoryPilot';

function getSettings() {
  const { extensionSettings } = SillyTavern.getContext();
  if (!extensionSettings[MODULE_NAME]) {
    extensionSettings[MODULE_NAME] = {};
  }
  const s = extensionSettings[MODULE_NAME];
  if (!s._global) {
    s._global = {
      recallVersion: 'v34',
      customPrompts: {},
      autoSummarize: false,
      autoSummarizeEvery: 20,
    };
  }
  if (s._global.autoSummarize == null) s._global.autoSummarize = false;
  if (s._global.autoSummarizeEvery == null) s._global.autoSummarizeEvery = 20;
  return s._global;
}

function saveSettings() {
  try { SillyTavern.getContext().saveSettingsDebounced(); } catch {}
}

async function runRecall() {
  const settings = getSettings();
  if (settings.recallVersion === 'v32') {
    await runRecallV32();
  } else {
    await runRecallV34();
  }
}

// ====== Custom Prompt Management ======

export function getCustomPrompt(key, defaultValue) {
  const settings = getSettings();
  const val = settings.customPrompts?.[key];
  return (val != null && val !== '') ? val : defaultValue;
}

export function saveCustomPrompt(key, value) {
  const settings = getSettings();
  if (!settings.customPrompts) settings.customPrompts = {};
  settings.customPrompts[key] = value;
  saveSettings();
}

export function resetCustomPrompt(key) {
  const settings = getSettings();
  if (settings.customPrompts) delete settings.customPrompts[key];
  saveSettings();
}

export function getRecallVersion() {
  return getSettings().recallVersion || 'v34';
}

window.MemoryPilot = {
  getCustomPrompt,
  saveCustomPrompt,
  resetCustomPrompt,
  getRecallVersion,
  getSettings,
  saveSettings,
  openPanel,
  openApiConfig,
  openMonitor,
  detectLegacyArtifacts,
  cleanupLegacyArtifacts,
};

// ====== Chat Input Bar Buttons (same position as original taskjs) ======

function addChatBarButtons() {
  if (document.getElementById('mp_chat_buttons')) return;

  const bar = document.createElement('div');
  bar.id = 'mp_chat_buttons';
  bar.className = 'mp-chat-bar';
  bar.innerHTML = `
    <button id="mp_btn_panel" class="mp-chat-btn" title="MP 管理面板">🧭 MP 管理面板</button>
    <button id="mp_btn_api" class="mp-chat-btn" title="MP API配置">🧭 MP API配置</button>
    <button id="mp_btn_monitor" class="mp-chat-btn" title="MP 召回监控">🧭 MP 召回监控</button>
  `;

  // Insert above the chat input form - same position as taskjs buttons
  const targets = [
    '#qr--bar',                    // Quick Reply bar (if present, insert before it)
    '#form_sheld',                 // The send form container
    '#send_form',                  // The actual send form
  ];

  let inserted = false;
  for (const sel of targets) {
    const target = document.querySelector(sel);
    if (target) {
      target.parentNode.insertBefore(bar, target);
      inserted = true;
      break;
    }
  }

  if (!inserted) {
    // Fallback: append to the chat area
    const sheld = document.getElementById('sheld');
    if (sheld) sheld.appendChild(bar);
  }

  document.getElementById('mp_btn_panel').addEventListener('click', () => openPanel());
  document.getElementById('mp_btn_api').addEventListener('click', () => openApiConfig());
  document.getElementById('mp_btn_monitor').addEventListener('click', () => openMonitor());
}

// ====== Settings Panel in Extensions Drawer ======

function buildSettingsHtml() {
  const settings = getSettings();
  return `
    <div class="mp-settings-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>🧭 MemoryPilot</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">
            <div style="display:flex;align-items:center;gap:8px">
              <label style="min-width:80px">召回引擎</label>
              <select id="mp_recall_version" class="text_pole" style="flex:1">
                <option value="v34" ${settings.recallVersion === 'v34' ? 'selected' : ''}>v34 (推荐 - 支持 low 优先级分层)</option>
                <option value="v32" ${settings.recallVersion === 'v32' ? 'selected' : ''}>v32 (经典)</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
              <label style="display:flex;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" id="mp_auto_summarize" ${settings.autoSummarize ? 'checked' : ''}>自动总结</label>
              <label style="min-width:40px;font-size:11px">每</label>
              <input type="number" id="mp_auto_summarize_every" class="text_pole" style="width:60px" min="5" max="200" value="${settings.autoSummarizeEvery || 20}">
              <span style="font-size:11px;color:#888">条消息</span>
            </div>
            <div class="mp-info" style="font-size:11px;opacity:0.6;line-height:1.5">
              存储: extensionSettings · 零 /setvar · 不被 LWB 快照
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindSettingsEvents() {
  $('#mp_recall_version').on('change', function() {
    getSettings().recallVersion = $(this).val();
    saveSettings();
    toastr.success(`召回引擎切换为 ${$(this).val()}`);
  });
  $('#mp_auto_summarize').on('change', function() {
    getSettings().autoSummarize = this.checked;
    saveSettings();
    toastr.success(this.checked ? '自动总结已开启' : '自动总结已关闭');
  });
  $('#mp_auto_summarize_every').on('change', function() {
    const v = Math.max(5, Math.min(200, parseInt($(this).val()) || 20));
    $(this).val(v);
    getSettings().autoSummarizeEvery = v;
    saveSettings();
  });
}

// ====== Event Hooks ======

function hookRecall() {
  try {
    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async () => {
      try { await runRecall(); } catch (e) { console.error('[MP] Recall error:', e); }
      // Auto-summarize
      try {
        const s = getSettings();
        if (s.autoSummarize) {
          const c = SillyTavern.getContext();
          const chatLen = c?.chat?.length || 0;
          const interval = s.autoSummarizeEvery || 20;
          const store = c?.extensionSettings?.['MemoryPilot'];
          const charId = c?.characterId;
          const charObj = Number.isInteger(charId) ? c?.characters?.[charId] : null;
          const charScope = String(charObj?.avatar ?? charObj?.name ?? c?.chatMetadata?.character_name ?? c?.name2 ?? '');
          const ck = String(c.chatId ?? c.chatMetadata?.chat_file_name ?? 'default') + '::' + charScope;
          if (store && store[ck]) {
            const lastAutoFloor = store[ck]._lastAutoSummarizeFloor || 0;
            if (chatLen - lastAutoFloor >= interval) {
              store[ck]._lastAutoSummarizeFloor = chatLen;
              saveSettings();
              console.log('[MP] Auto-summarize triggered at floor ' + chatLen + ' (from ' + (lastAutoFloor + 1) + ')');
              // Run the actual analysis in background
              try {
                // Read API config
                const apiCfg = store[ck]?.mp_api_config || {};
                const provider = apiCfg.provider || 'openai';
                const model = apiCfg.model || '';
                const key = apiCfg.key || '';
                const rawBase = apiCfg.url || '';
                if (!key || !model) {
                  console.warn('[MP] Auto-summarize: API not configured');
                } else {
                  // Build prompt from the shared analysis prompt
                  const promptTemplate = getCustomPrompt('analysis', null);
                  if (promptTemplate) {
                    const chat = c.chat || [];
                    const fromIdx = Math.max(0, lastAutoFloor);
                    const toIdx = Math.min(chatLen, chat.length);
                    const uL = c.name1 || '用户', cL = c.name2 || '角色';
                    const text = [];
                    for (let i = fromIdx; i < toIdx; i++) {
                      const m = chat[i];
                      if (!m || !m.mes) continue;
                      const body = String(m.mes).replace(/<\s*think\b[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi, ' ').trim();
                      if (!body) continue;
                      text.push('#' + (i + 1) + '[' + (m.is_user ? uL : (m.name || cL)) + ']' + body);
                    }
                    if (text.length >= 3) {
                      const prompt = promptTemplate.replace('{{content}}', text.join('\n'));
                      // Normalize base URL
                      const base = provider === 'claude'
                        ? String(rawBase || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1\/messages$/i, '')
                        : provider === 'gemini'
                          ? String(rawBase || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '').replace(/\/models\/.*$/i, '')
                          : String(rawBase || '').replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
                      // Call LLM
                      let url, headers, body;
                      if (provider === 'claude') {
                        url = base + '/v1/messages';
                        headers = { 'x-api-key': key, 'anthropic-version': apiCfg.anthropicVersion || '2023-06-01', 'content-type': 'application/json' };
                        body = JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] });
                      } else if (provider === 'gemini') {
                        url = base + '/models/' + encodeURIComponent(model) + ':generateContent';
                        headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };
                        body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } });
                      } else {
                        url = base + '/chat/completions';
                        headers = { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
                        body = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 });
                      }
                      const res = await fetch(url, { method: 'POST', headers, body });
                      if (res.ok) {
                        const d = await res.json();
                        let resultText = '';
                        if (provider === 'claude') resultText = (d.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
                        else if (provider === 'gemini') resultText = (d.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('\n');
                        else resultText = d.choices?.[0]?.message?.content || '';
                        // Parse results and store as pending
                        const parsed = [];
                        const lines = resultText.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                        for (const line of lines) {
                          try {
                            const raw = line.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
                            const o = JSON.parse(raw);
                            if (o && o.event && o.summary) parsed.push(o);
                          } catch {}
                        }
                        if (!parsed.length) {
                          // Try brace matching
                          let depth = 0, start = -1;
                          for (let i = 0; i < resultText.length; i++) {
                            if (resultText[i] === '{') { if (depth === 0) start = i; depth++; }
                            else if (resultText[i] === '}') { depth--; if (depth === 0 && start >= 0) {
                              try { const o = JSON.parse(resultText.slice(start, i + 1)); if (o?.event && o?.summary) parsed.push(o); } catch {}
                              start = -1;
                            }}
                          }
                        }
                        if (parsed.length) {
                          const gid = () => 'mp_' + Math.random().toString(36).slice(2, 10);
                          const nms = parsed.map(o => ({
                            ...o, id: gid(), timestamp: Date.now(),
                            primaryKeywords: Array.isArray(o.primaryKeywords) ? o.primaryKeywords : (Array.isArray(o.keywords) ? o.keywords : []),
                            secondaryKeywords: Array.isArray(o.secondaryKeywords) ? o.secondaryKeywords : [],
                            entityKeywords: Array.isArray(o.entityKeywords) ? o.entityKeywords : [],
                            source: 'auto',
                            floorRange: Array.isArray(o.floorRange) && o.floorRange.length >= 2 ? o.floorRange : [fromIdx + 1, toIdx],
                            timeLabel: o.timeLabel || '第' + (fromIdx + 1) + '-' + toIdx + '层',
                          }));
                          // Store as pending for user to confirm in panel
                          try { localStorage.setItem('mp_pending_ops', JSON.stringify({ auto: { status: 'done', message: nms.length + '条自动提取', resultCount: nms.length, updatedAt: Date.now() } })); } catch {}
                          try { localStorage.setItem('mp_pending_ops_results_auto', JSON.stringify(nms)); } catch {}
                          toastr?.info?.('MemoryPilot 自动总结完成：提取 ' + nms.length + ' 条记忆，请在管理面板确认。');
                          console.log('[MP] Auto-summarize done: ' + nms.length + ' memories extracted');
                        } else {
                          console.warn('[MP] Auto-summarize: LLM returned content but no valid JSON');
                        }
                      } else {
                        console.warn('[MP] Auto-summarize API error: ' + res.status);
                      }
                    }
                  }
                }
              } catch (autoErr) { console.warn('[MP] Auto-summarize LLM error:', autoErr); }
            }
          }
        }
      } catch (e) { console.warn('[MP] Auto-summarize check error:', e); }
    });
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, async () => {
      try { onChatChanged(); } catch {}
      try {
        const prev = localStorage.getItem('mp_active_chat');
        const charId = ctx?.characterId;
        const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
        const curr = `${String(ctx.chatId ?? ctx.chatMetadata?.chat_file_name ?? '')}::${String(charObj?.avatar ?? charObj?.name ?? ctx?.chatMetadata?.character_name ?? ctx?.name2 ?? '')}`;
        if (prev && prev !== curr) {
          try { localStorage.removeItem('mp_memories_' + prev); } catch {}
        }
        localStorage.setItem('mp_active_chat', curr);
      } catch {}
      try {
        await migrateIfNeeded();
        const report = detectLegacyArtifacts();
        if (report.hasLegacyMpMetadata || report.hasLegacyMpVars || report.lwbSnapHasMpTraces) {
          toastr?.info?.('检测到当前聊天存在旧版 MP / LWB 快照痕迹，可在 MP 面板 → 过滤 中清理。');
        }
      } catch (e) { console.warn('[MP] detect legacy err', e); }
    });
  } catch (e) {
    console.warn('[MP] Could not hook events:', e);
  }
}

// ====== Init ======

// ====== Activation Gate (SHA-256 hash verification) ======
const MP_ACTIVATION_KEY = 'mp_activation_verified';

// Only SHA-256 hashes are stored — original codes are NOT in source.
// To add a new code: sha256(CODE.toUpperCase()) and add the hex hash here.
const MP_VALID_HASHES = new Set([
  '8daf8d6aed1de8bd58aa35f4fe6c7b50a04a4a5458044d27e554c5ce4c5e1a9f',
  '8480d467d4dd07d3e1f03c1192c30c63ab261b027a929aee44f0ebd05c401e8a',
  'b43dcdec36652e9d347bb66b2ac8d406b98b95fd9c78d5c41557535023e8ce23',
]);

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isActivated() {
  try {
    const v = localStorage.getItem(MP_ACTIVATION_KEY);
    return v === 'true';
  } catch { return false; }
}

function showActivationDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;font-family:-apple-system,sans-serif';
    overlay.innerHTML = `
      <div style="background:#222327;border-radius:14px;padding:24px 28px;max-width:360px;width:90%;border:1px solid rgba(255,255,255,0.1);box-shadow:0 16px 50px rgba(0,0,0,0.6)">
        <h3 style="color:#fff;margin:0 0 12px;font-size:16px">🧭 MemoryPilot 激活</h3>
        <p style="color:#aaa;font-size:12px;margin:0 0 16px;line-height:1.5">请输入激活码以使用 MemoryPilot v3.5。<br>一次验证，永久有效（同浏览器）。</p>
        <input id="mp_act_code" type="text" placeholder="请输入激活码…" style="width:100%;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.3);color:#eee;font-size:14px;box-sizing:border-box;margin-bottom:12px">
        <div id="mp_act_err" style="color:#f87171;font-size:11px;margin-bottom:10px;display:none"></div>
        <div style="display:flex;gap:8px">
          <button id="mp_act_submit" style="flex:1;padding:10px;border-radius:8px;border:none;background:rgba(124,107,240,0.8);color:#fff;font-size:13px;cursor:pointer;font-weight:600">激活</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#mp_act_code');
    const errEl = overlay.querySelector('#mp_act_err');
    const submit = overlay.querySelector('#mp_act_submit');
    let checking = false;
    const doSubmit = async () => {
      if (checking) return;
      checking = true;
      submit.textContent = '验证中…';
      submit.style.opacity = '0.6';
      try {
        const code = (input.value || '').trim().toUpperCase();
        if (!code) { throw new Error('请输入激活码'); }
        const hash = await sha256Hex(code);
        if (MP_VALID_HASHES.has(hash)) {
          try { localStorage.setItem(MP_ACTIVATION_KEY, 'true'); } catch {}
          overlay.remove();
          resolve(true);
          return;
        }
        throw new Error('激活码无效，请重新输入。');
      } catch (e) {
        errEl.style.display = '';
        errEl.textContent = e.message || '验证失败';
        input.style.borderColor = 'rgba(248,113,113,0.5)';
      } finally {
        checking = false;
        submit.textContent = '激活';
        submit.style.opacity = '';
      }
    };
    submit.onclick = doSubmit;
    input.onkeydown = (e) => { if (e.key === 'Enter') doSubmit(); };
    input.focus();
  });
}

jQuery(async () => {
  console.log(`[${MODULE_NAME}] Extension loaded (recall: ${getSettings().recallVersion})`);

  // Activation check
  if (!isActivated()) {
    const ok = await showActivationDialog();
    if (!ok) return;
  }

  const ctx = SillyTavern.getContext();
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = {};
  }

  try {
    await migrateIfNeeded();
    const report = detectLegacyArtifacts();
    if (report.hasLegacyMpMetadata || report.hasLegacyMpVars || report.lwbSnapHasMpTraces) {
      toastr?.info?.('检测到当前聊天存在旧版 MP / LWB 快照痕迹，可在 MP 面板 → 过滤 中清理。');
    }
  } catch (e) { console.warn('[MP] startup migration err', e); }

  // Settings panel in extensions drawer
  const html = buildSettingsHtml();
  $('#extensions_settings2').append(html);
  bindSettingsEvents();

  // Buttons above chat input (like original taskjs)
  addChatBarButtons();

  // Re-add buttons if chat area is rebuilt
  ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
    setTimeout(() => addChatBarButtons(), 500);
  });

  hookRecall();
});
