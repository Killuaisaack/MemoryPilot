// MemoryPilot v4.0.0 - SillyTavern Extension
// v4.0.0: Layered Memory (分层记忆锚点 + 时间线 + AI 智能召回)
// Storage: extensionSettings (server-synced, outside chat jsonl)
// Prompt injection: chatMetadata.variables only (for {{getvar::}} macro)
// ZERO STscript /setvar calls — immune to LWB_SNAP snapshot bloat
//
// New injection variables:
//   {{getvar::mp_layered_ctx}}       — 分层锚点 + 时间线（永久注入）
//   {{getvar::mp_recall_narrative}}  — AI 召回代理生成的回忆叙事

import { runRecall as runRecallV34 } from './src/recall-v34.js';
import { runRecall as runRecallV32 } from './src/recall-v32.js';
import { openPanel } from './src/panel.js';
import { openApiConfig } from './src/api-config.js';
import { openMonitor } from './src/monitor.js';
import { openAnchorPanel } from './src/anchor-panel.js';
import { injectLayered, getLayeredStats } from './src/layered-memory.js';
import { migrateIfNeeded, detectLegacyArtifacts, cleanupLegacyArtifacts, onChatChanged } from './src/storage.js';

const MODULE_NAME = 'MemoryPilot';

function getSettings() {
  const { extensionSettings } = SillyTavern.getContext();
  if (!extensionSettings[MODULE_NAME]) extensionSettings[MODULE_NAME] = {};
  const s = extensionSettings[MODULE_NAME];
  if (!s._global) s._global = { recallVersion: 'v34', customPrompts: {}, autoSummarize: false, autoSummarizeEvery: 20 };
  if (s._global.autoSummarize == null) s._global.autoSummarize = false;
  if (s._global.autoSummarizeEvery == null) s._global.autoSummarizeEvery = 20;
  return s._global;
}

function saveSettings() { try { SillyTavern.getContext().saveSettingsDebounced(); } catch {} }

async function runRecall() {
  const settings = getSettings();
  if (settings.recallVersion === 'v32') await runRecallV32();
  else await runRecallV34();
  // v4.0.0: Always inject layered memories (permanent, every turn)
  try { injectLayered(); } catch (e) { console.warn('[MP] layered inject err', e); }
}

// ====== Custom Prompt Management ======
export function getCustomPrompt(key, defaultValue) { const s = getSettings(); const v = s.customPrompts?.[key]; return (v != null && v !== '') ? v : defaultValue; }
export function saveCustomPrompt(key, value) { const s = getSettings(); if (!s.customPrompts) s.customPrompts = {}; s.customPrompts[key] = value; saveSettings(); }
export function resetCustomPrompt(key) { const s = getSettings(); if (s.customPrompts) delete s.customPrompts[key]; saveSettings(); }
export function getRecallVersion() { return getSettings().recallVersion || 'v34'; }

window.MemoryPilot = {
  getCustomPrompt, saveCustomPrompt, resetCustomPrompt, getRecallVersion,
  getSettings, saveSettings, openPanel, openApiConfig, openMonitor, openAnchorPanel,
  detectLegacyArtifacts, cleanupLegacyArtifacts, getLayeredStats,
};

// ====== Chat Input Bar Buttons ======
function addChatBarButtons() {
  if (document.getElementById('mp_chat_buttons')) return;
  const bar = document.createElement('div');
  bar.id = 'mp_chat_buttons'; bar.className = 'mp-chat-bar';
  bar.innerHTML = `
    <button id="mp_btn_panel" class="mp-chat-btn" title="MP 管理面板">🧭 管理面板</button>
    <button id="mp_btn_anchor" class="mp-chat-btn mp-chat-btn-anchor" title="MP 分层记忆">⚓ 分层记忆</button>
    <button id="mp_btn_api" class="mp-chat-btn" title="MP API配置">🧭 API配置</button>
    <button id="mp_btn_monitor" class="mp-chat-btn" title="MP 召回监控">🧭 召回监控</button>
  `;
  const targets = ['#qr--bar', '#form_sheld', '#send_form'];
  let inserted = false;
  for (const sel of targets) { const t = document.querySelector(sel); if (t) { t.parentNode.insertBefore(bar, t); inserted = true; break; } }
  if (!inserted) { const s = document.getElementById('sheld'); if (s) s.appendChild(bar); }
  document.getElementById('mp_btn_panel').addEventListener('click', () => openPanel());
  document.getElementById('mp_btn_anchor').addEventListener('click', () => openAnchorPanel());
  document.getElementById('mp_btn_api').addEventListener('click', () => openApiConfig());
  document.getElementById('mp_btn_monitor').addEventListener('click', () => openMonitor());
}

