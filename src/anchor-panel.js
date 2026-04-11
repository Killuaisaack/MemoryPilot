/**
 * MemoryPilot v3.6.0 — Anchor Panel (分层记忆面板)
 * 
 * Standalone panel for managing layered (permanent) memories.
 * Completely decoupled from the existing panel.js analysis tab.
 * 
 * Features:
 *   - View/Add/Edit/Delete layered memories across 3 layers
 *   - AI extraction from chat floors
 *   - AI extraction from existing mp_memories list
 *   - Manual entry
 *   - Per-entry pin/unpin
 *   - Import/Export
 */

import {
  LAYER_DEFS, LAYER_KEYS, loadLayered, saveLayered,
  addLayeredEntry, updateLayeredEntry, deleteLayeredEntry,
  getLayeredStats, buildLayeredInjection,
  EXTRACT_LAYERED_PROMPT, EXTRACT_FROM_MEMORIES_PROMPT
} from './layered-memory.js';

const PANEL_ID = 'mp_anchor_panel';
const STYLE_ID = 'mp_anchor_style';

export async function openAnchorPanel() {
(async () => {
  const ctx = window.SillyTavern?.getContext?.();
  if (!ctx) return;
  const chat = ctx.chat || [];

  const $ = id => document.getElementById(id);
  const h = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const gid = () => 'la_' + Math.random().toString(36).slice(2, 10);

  // Toggle
  if ($(PANEL_ID)) { $(PANEL_ID).remove(); $(STYLE_ID)?.remove(); return; }
  // Close other MP panels
  try { document.getElementById('mp_main_panel')?.remove(); } catch {}
  try { document.getElementById('mp_api_panel')?.remove(); } catch {}
  try { document.getElementById('mp_recall_monitor_panel')?.remove(); } catch {}

  // ====== Storage helpers (shared pattern) ======
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
    }, 8000);
  };
  const AK = 'mp_api_config';
  const loadApi = () => {
    try { const r = localStorage.getItem(AK); if (r) return JSON.parse(r); } catch {}
    try { const s = _getStore(); if (s?.[AK]) return s[AK]; } catch {}
    return {};
  };

  const normalizeOpenAIBase = s => String(s ?? '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  const normalizeClaudeBase = s => String(s ?? '').trim().replace(/\/+$/, '').replace(/\/v1\/messages$/i, '');
  const normalizeGeminiBase = s => String(s ?? '').trim().replace(/\/+$/, '').replace(/\/models\/.*$/i, '');

  const FETCH_TIMEOUT = 120000;
  const MAX_RETRIES = 2;

  const callLLMOnce = async (prompt, signal) => {
    const api = loadApi();
    const provider = api.provider || 'openai';
    const model = api.model || '';
    const key = api.key || '';
    const rawBase = api.url || '';
    if (!key || !model) throw new Error('请先在 MP API配置 中设置 Provider / Key / Model');
    const base = provider === 'claude' ? normalizeClaudeBase(rawBase) : provider === 'gemini' ? normalizeGeminiBase(rawBase) : normalizeOpenAIBase(rawBase);

    if (provider === 'claude') {
      const url = (base || 'https://api.anthropic.com') + '/v1/messages';
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'x-api-key': key, 'anthropic-version': api.anthropicVersion || '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: Number(api.maxTokens) || 4096, messages: [{ role: 'user', content: prompt }] })
      });
      if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('Claude ' + res.status + ': ' + e.slice(0, 500)); }
      const d = await res.json();
      return (d.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
    }
    if (provider === 'gemini') {
      const url = (base || 'https://generativelanguage.googleapis.com/v1beta') + '/models/' + encodeURIComponent(model) + ':generateContent';
      const res = await fetch(url, {
        method: 'POST', signal,
        headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: Number(api.maxTokens) || 4096 } })
      });
      if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('Gemini ' + res.status + ': ' + e.slice(0, 500)); }
      const d = await res.json();
      return (d.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('\n');
    }
    // OpenAI
    const url = (base || '').replace(/\/+$/, '') + '/chat/completions';
    const res = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: Number(api.maxTokens) || 4096 })
    });
    if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('OpenAI ' + res.status + ': ' + e.slice(0, 500)); }
    const d = await res.json();
    return d.choices?.[0]?.message?.content || '';
  };

  const callLLM = async (prompt, signal) => {
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
        const merged = signal ? (() => { signal.addEventListener('abort', () => ctrl.abort()); return ctrl.signal; })() : ctrl.signal;
        try { return await callLLMOnce(prompt, merged); } finally { clearTimeout(timer); }
      } catch (err) {
        lastErr = err;
        if (err?.name === 'AbortError' && signal?.aborted) throw err;
        const st = err?.status;
        if (st && st >= 400 && st < 500 && st !== 429) throw err;
        if (attempt < MAX_RETRIES - 1) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    throw lastErr || new Error('API 调用失败');
  };

  const extractAllJsonObjects = (text) => {
    const results = [];
    let depth = 0, start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') { if (depth === 0) start = i; depth++; }
      else if (text[i] === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try { const o = JSON.parse(text.slice(start, i + 1)); if (o && typeof o === 'object') results.push(o); } catch {}
          start = -1;
        }
      }
    }
    return results;
  };

  // Text cleaner (simplified version)
  const applyCleaner = (text) => {
    return String(text || '')
      .replace(/<\s*think\b[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi, ' ')
      .replace(/<\s*details\b[^>]*>[\s\S]*?<\s*\/\s*details\s*>/gi, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
  };

  // ====== State ======
  let activeLayer = 'identity';
  let editingId = null;
  let _abort = null;

  // ====== Render ======

  const renderStats = () => {
    const stats = getLayeredStats();
    for (const k of LAYER_KEYS) {
      const el = $('mpa_count_' + k);
      if (el) el.textContent = stats[k];
    }
    const totalEl = $('mpa_total');
    if (totalEl) totalEl.textContent = stats.total;
  };

  const renderList = () => {
    const data = loadLayered();
    const list = data[activeLayer] || [];
    const container = $('mpa_list');
    if (!container) return;

    if (!list.length) {
      container.innerHTML = '<div class="mpa-empty">暂无' + LAYER_DEFS[activeLayer].label + '<br><span style="font-size:11px;color:#777">点击上方「手动添加」或使用 AI 提取</span></div>';
      return;
    }

    container.innerHTML = list.map((item, idx) => `
      <div class="mpa-item ${item.pinned === false ? 'mpa-unpinned' : ''}" data-id="${h(item.id)}">
        <div class="mpa-item-hd">
          <span class="mpa-item-icon">${LAYER_DEFS[activeLayer].icon}</span>
          <span class="mpa-item-label">${h(item.label)}</span>
          ${item.dateLabel ? '<span class="mpa-item-date">' + h(item.dateLabel) + '</span>' : ''}
          <span class="mpa-item-pin ${item.pinned === false ? 'off' : ''}" data-action="pin" data-id="${h(item.id)}" title="${item.pinned === false ? '未注入（点击启用）' : '已注入（点击禁用）'}">${item.pinned === false ? '📌' : '📌'}</span>
        </div>
        <div class="mpa-item-content">${h(item.content).replace(/\n/g, '<br>')}</div>
        ${item.tags?.length ? '<div class="mpa-item-tags">' + item.tags.map(t => '<span class="mpa-tag">' + h(t) + '</span>').join('') + '</div>' : ''}
        <div class="mpa-item-actions">
          <button class="mpa-btn mpa-btn-sm" data-action="edit" data-id="${h(item.id)}">编辑</button>
          <button class="mpa-btn mpa-btn-sm mpa-btn-danger" data-action="delete" data-id="${h(item.id)}">删除</button>
          ${idx > 0 ? '<button class="mpa-btn mpa-btn-sm" data-action="up" data-id="' + h(item.id) + '">↑</button>' : ''}
          ${idx < list.length - 1 ? '<button class="mpa-btn mpa-btn-sm" data-action="down" data-id="' + h(item.id) + '">↓</button>' : ''}
        </div>
      </div>
    `).join('');

    // Bind actions
    container.querySelectorAll('[data-action]').forEach(el => {
      el.onclick = () => {
        const action = el.getAttribute('data-action');
        const id = el.getAttribute('data-id');
        if (action === 'edit') startEdit(id);
        else if (action === 'delete') doDelete(id);
        else if (action === 'pin') doTogglePin(id);
        else if (action === 'up') doMove(id, -1);
        else if (action === 'down') doMove(id, 1);
      };
    });
  };

  const startEdit = (id) => {
    const data = loadLayered();
    const item = (data[activeLayer] || []).find(x => x.id === id);
    if (!item) return;
    editingId = id;
    $('mpa_ed_label').value = item.label || '';
    $('mpa_ed_content').value = item.content || '';
    $('mpa_ed_tags').value = (item.tags || []).join(', ');
    $('mpa_ed_date').value = item.dateLabel || '';
    $('mpa_ed_layer').value = item.layer || activeLayer;
    $('mpa_editor').style.display = '';
    $('mpa_ed_title').textContent = '编辑锚点';
    $('mpa_ed_save').textContent = '保存修改';
  };

  const startAdd = () => {
    editingId = null;
    $('mpa_ed_label').value = '';
    $('mpa_ed_content').value = '';
    $('mpa_ed_tags').value = '';
    $('mpa_ed_date').value = '';
    $('mpa_ed_layer').value = activeLayer;
    $('mpa_editor').style.display = '';
    $('mpa_ed_title').textContent = '添加锚点';
    $('mpa_ed_save').textContent = '添加';
  };

  const doSave = () => {
    const layer = $('mpa_ed_layer').value || activeLayer;
    const label = ($('mpa_ed_label').value || '').trim();
    const content = ($('mpa_ed_content').value || '').trim();
    const tags = ($('mpa_ed_tags').value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
    const dateLabel = ($('mpa_ed_date').value || '').trim();

    if (!label) { toastr?.warning?.('请输入标签名'); return; }
    if (!content) { toastr?.warning?.('请输入内容'); return; }

    if (editingId) {
      // If layer changed, delete from old and add to new
      const data = loadLayered();
      const oldItem = (data[activeLayer] || []).find(x => x.id === editingId);
      if (oldItem && layer !== activeLayer) {
        deleteLayeredEntry(activeLayer, editingId);
        addLayeredEntry(layer, { label, content, tags, dateLabel });
        activeLayer = layer;
      } else {
        updateLayeredEntry(activeLayer, editingId, { label, content, tags, dateLabel });
      }
      toastr?.success?.('已保存');
    } else {
      addLayeredEntry(layer, { label, content, tags, dateLabel });
      if (layer !== activeLayer) activeLayer = layer;
      toastr?.success?.('已添加');
    }

    editingId = null;
    $('mpa_editor').style.display = 'none';
    renderList();
    renderStats();
    switchTab(activeLayer);
  };

  const doDelete = (id) => {
    if (!confirm('确定删除此锚点？')) return;
    deleteLayeredEntry(activeLayer, id);
    renderList();
    renderStats();
    toastr?.success?.('已删除');
  };

  const doTogglePin = (id) => {
    const data = loadLayered();
    const item = (data[activeLayer] || []).find(x => x.id === id);
    if (!item) return;
    updateLayeredEntry(activeLayer, id, { pinned: item.pinned === false ? true : false });
    renderList();
    toastr?.info?.(item.pinned === false ? '已启用注入' : '已禁用注入');
  };

  const doMove = (id, direction) => {
    const data = loadLayered();
    const list = data[activeLayer] || [];
    const idx = list.findIndex(x => x.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
    saveLayered(data);
    renderList();
  };

  const switchTab = (layer) => {
    activeLayer = layer;
    const root = $(PANEL_ID);
    root.querySelectorAll('.mpa-layer-tab').forEach(t => {
      t.classList.toggle('on', t.getAttribute('data-layer') === layer);
    });
    renderList();
  };

  // ====== AI Extraction ======

  const doExtractFromChat = async () => {
    const input = $('mpa_ai_floors').value.trim();
    if (!input) { toastr?.warning?.('请输入楼层范围'); return; }

    const indices = parseFloors(input, chat.length);
    if (!indices.length) { toastr?.warning?.('未选中有效楼层'); return; }

    const btn = $('mpa_ai_extract');
    btn.disabled = true;
    btn.textContent = '提取中…';
    $('mpa_ai_result').innerHTML = '<div style="color:#fbbf24;font-size:12px">🔄 AI 提取中，请稍候…</div>';

    _abort = new AbortController();
    const uL = ctx.name1 || '用户', cL = ctx.name2 || '角色';
    const text = indices.map(i => {
      const m = chat[i]; if (!m) return '';
      const body = applyCleaner(m.mes || '');
      if (!body.trim()) return '';
      return '#' + (i + 1) + '[' + (m.is_user ? uL : (m.name || cL)) + ']' + body;
    }).filter(Boolean).join('\n');

    const promptTemplate = window.MemoryPilot?.getCustomPrompt?.('layeredExtract') || EXTRACT_LAYERED_PROMPT;
    const prompt = promptTemplate.replace('{{content}}', text);

    try {
      const result = await callLLM(prompt, _abort.signal);
      const parsed = extractAllJsonObjects(result);
      const valid = parsed.filter(o => o.layer && LAYER_DEFS[o.layer] && o.label && o.content);
      if (!valid.length) {
        $('mpa_ai_result').innerHTML = '<div style="color:#f87171;font-size:12px">未提取到有效锚点</div>';
        return;
      }
      renderExtractResults(valid);
    } catch (e) {
      if (e?.name === 'AbortError') {
        $('mpa_ai_result').innerHTML = '<div style="color:#888;font-size:12px">已中止</div>';
      } else {
        $('mpa_ai_result').innerHTML = '<div style="color:#f87171;font-size:12px">失败: ' + h(e?.message || String(e)) + '</div>';
      }
    } finally {
      _abort = null;
      btn.disabled = false;
      btn.textContent = 'AI 从对话提取';
    }
  };

  const doExtractFromMemories = async () => {
    const store = _getStore();
    const memories = store?.mp_memories || store?.memories || [];
    if (!memories.length) { toastr?.warning?.('当前聊天没有记忆列表数据'); return; }

    const btn = $('mpa_ai_extract_mem');
    btn.disabled = true;
    btn.textContent = '提取中…';
    $('mpa_ai_result').innerHTML = '<div style="color:#fbbf24;font-size:12px">🔄 从 ' + memories.length + ' 条记忆中提取锚点…</div>';

    _abort = new AbortController();

    const memText = memories.map((m, i) => {
      return '记忆' + (i + 1) + '：\n事件名：' + (m.event || '') + '\n摘要：' + (m.summary || '') + '\n时间：' + (m.timeLabel || '') + '\n楼层：' + (Array.isArray(m.floorRange) ? '#' + m.floorRange[0] + '-' + m.floorRange[1] : '未知') + '\n人物：' + (m.entityKeywords || []).join(', ');
    }).join('\n\n');

    const promptTemplate = window.MemoryPilot?.getCustomPrompt?.('layeredExtractFromMem') || EXTRACT_FROM_MEMORIES_PROMPT;
    const prompt = promptTemplate.replace('{{content}}', memText);

    try {
      const result = await callLLM(prompt, _abort.signal);
      const parsed = extractAllJsonObjects(result);
      const valid = parsed.filter(o => o.layer && LAYER_DEFS[o.layer] && o.label && o.content);
      if (!valid.length) {
        $('mpa_ai_result').innerHTML = '<div style="color:#f87171;font-size:12px">未提取到有效锚点</div>';
        return;
      }
      renderExtractResults(valid);
    } catch (e) {
      if (e?.name === 'AbortError') {
        $('mpa_ai_result').innerHTML = '<div style="color:#888;font-size:12px">已中止</div>';
      } else {
        $('mpa_ai_result').innerHTML = '<div style="color:#f87171;font-size:12px">失败: ' + h(e?.message || String(e)) + '</div>';
      }
    } finally {
      _abort = null;
      btn.disabled = false;
      btn.textContent = 'AI 从记忆列表提取';
    }
  };

  const renderExtractResults = (items) => {
    const container = $('mpa_ai_result');
    container.innerHTML = '<div style="color:#4ade80;font-size:12px;margin-bottom:8px">✅ 提取到 ' + items.length + ' 条锚点，点击添加：</div>' +
      items.map((item, i) => {
        const def = LAYER_DEFS[item.layer];
        return `<div class="mpa-extract-item" data-idx="${i}">
          <div class="mpa-extract-hd">
            <span style="color:${def.color}">${def.icon} ${def.label}</span>
            <span class="mpa-item-label">${h(item.label)}</span>
            ${item.dateLabel ? '<span class="mpa-item-date">' + h(item.dateLabel) + '</span>' : ''}
          </div>
          <div class="mpa-extract-body">${h(item.content).replace(/\n/g, '<br>')}</div>
          ${item.tags?.length ? '<div class="mpa-item-tags" style="margin-top:4px">' + item.tags.map(t => '<span class="mpa-tag">' + h(t) + '</span>').join('') + '</div>' : ''}
          <div style="display:flex;gap:4px;margin-top:6px">
            <button class="mpa-btn mpa-btn-primary mpa-btn-sm" data-addidx="${i}">添加</button>
            <button class="mpa-btn mpa-btn-sm" data-editidx="${i}">编辑后添加</button>
          </div>
        </div>`;
      }).join('') +
      '<div style="margin-top:8px"><button class="mpa-btn mpa-btn-primary" id="mpa_add_all">全部添加（' + items.length + ' 条）</button></div>';

    // Store items for reference
    window._mpaExtractItems = items;

    container.querySelectorAll('[data-addidx]').forEach(el => {
      el.onclick = () => {
        const idx = Number(el.getAttribute('data-addidx'));
        const item = items[idx]; if (!item) return;
        addLayeredEntry(item.layer, {
          label: item.label, content: item.content,
          tags: item.tags || [], dateLabel: item.dateLabel || '',
        });
        el.textContent = '✅ 已添加';
        el.disabled = true;
        renderStats();
        // If current tab matches, refresh
        if (item.layer === activeLayer) renderList();
      };
    });

    container.querySelectorAll('[data-editidx]').forEach(el => {
      el.onclick = () => {
        const idx = Number(el.getAttribute('data-editidx'));
        const item = items[idx]; if (!item) return;
        activeLayer = item.layer;
        switchTab(item.layer);
        editingId = null;
        $('mpa_ed_label').value = item.label || '';
        $('mpa_ed_content').value = item.content || '';
        $('mpa_ed_tags').value = (item.tags || []).join(', ');
        $('mpa_ed_date').value = item.dateLabel || '';
        $('mpa_ed_layer').value = item.layer;
        $('mpa_editor').style.display = '';
        $('mpa_ed_title').textContent = '添加锚点';
        $('mpa_ed_save').textContent = '添加';
      };
    });

    $('mpa_add_all')?.addEventListener('click', () => {
      let count = 0;
      for (const item of items) {
        addLayeredEntry(item.layer, {
          label: item.label, content: item.content,
          tags: item.tags || [], dateLabel: item.dateLabel || '',
        });
        count++;
      }
      toastr?.success?.('已添加 ' + count + ' 条锚点');
      renderList();
      renderStats();
      container.innerHTML = '<div style="color:#4ade80;font-size:12px">✅ 全部 ' + count + ' 条已添加</div>';
    });
  };

  const parseFloors = (input, len) => {
    const r = new Set();
    for (const p of input.split(/[,，]/)) {
      const t = p.trim(); if (!t) continue;
      const rm = t.match(/^(\d+)\s*[-~～到]\s*(\d+)$/);
      if (rm) { for (let i = Math.max(0, +rm[1] - 1); i <= Math.min(+rm[2] - 1, len - 1); i++) r.add(i); }
      else if (/^最近(\d+)$/.test(t)) { const n = +t.match(/最近(\d+)/)[1]; for (let i = Math.max(0, len - n); i < len; i++) r.add(i); }
      else if (/^\d+$/.test(t)) { const i = +t - 1; if (i >= 0 && i < len) r.add(i); }
    }
    return [...r].sort((a, b) => a - b);
  };

  // ====== Import / Export ======

  const doExport = () => {
    const data = loadLayered();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mp_layered_memory_' + Date.now() + '.json';
    a.click(); URL.revokeObjectURL(url);
    toastr?.success?.('已导出');
  };

  const doImport = () => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // Validate
        let count = 0;
        for (const k of LAYER_KEYS) {
          if (Array.isArray(data[k])) count += data[k].length;
        }
        if (!count) { toastr?.warning?.('文件中未找到有效的分层记忆'); return; }
        if (!confirm('将导入 ' + count + ' 条分层记忆，是否与现有数据合并？\n\n「确定」= 合并，取消后可选择覆盖')) {
          if (confirm('是否覆盖（清空现有分层记忆后导入）？')) {
            saveLayered(data);
          } else return;
        } else {
          // Merge
          const existing = loadLayered();
          for (const k of LAYER_KEYS) {
            if (Array.isArray(data[k])) {
              existing[k] = [...(existing[k] || []), ...data[k]];
            }
          }
          saveLayered(existing);
        }
        renderList(); renderStats();
        toastr?.success?.('已导入 ' + count + ' 条');
      } catch (e) {
        toastr?.error?.('导入失败: ' + (e?.message || e));
      }
    };
    input.click();
  };

  // ====== Style ======
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID}{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center}
    #${PANEL_ID} .mpa-mask{position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)}
    #${PANEL_ID} .mpa-card{position:relative;z-index:1;width:min(94vw,720px);max-height:90dvh;display:flex;flex-direction:column;background:#1a1b2e;border:1px solid rgba(255,255,255,0.1);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.5);overflow:hidden}
    #${PANEL_ID} .mpa-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0}
    #${PANEL_ID} .mpa-hd h3{margin:0;font-size:16px;color:#e2e8f0;font-weight:600}
    #${PANEL_ID} .mpa-hd .mpa-total{font-size:12px;color:#888;margin-left:8px}
    #${PANEL_ID} .mpa-cls{background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:0 4px;line-height:1}
    #${PANEL_ID} .mpa-cls:hover{color:#fff}

    #${PANEL_ID} .mpa-tabs{display:flex;gap:0;padding:0;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06)}
    #${PANEL_ID} .mpa-layer-tab{flex:1;padding:10px 8px;border:none;background:transparent;color:#888;cursor:pointer;font-size:12px;text-align:center;transition:all 0.15s;border-bottom:2px solid transparent}
    #${PANEL_ID} .mpa-layer-tab:hover{background:rgba(255,255,255,0.03);color:#ccc}
    #${PANEL_ID} .mpa-layer-tab.on{color:#e2e8f0;border-bottom-color:var(--tab-color,#7c6bf0);background:rgba(255,255,255,0.03)}
    #${PANEL_ID} .mpa-layer-tab .mpa-tab-count{font-size:10px;opacity:0.6;margin-left:2px}

    #${PANEL_ID} .mpa-bd{flex:1;overflow-y:auto;padding:12px 16px;overscroll-behavior:contain}

    #${PANEL_ID} .mpa-toolbar{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;align-items:center}

    .mpa-btn{padding:6px 12px;border-radius:7px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ccc;cursor:pointer;font-size:11px;transition:all 0.15s;white-space:nowrap}
    .mpa-btn:hover{background:rgba(255,255,255,0.08);color:#fff}
    .mpa-btn:disabled{opacity:0.4;cursor:not-allowed}
    .mpa-btn-primary{background:rgba(124,107,240,0.15);border-color:rgba(124,107,240,0.3);color:#a78bfa}
    .mpa-btn-primary:hover{background:rgba(124,107,240,0.25)}
    .mpa-btn-danger{color:#f87171}
    .mpa-btn-danger:hover{background:rgba(248,113,113,0.1)}
    .mpa-btn-sm{padding:4px 8px;font-size:10px}

    .mpa-item{padding:10px 12px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:8px;background:rgba(255,255,255,0.02);transition:border-color 0.15s}
    .mpa-item:hover{border-color:rgba(255,255,255,0.12)}
    .mpa-item.mpa-unpinned{opacity:0.5;border-style:dashed}
    .mpa-item-hd{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap}
    .mpa-item-icon{font-size:14px}
    .mpa-item-label{font-weight:600;color:#e2e8f0;font-size:13px}
    .mpa-item-date{font-size:10px;color:#fbbf24;background:rgba(251,191,36,0.1);padding:1px 6px;border-radius:4px}
    .mpa-item-pin{cursor:pointer;font-size:12px;margin-left:auto;opacity:0.7;transition:opacity 0.15s}
    .mpa-item-pin:hover{opacity:1}
    .mpa-item-pin.off{opacity:0.3;filter:grayscale(1)}
    .mpa-item-content{font-size:12px;color:#b0b8c8;line-height:1.6;margin-bottom:4px}
    .mpa-item-tags{display:flex;flex-wrap:wrap;gap:3px}
    .mpa-tag{font-size:10px;padding:1px 6px;border-radius:3px;background:rgba(124,107,240,0.1);color:#a78bfa;border:1px solid rgba(124,107,240,0.15)}
    .mpa-item-actions{display:flex;gap:4px;margin-top:6px}

    .mpa-empty{text-align:center;padding:40px 20px;color:#666;font-size:13px;line-height:1.8}

    #${PANEL_ID} .mpa-editor{display:none;padding:12px;border:1px solid rgba(124,107,240,0.2);border-radius:10px;background:rgba(124,107,240,0.04);margin-bottom:12px}
    #${PANEL_ID} .mpa-editor .mpa-fg{margin-bottom:8px}
    #${PANEL_ID} .mpa-editor label{font-size:11px;color:#aaa;display:block;margin-bottom:3px}
    #${PANEL_ID} .mpa-editor input,#${PANEL_ID} .mpa-editor textarea,#${PANEL_ID} .mpa-editor select{width:100%;padding:7px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:12px;resize:vertical}
    #${PANEL_ID} .mpa-editor textarea{min-height:80px}

    #${PANEL_ID} .mpa-ai-section{padding:12px;border:1px solid rgba(251,191,36,0.15);border-radius:10px;background:rgba(251,191,36,0.03);margin-bottom:12px}
    #${PANEL_ID} .mpa-ai-section summary{cursor:pointer;font-size:12px;color:#fbbf24;font-weight:500}

    .mpa-extract-item{padding:8px 10px;border:1px solid rgba(255,255,255,0.06);border-radius:6px;margin-bottom:6px;background:rgba(0,0,0,0.15)}
    .mpa-extract-hd{display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap;font-size:12px}
    .mpa-extract-body{font-size:11px;color:#b0b8c8;line-height:1.5}

    #${PANEL_ID} .mpa-preview{padding:10px 12px;border:1px solid rgba(52,211,153,0.2);border-radius:8px;background:rgba(52,211,153,0.04);margin-top:12px;max-height:200px;overflow-y:auto}
    #${PANEL_ID} .mpa-preview pre{font-size:11px;color:#b0b8c8;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.5}
    #${PANEL_ID} .mpa-preview-title{font-size:11px;color:#34d399;margin-bottom:6px;font-weight:500}

    @media(max-width:600px){
      #${PANEL_ID} .mpa-card{width:100%;max-height:100dvh;border-radius:0}
      #${PANEL_ID} .mpa-layer-tab{padding:8px 4px;font-size:11px}
    }
  `;
  document.head.appendChild(style);

  // ====== DOM ======
  const stats = getLayeredStats();
  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.innerHTML = `
    <div class="mpa-mask"></div>
    <div class="mpa-card">
      <div class="mpa-hd">
        <h3>⚓ 分层记忆锚点 <span class="mpa-total" id="mpa_total">${stats.total}</span></h3>
        <button class="mpa-cls" id="mpa_cls">&times;</button>
      </div>
      <div class="mpa-tabs">
        ${LAYER_KEYS.map(k => {
          const def = LAYER_DEFS[k];
          return `<button class="mpa-layer-tab ${k === activeLayer ? 'on' : ''}" data-layer="${k}" style="--tab-color:${def.color}">
            ${def.icon} ${def.label} <span class="mpa-tab-count" id="mpa_count_${k}">${stats[k]}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="mpa-bd">
        <div class="mpa-toolbar">
          <button class="mpa-btn mpa-btn-primary" id="mpa_add_btn">＋ 手动添加</button>
          <button class="mpa-btn" id="mpa_export">导出</button>
          <button class="mpa-btn" id="mpa_import">导入</button>
          <button class="mpa-btn" id="mpa_preview_btn">预览注入</button>
        </div>

        <div class="mpa-editor" id="mpa_editor">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-size:13px;color:#e2e8f0;font-weight:600" id="mpa_ed_title">添加锚点</span>
            <button class="mpa-btn mpa-btn-sm" id="mpa_ed_cancel">取消</button>
          </div>
          <div class="mpa-fg"><label>层级</label><select id="mpa_ed_layer">${LAYER_KEYS.map(k => '<option value="' + k + '">' + LAYER_DEFS[k].icon + ' ' + LAYER_DEFS[k].label + '</option>').join('')}</select></div>
          <div class="mpa-fg"><label>标签名（人物名/场景名/事件名）</label><input id="mpa_ed_label" placeholder="例如：阿尔忒弥斯、D-12舱室、初次争吵"></div>
          <div class="mpa-fg"><label>内容描述</label><textarea id="mpa_ed_content" placeholder="详细描述..."></textarea></div>
          <div class="mpa-fg"><label>时间标签（可空）</label><input id="mpa_ed_date" placeholder="故事内时间，如 UC0087/07/10、第三天晚上"></div>
          <div class="mpa-fg"><label>标签（逗号分隔）</label><input id="mpa_ed_tags" placeholder="关键词1, 关键词2"></div>
          <button class="mpa-btn mpa-btn-primary" id="mpa_ed_save" style="width:100%;padding:8px;margin-top:4px">添加</button>
        </div>

        <details class="mpa-ai-section">
          <summary>🤖 AI 提取锚点（共用 MP API 配置）</summary>
          <div style="margin-top:10px">
            <div class="mpa-fg" style="margin-bottom:8px">
              <label style="font-size:11px;color:#aaa;margin-bottom:3px">从对话楼层提取</label>
              <div style="display:flex;gap:6px">
                <input id="mpa_ai_floors" placeholder="最近50 或 1-100, 200-300" value="最近50" style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:12px">
                <button class="mpa-btn mpa-btn-primary" id="mpa_ai_extract">AI 从对话提取</button>
              </div>
            </div>
            <div style="margin-bottom:8px">
              <button class="mpa-btn" id="mpa_ai_extract_mem" style="width:100%">AI 从记忆列表提取（已有记忆 → 锚点）</button>
              <div style="font-size:10px;color:#777;margin-top:3px">适用于已有大量记忆列表的用户，无需重新总结对话</div>
            </div>
            ${_abort ? '<button class="mpa-btn mpa-btn-danger" id="mpa_ai_abort">中止</button>' : ''}
            <div id="mpa_ai_result"></div>
          </div>
        </details>

        <div id="mpa_list"></div>

        <div class="mpa-preview" id="mpa_preview" style="display:none">
          <div class="mpa-preview-title">📝 注入预览（将写入 {{getvar::mp_layered_ctx}}）</div>
          <pre id="mpa_preview_text"></pre>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // ====== Events ======

  $('mpa_cls').onclick = () => { $(PANEL_ID).remove(); $(STYLE_ID)?.remove(); };
  root.querySelector('.mpa-mask').onclick = () => { $(PANEL_ID).remove(); $(STYLE_ID)?.remove(); };

  // Layer tabs
  root.querySelectorAll('.mpa-layer-tab').forEach(t => {
    t.onclick = () => switchTab(t.getAttribute('data-layer'));
  });

  // Add
  $('mpa_add_btn').onclick = startAdd;
  $('mpa_ed_cancel').onclick = () => { $('mpa_editor').style.display = 'none'; editingId = null; };
  $('mpa_ed_save').onclick = doSave;

  // AI extract
  $('mpa_ai_extract').onclick = doExtractFromChat;
  $('mpa_ai_extract_mem').onclick = doExtractFromMemories;

  // Export / Import
  $('mpa_export').onclick = doExport;
  $('mpa_import').onclick = doImport;

  // Preview
  $('mpa_preview_btn').onclick = () => {
    const el = $('mpa_preview');
    if (el.style.display === 'none') {
      el.style.display = '';
      $('mpa_preview_text').textContent = buildLayeredInjection() || '（无已启用的锚点）';
    } else {
      el.style.display = 'none';
    }
  };

  // Initial render
  renderList();

})();
}
