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
            <div style="font-size:10px;color:#777;line-height:1.4;margin-top:4px;padding-left:2px">
              共用「MP API配置」的接口 + 「分析」页的总结 Prompt。<br>
              结果不会自动写入，需在管理面板「分析」页顶部横幅确认。
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
            // Handle reroll/delete: if chat shortened, adjust marker down
            if (chatLen < lastAutoFloor) {
              store[ck]._lastAutoSummarizeFloor = chatLen;
              saveSettings();
              console.log('[MP] Auto-summarize: chat shortened (reroll/delete), adjusted marker to ' + chatLen);
            }
            // Track history of all summarized ranges
            if (!store[ck]._autoSummarizeHistory) store[ck]._autoSummarizeHistory = [];
            const effectiveLastFloor = Math.min(store[ck]._lastAutoSummarizeFloor || 0, chatLen);
            // Trigger when enough new messages since last summarize point
            if (chatLen - effectiveLastFloor >= interval) {
              const fromIdx = effectiveLastFloor;
              const toIdx = chatLen;
              store[ck]._lastAutoSummarizeFloor = toIdx;
              // Record this range
              store[ck]._autoSummarizeHistory.push({ from: fromIdx + 1, to: toIdx, time: Date.now(), status: 'running' });
              // Keep only last 50 history entries
              if (store[ck]._autoSummarizeHistory.length > 50) store[ck]._autoSummarizeHistory = store[ck]._autoSummarizeHistory.slice(-50);
              saveSettings();
              console.log('[MP] Auto-summarize triggered: floor ' + (fromIdx + 1) + '-' + toIdx);
              // Run the actual analysis in background
              try {
                const apiCfg = store[ck]?.mp_api_config || {};
                const provider = apiCfg.provider || 'openai';
                const model = apiCfg.model || '';
                const key = apiCfg.key || '';
                const rawBase = apiCfg.url || '';
                if (!key || !model) {
                  console.warn('[MP] Auto-summarize: API not configured');
                  store[ck]._autoSummarizeHistory[store[ck]._autoSummarizeHistory.length - 1].status = 'error_no_api';
                  saveSettings();
                } else {
                  const promptTemplate = getCustomPrompt('analysis', null);
                  if (promptTemplate) {
                    const chat = c.chat || [];
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
                      const base = provider === 'claude'
                        ? String(rawBase || 'https://api.anthropic.com').replace(/\/+$/, '').replace(/\/v1\/messages$/i, '')
                        : provider === 'gemini'
                          ? String(rawBase || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '').replace(/\/models\/.*$/i, '')
                          : String(rawBase || '').replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
                      let url, headers, reqBody;
                      if (provider === 'claude') {
                        url = base + '/v1/messages';
                        headers = { 'x-api-key': key, 'anthropic-version': apiCfg.anthropicVersion || '2023-06-01', 'content-type': 'application/json' };
                        reqBody = JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] });
                      } else if (provider === 'gemini') {
                        url = base + '/models/' + encodeURIComponent(model) + ':generateContent';
                        headers = { 'x-goog-api-key': key, 'content-type': 'application/json' };
                        reqBody = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } });
                      } else {
                        url = base + '/chat/completions';
                        headers = { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
                        reqBody = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 });
                      }
                      const res = await fetch(url, { method: 'POST', headers, body: reqBody });
                      if (res.ok) {
                        const d = await res.json();
                        let resultText = '';
                        if (provider === 'claude') resultText = (d.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
                        else if (provider === 'gemini') resultText = (d.candidates || []).flatMap(cc => cc?.content?.parts || []).map(p => p?.text || '').join('\n');
                        else resultText = d.choices?.[0]?.message?.content || '';
                        const parsed = [];
                        let depth = 0, start = -1;
                        for (let i = 0; i < resultText.length; i++) {
                          if (resultText[i] === '{') { if (depth === 0) start = i; depth++; }
                          else if (resultText[i] === '}') { depth--; if (depth === 0 && start >= 0) {
                            try { const o = JSON.parse(resultText.slice(start, i + 1)); if (o?.event && o?.summary) parsed.push(o); } catch {}
                            start = -1;
                          }}
                        }
                        if (parsed.length) {
                          const mkid = () => 'mp_' + Math.random().toString(36).slice(2, 10);
                          const nms = parsed.map(o => ({
                            ...o, id: mkid(), timestamp: Date.now(),
                            primaryKeywords: Array.isArray(o.primaryKeywords) ? o.primaryKeywords : (Array.isArray(o.keywords) ? o.keywords : []),
                            secondaryKeywords: Array.isArray(o.secondaryKeywords) ? o.secondaryKeywords : [],
                            entityKeywords: Array.isArray(o.entityKeywords) ? o.entityKeywords : [],
                            source: 'auto',
                            floorRange: Array.isArray(o.floorRange) && o.floorRange.length >= 2 ? o.floorRange : [fromIdx + 1, toIdx],
                            timeLabel: o.timeLabel || '第' + (fromIdx + 1) + '-' + toIdx + '层',
                          }));
                          // Append to existing pending auto results (not overwrite)
                          let existing = [];
                          try { const raw = localStorage.getItem('mp_pending_ops_results_auto'); if (raw) existing = JSON.parse(raw); } catch {}
                          if (!Array.isArray(existing)) existing = [];
                          const all = [...existing, ...nms];
                          try { localStorage.setItem('mp_pending_ops', JSON.stringify({ auto: { status: 'done', message: all.length + '条自动提取（累计）', resultCount: all.length, updatedAt: Date.now() } })); } catch {}
                          try { localStorage.setItem('mp_pending_ops_results_auto', JSON.stringify(all)); } catch {}
                          // Update history
                          store[ck]._autoSummarizeHistory[store[ck]._autoSummarizeHistory.length - 1].status = 'done';
                          store[ck]._autoSummarizeHistory[store[ck]._autoSummarizeHistory.length - 1].count = nms.length;
                          saveSettings();
                          toastr?.info?.('MemoryPilot 自动总结完成（#' + (fromIdx + 1) + '-' + toIdx + '）：' + nms.length + ' 条，请在面板确认。');
                        } else {
                          store[ck]._autoSummarizeHistory[store[ck]._autoSummarizeHistory.length - 1].status = 'empty';
                          saveSettings();
                        }
                      } else {
                        store[ck]._autoSummarizeHistory[store[ck]._autoSummarizeHistory.length - 1].status = 'error_' + res.status;
                        saveSettings();
                      }
                    }
                  }
                }
              } catch (autoErr) {
                console.warn('[MP] Auto-summarize LLM error:', autoErr);
                try { store[ck]._autoSummarizeHistory[store[ck]._autoSummarizeHistory.length - 1].status = 'error'; saveSettings(); } catch {}
              }
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