// ====== Settings Panel ======
function buildSettingsHtml() {
  const settings = getSettings();
  return `<div class="mp-settings-panel"><div class="inline-drawer"><div class="inline-drawer-toggle inline-drawer-header"><b>🧭 MemoryPilot</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div><div class="inline-drawer-content"><div style="display:flex;flex-direction:column;gap:8px;padding:8px 0">
    <div style="display:flex;align-items:center;gap:8px"><label style="min-width:80px">召回引擎</label><select id="mp_recall_version" class="text_pole" style="flex:1"><option value="v34" ${settings.recallVersion==='v34'?'selected':''}>v34 (推荐)</option><option value="v32" ${settings.recallVersion==='v32'?'selected':''}>v32 (经典)</option></select></div>
    <div style="display:flex;align-items:center;gap:8px;margin-top:6px"><label style="display:flex;align-items:center;gap:6px;white-space:nowrap"><input type="checkbox" id="mp_auto_summarize" ${settings.autoSummarize?'checked':''}>自动总结</label><label style="min-width:40px;font-size:11px">每</label><input type="number" id="mp_auto_summarize_every" class="text_pole" style="width:60px" min="5" max="200" value="${settings.autoSummarizeEvery||20}"><span style="font-size:11px;color:#888">条消息</span></div>
    <div style="font-size:10px;color:#777;line-height:1.4;margin-top:4px;padding-left:2px">共用「MP API配置」的接口 + 「分析」页的总结 Prompt。</div>
    <div style="border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;margin-top:4px">
      <div style="font-size:11px;color:#34d399;font-weight:500;margin-bottom:4px">⚓ 分层记忆 v4.0</div>
      <div style="font-size:10px;color:#777;line-height:1.5">
        永久锚点 + 时间线 + AI 智能召回，独立于记忆列表。<br>
        点击聊天栏「⚓ 分层记忆」按钮管理。<br>
        注入变量：<br>
        <code style="color:#a78bfa;font-size:10px">{{getvar::mp_layered_ctx}}</code> 锚点+时间线<br>
        <code style="color:#818cf8;font-size:10px">{{getvar::mp_recall_narrative}}</code> AI回忆叙事
      </div>
    </div>
    <div class="mp-info" style="font-size:11px;opacity:0.6;line-height:1.5">v4.0.0 · extensionSettings · 零 /setvar</div>
  </div></div></div></div>`;
}

function bindSettingsEvents() {
  $('#mp_recall_version').on('change', function() { getSettings().recallVersion = $(this).val(); saveSettings(); toastr.success('召回引擎切换为 ' + $(this).val()); });
  $('#mp_auto_summarize').on('change', function() { getSettings().autoSummarize = this.checked; saveSettings(); toastr.success(this.checked ? '自动总结已开启' : '自动总结已关闭'); });
  $('#mp_auto_summarize_every').on('change', function() { const v = Math.max(5, Math.min(200, parseInt($(this).val()) || 20)); $(this).val(v); getSettings().autoSummarizeEvery = v; saveSettings(); });
}

// ====== Event Hooks ======
function hookRecall() {
  try {
    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async () => {
      try { await runRecall(); } catch (e) { console.error('[MP] Recall error:', e); }
      // Auto-summarize (unchanged logic from v3.5)
      try {
        const s = getSettings();
        if (s.autoSummarize) {
          const c = SillyTavern.getContext(); const chatLen = c?.chat?.length || 0; const interval = s.autoSummarizeEvery || 20;
          const store = c?.extensionSettings?.['MemoryPilot'];
          const charId = c?.characterId; const charObj = Number.isInteger(charId) ? c?.characters?.[charId] : null;
          const charScope = String(charObj?.avatar ?? charObj?.name ?? c?.chatMetadata?.character_name ?? c?.name2 ?? '');
          const ck = String(c.chatId ?? c.chatMetadata?.chat_file_name ?? 'default') + '::' + charScope;
          if (store && store[ck]) {
            const chatStore = store[ck];
            if (chatStore._lastAutoSummarizeFloor == null) { chatStore._lastAutoSummarizeFloor = chatLen; saveSettings(); }
            const lastAutoFloor = chatStore._lastAutoSummarizeFloor || 0;
            if (chatLen < lastAutoFloor) { chatStore._lastAutoSummarizeFloor = chatLen; saveSettings(); }
            if (!chatStore._autoSummarizeHistory) chatStore._autoSummarizeHistory = [];
            const effectiveLastFloor = Math.min(chatStore._lastAutoSummarizeFloor || 0, chatLen);
            if (!window._mpAutoSummarizeRunning && chatLen - effectiveLastFloor >= interval) {
              const fromIdx = effectiveLastFloor, toIdx = chatLen;
              chatStore._lastAutoSummarizeFloor = toIdx;
              chatStore._autoSummarizeHistory.push({ from: fromIdx + 1, to: toIdx, time: Date.now(), status: 'running' });
              if (chatStore._autoSummarizeHistory.length > 50) chatStore._autoSummarizeHistory = chatStore._autoSummarizeHistory.slice(-50);
              saveSettings(); window._mpAutoSummarizeRunning = true; window._mpAutoSummarizeAbort = new AbortController();
              toastr?.info?.('🔄 自动总结中（#' + (fromIdx+1) + '-' + toIdx + '）…', '', { timeOut: 0, extendedTimeOut: 0, tapToDismiss: true, toastClass: 'toast mp-auto-toast' });
              try {
                const apiCfg = store[ck]?.mp_api_config || {}; const provider = apiCfg.provider || 'openai'; const model = apiCfg.model || ''; const key = apiCfg.key || ''; const rawBase = apiCfg.url || '';
                if (!key || !model) { chatStore._lastAutoSummarizeFloor = fromIdx; chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].status = 'error_no_api'; saveSettings(); toastr?.warning?.('自动总结：API 未配置'); }
                else {
                  const promptTemplate = getCustomPrompt('analysis', null);
                  if (promptTemplate) {
                    const chat = c.chat || []; const uL = c.name1 || '用户', cL = c.name2 || '角色'; const text = [];
                    for (let i = fromIdx; i < toIdx; i++) { const m = chat[i]; if (!m || !m.mes) continue; const body = String(m.mes).replace(/<\s*think\b[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi, ' ').trim(); if (!body) continue; text.push('#' + (i+1) + '[' + (m.is_user ? uL : (m.name||cL)) + ']' + body); }
                    if (text.length >= 3) {
                      const prompt = promptTemplate.replace('{{content}}', text.join('\n'));
                      const base = provider === 'claude' ? String(rawBase||'https://api.anthropic.com').replace(/\/+$/,'').replace(/\/v1\/messages$/i,'') : provider === 'gemini' ? String(rawBase||'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/,'').replace(/\/models\/.*$/i,'') : String(rawBase||'').replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
                      let url, headers, reqBody;
                      if (provider === 'claude') { url = base + '/v1/messages'; headers = { 'x-api-key': key, 'anthropic-version': apiCfg.anthropicVersion || '2023-06-01', 'content-type': 'application/json' }; reqBody = JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }); }
                      else if (provider === 'gemini') { url = base + '/models/' + encodeURIComponent(model) + ':generateContent'; headers = { 'x-goog-api-key': key, 'content-type': 'application/json' }; reqBody = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 4096 } }); }
                      else { url = base + '/chat/completions'; headers = { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' }; reqBody = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 }); }
                      const res = await fetch(url, { method: 'POST', headers, body: reqBody, signal: window._mpAutoSummarizeAbort?.signal });
                      if (res.ok) {
                        const d = await res.json(); let resultText = '';
                        if (provider === 'claude') resultText = (d.content||[]).filter(x=>x?.type==='text').map(x=>x.text||'').join('\n');
                        else if (provider === 'gemini') resultText = (d.candidates||[]).flatMap(cc=>cc?.content?.parts||[]).map(p=>p?.text||'').join('\n');
                        else resultText = d.choices?.[0]?.message?.content || '';
                        const parsed = []; const parsedAll = []; let depth=0, start=-1;
                        for (let i=0;i<resultText.length;i++){if(resultText[i]==='{'){if(depth===0)start=i;depth++;}else if(resultText[i]==='}'){depth--;if(depth===0&&start>=0){try{const o=JSON.parse(resultText.slice(start,i+1));parsedAll.push(o);if(o?.event&&o?.summary)parsed.push(o);}catch{}start=-1;}}}
                        // v4.0: extract anchors, timeline, and todos from same response
                        const autoAnchors = parsedAll.filter(o => o?.type === 'anchor' && o?.layer && o?.label && o?.content);
                        const autoTimeline = parsedAll.filter(o => o?.type === 'timeline' && o?.summary);
                        const autoTodos = parsedAll.filter(o => o?.type === 'todo' && o?.content);
                        try {
                          if (autoAnchors.length || autoTimeline.length || autoTodos.length) {
                            const { addLayeredEntry, addTimelineEntry, addTodo, injectLayered } = await import('./src/layered-memory.js');
                            for (const a of autoAnchors) addLayeredEntry(a.layer, { label: a.label, content: a.content, tags: a.tags || [], dateLabel: a.dateLabel || '', role: a.role || '', aliases: a.aliases || [] });
                            for (const t of autoTimeline) addTimelineEntry({ dateLabel: t.dateLabel || '', summary: t.summary, importance: t.importance || 'normal' });
                            for (const td of autoTodos) addTodo({ content: td.content, dateLabel: td.dateLabel || '', source: 'auto' });
                            try { injectLayered(); } catch {}
                            console.log('[MP] Auto: ' + autoAnchors.length + ' anchors + ' + autoTimeline.length + ' timeline + ' + autoTodos.length + ' todos');
                          }
                        } catch (layeredErr) { console.warn('[MP] Auto anchor write err:', layeredErr); }
                        if (parsed.length || autoAnchors.length || autoTimeline.length || autoTodos.length) {
                          const mkid = () => 'mp_' + Math.random().toString(36).slice(2, 10);
                          const nms = parsed.map(o => ({ ...o, id: mkid(), timestamp: Date.now(), primaryKeywords: Array.isArray(o.primaryKeywords)?o.primaryKeywords:(Array.isArray(o.keywords)?o.keywords:[]), secondaryKeywords: Array.isArray(o.secondaryKeywords)?o.secondaryKeywords:[], entityKeywords: Array.isArray(o.entityKeywords)?o.entityKeywords:[], source: 'auto', floorRange: Array.isArray(o.floorRange)&&o.floorRange.length>=2?o.floorRange:[fromIdx+1,toIdx], timeLabel: o.timeLabel || '第'+(fromIdx+1)+'-'+toIdx+'层' }));
                          let existing = []; try { const raw = localStorage.getItem('mp_pending_ops_results_auto'); if (raw) existing = JSON.parse(raw); } catch {} if (!Array.isArray(existing)) existing = [];
                          const all = [...existing, ...nms];
                          try { localStorage.setItem('mp_pending_ops', JSON.stringify({ auto: { status: 'done', message: all.length + '条自动提取（累计）', resultCount: all.length, updatedAt: Date.now() } })); } catch {}
                          try { localStorage.setItem('mp_pending_ops_results_auto', JSON.stringify(all)); } catch {}
                          chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].status = 'done';
                          chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].count = nms.length;
                          saveSettings(); toastr?.info?.('自动总结完成（#'+(fromIdx+1)+'-'+toIdx+'）：'+nms.length+'记忆' + (autoAnchors.length ? ' +'+autoAnchors.length+'锚点' : '') + (autoTimeline.length ? ' +'+autoTimeline.length+'时间线' : '') + (autoTodos.length ? ' +'+autoTodos.length+'待办' : ''));
                        } else { chatStore._lastAutoSummarizeFloor=fromIdx; chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].status='empty'; saveSettings(); }
                      } else { chatStore._lastAutoSummarizeFloor=fromIdx; chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].status='error_'+res.status; saveSettings(); toastr?.error?.('自动总结API错误：'+res.status); }
                    }
                  }
                }
              } catch (autoErr) {
                chatStore._lastAutoSummarizeFloor = fromIdx;
                if (autoErr?.name==='AbortError') { chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].status='aborted'; saveSettings(); toastr?.warning?.('自动总结已中止'); }
                else { console.warn('[MP] Auto-summarize error:', autoErr); try{chatStore._autoSummarizeHistory[chatStore._autoSummarizeHistory.length-1].status='error';saveSettings();}catch{} toastr?.error?.('自动总结失败：'+(autoErr?.message||autoErr)); }
              } finally { window._mpAutoSummarizeRunning=false; window._mpAutoSummarizeAbort=null; try{document.querySelectorAll('.mp-auto-toast').forEach(el=>el.remove());}catch{} }
            }
          }
        }
      } catch (e) { console.warn('[MP] Auto-summarize check error:', e); }
    });
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, async () => {
      try { onChatChanged(); } catch {}
      try { injectLayered(); } catch {}
      try {
        const prev = localStorage.getItem('mp_active_chat');
        const charId = ctx?.characterId; const charObj = Number.isInteger(charId) ? ctx?.characters?.[charId] : null;
        const curr = `${String(ctx.chatId??ctx.chatMetadata?.chat_file_name??'')}::${String(charObj?.avatar??charObj?.name??ctx?.chatMetadata?.character_name??ctx?.name2??'')}`;
        if (prev && prev !== curr) try { localStorage.removeItem('mp_memories_' + prev); } catch {}
        localStorage.setItem('mp_active_chat', curr);
      } catch {}
      try { await migrateIfNeeded(); const report = detectLegacyArtifacts(); if (report.hasLegacyMpMetadata||report.hasLegacyMpVars||report.lwbSnapHasMpTraces) toastr?.info?.('检测到旧版 MP 痕迹，可在 MP 面板 → 过滤 中清理。'); } catch (e) { console.warn('[MP] detect legacy err', e); }
    });
  } catch (e) { console.warn('[MP] Could not hook events:', e); }
}