// showActivationDialog removed — activation is now inline in the settings panel

jQuery(async () => {
  console.log(`[${MODULE_NAME}] Extension loaded (recall: ${getSettings().recallVersion})`);

  const ctx = SillyTavern.getContext();
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = {};
  }

  // Settings panel always loads (so user can enter activation code)
  const html = buildSettingsHtml();
  $('#extensions_settings2').append(html);
  bindSettingsEvents();

  // Activation check — if not activated, show inline activation UI, don't init features
  if (!isActivated()) {
    renderActivationUI();
    return;
  }

  // Full init (only after activation)
  initFeatures();
});

function renderActivationUI() {
  // Show activation prompt inside the settings panel, not as a fullscreen overlay
  const container = document.querySelector('.mp-settings-panel .inline-drawer-content');
  if (!container) return;
  const div = document.createElement('div');
  div.id = 'mp_activation_inline';
  div.style.cssText = 'padding:10px 0;border-top:1px solid rgba(255,255,255,0.08);margin-top:8px';
  div.innerHTML = `
    <div style="color:#fbbf24;font-size:12px;font-weight:600;margin-bottom:6px">🔒 需要激活码</div>
    <div style="font-size:11px;color:#888;margin-bottom:8px">输入激活码后解锁全部功能。不影响酒馆其他功能。</div>
    <div style="display:flex;gap:6px">
      <input id="mp_act_code_inline" type="text" class="text_pole" placeholder="输入激活码…" style="flex:1">
      <button id="mp_act_submit_inline" class="menu_button" style="white-space:nowrap">激活</button>
    </div>
    <div id="mp_act_err_inline" style="color:#f87171;font-size:11px;margin-top:4px;display:none"></div>
  `;
  container.appendChild(div);
  const input = document.getElementById('mp_act_code_inline');
  const submit = document.getElementById('mp_act_submit_inline');
  const errEl = document.getElementById('mp_act_err_inline');
  const doActivate = async () => {
    const code = (input?.value || '').trim().toUpperCase();
    if (!code) { errEl.style.display = ''; errEl.textContent = '请输入激活码'; return; }
    const hash = await sha256Hex(code);
    if (MP_VALID_HASHES.has(hash)) {
      try { localStorage.setItem(MP_ACTIVATION_KEY, 'true'); } catch {}
      div.innerHTML = '<div style="color:#4ade80;font-size:12px;padding:8px 0">✅ 激活成功！正在加载…</div>';
      toastr?.success?.('MemoryPilot 已激活');
      setTimeout(() => { initFeatures(); div.remove(); }, 500);
    } else {
      errEl.style.display = ''; errEl.textContent = '激活码无效';
    }
  };
  submit?.addEventListener('click', doActivate);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doActivate(); });
}

function initFeatures() {
  const ctx = SillyTavern.getContext();

  try {
    migrateIfNeeded().then(() => {
      const report = detectLegacyArtifacts();
      if (report.hasLegacyMpMetadata || report.hasLegacyMpVars || report.lwbSnapHasMpTraces) {
        toastr?.info?.('检测到当前聊天存在旧版 MP / LWB 快照痕迹，可在 MP 面板 → 过滤 中清理。');
      }
    });
  } catch (e) { console.warn('[MP] startup migration err', e); }

  // Buttons above chat input
  addChatBarButtons();

  // Re-add buttons if chat area is rebuilt
  ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
    setTimeout(() => addChatBarButtons(), 500);
  });

  hookRecall();
}