// ====== Init ======
const MP_ACTIVATION_KEY = 'mp_activation_verified';
const MP_VALID_HASHES = new Set([
  '8daf8d6aed1de8bd58aa35f4fe6c7b50a04a4a5458044d27e554c5ce4c5e1a9f',
  '8480d467d4dd07d3e1f03c1192c30c63ab261b027a929aee44f0ebd05c401e8a',
  'b43dcdec36652e9d347bb66b2ac8d406b98b95fd9c78d5c41557535023e8ce23',
]);
async function sha256Hex(text) { const d=new TextEncoder().encode(text); const b=await crypto.subtle.digest('SHA-256',d); return Array.from(new Uint8Array(b)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function isActivated() { try { return localStorage.getItem(MP_ACTIVATION_KEY)==='true'; } catch { return false; } }

jQuery(async () => {
  console.log(`[${MODULE_NAME}] Extension loaded v4.0.0 (recall: ${getSettings().recallVersion})`);
  const ctx = SillyTavern.getContext();
  if (!ctx.extensionSettings[MODULE_NAME]) ctx.extensionSettings[MODULE_NAME] = {};
  $('#extensions_settings2').append(buildSettingsHtml());
  bindSettingsEvents();
  if (!isActivated()) { renderActivationUI(); return; }
  initFeatures();
});

function renderActivationUI() {
  const container = document.querySelector('.mp-settings-panel .inline-drawer-content'); if (!container) return;
  const div = document.createElement('div'); div.id = 'mp_activation_inline';
  div.style.cssText = 'padding:10px 0;border-top:1px solid rgba(255,255,255,0.08);margin-top:8px';
  div.innerHTML = `<div style="color:#fbbf24;font-size:12px;font-weight:600;margin-bottom:6px">🔒 需要激活码</div><div style="font-size:11px;color:#888;margin-bottom:8px">输入激活码后解锁全部功能。</div><div style="display:flex;gap:6px"><input id="mp_act_code_inline" type="text" class="text_pole" placeholder="输入激活码…" style="flex:1"><button id="mp_act_submit_inline" class="menu_button" style="white-space:nowrap">激活</button></div><div id="mp_act_err_inline" style="color:#f87171;font-size:11px;margin-top:4px;display:none"></div>`;
  container.appendChild(div);
  const input=document.getElementById('mp_act_code_inline'), submit=document.getElementById('mp_act_submit_inline'), errEl=document.getElementById('mp_act_err_inline');
  const doActivate = async () => { const code=(input?.value||'').trim().toUpperCase(); if(!code){errEl.style.display='';errEl.textContent='请输入激活码';return;} const hash=await sha256Hex(code); if(MP_VALID_HASHES.has(hash)){try{localStorage.setItem(MP_ACTIVATION_KEY,'true');}catch{} div.innerHTML='<div style="color:#4ade80;font-size:12px;padding:8px 0">✅ 激活成功！</div>'; toastr?.success?.('MemoryPilot 已激活'); setTimeout(()=>{initFeatures();div.remove();},500); } else {errEl.style.display='';errEl.textContent='激活码无效';} };
  submit?.addEventListener('click', doActivate);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doActivate(); });
}

function initFeatures() {
  const ctx = SillyTavern.getContext();
  try { migrateIfNeeded().then(() => { const r = detectLegacyArtifacts(); if (r.hasLegacyMpMetadata||r.hasLegacyMpVars||r.lwbSnapHasMpTraces) toastr?.info?.('检测到旧版 MP 痕迹，可在 MP 面板 → 过滤 中清理。'); }); } catch (e) { console.warn('[MP] startup migration err', e); }
  try { injectLayered(); } catch (e) { console.warn('[MP] initial layered inject err', e); }
  addChatBarButtons();
  ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => { setTimeout(() => addChatBarButtons(), 500); });
  hookRecall();
}
