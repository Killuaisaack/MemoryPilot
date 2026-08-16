// MemoryPilot - SillyTavern Extension
// Storage: extensionSettings (server-synced, outside chat jsonl)
// Prompt injection: chatMetadata.variables only (for {{getvar::}} macro)
// ZERO STscript /setvar calls — immune to LWB_SNAP snapshot bloat

import { runRecall as runRecallV34 } from './src/recall-v34.js';
import { runRecall as runRecallV32 } from './src/recall-v32.js';
import { openPanel } from './src/panel.js';
import { openApiConfig } from './src/api-config.js';
import { openMonitor } from './src/monitor.js';
import {
  migrateIfNeeded,
  detectLegacyArtifacts,
  cleanupLegacyArtifacts,
  onChatChanged,
  loadMemories,
  saveMemories,
  getStorageLogs,
  clearStorageLogs,
  getMemoryRecoverySnapshots,
  restoreMemoriesFromSnapshot,
  flushStorageNow,
  captureChatMessageSnapshot,
  handleChatMessageDeleted,
} from './src/storage.js';

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
      showChatBarButtons: false,
      panelTheme: 'dark',
    };
  }
  if (typeof s._global.showChatBarButtons !== 'boolean') s._global.showChatBarButtons = false;
  if (!['dark', 'light'].includes(s._global.panelTheme)) s._global.panelTheme = 'dark';
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
  loadMemories,
  saveMemories,
  getStorageLogs,
  clearStorageLogs,
  getMemoryRecoverySnapshots,
  restoreMemoriesFromSnapshot,
  flushStorageNow,
};

// ====== Wand Menu (Extensions Menu / 魔法棒) Buttons ======

function addWandMenuButtons() {
  if (document.getElementById('mp_wand_buttons')) return;

  // Find the wand menu popup container
  // SillyTavern uses #extensionsMenu as the wand popup, or the dropdown launched by the wand icon
  const wandSelectors = [
    '#extensionsMenu',             // Main extensions menu popup (wand popup content)
    '#extensionsMenuPopup',        // Alternative popup container name
    '.extensions_block',           // Extensions block in wand area
  ];

  let wandContainer = null;
  for (const sel of wandSelectors) {
    wandContainer = document.querySelector(sel);
    if (wandContainer) break;
  }

  // Keep a single compact entry in the native wand menu. The hub handles
  // memory, monitoring, API configuration and settings navigation.
  const items = [
    { id: 'mp_wand_memorypilot', icon: 'fa-solid fa-wand-magic-sparkles', label: 'MemoryPilot', handler: () => openPanel() },
  ];

  // Create a minimal marker so we don't double-insert
  const marker = document.createElement('span');
  marker.id = 'mp_wand_buttons';
  marker.style.display = 'none';

  const fragment = document.createDocumentFragment();
  fragment.appendChild(marker);

  for (const item of items) {
    const el = document.createElement('div');
    el.id = item.id;
    el.className = 'list-group-item flex-container flexGap5';
    el.title = item.label;
    el.innerHTML = `<i class="${item.icon}"></i> ${item.label}`;
    el.addEventListener('click', item.handler);
    fragment.appendChild(el);
  }

  function insertInto(container) {
    container.appendChild(fragment);
    console.log('[MP] Wand menu buttons added');
  }

  if (wandContainer) {
    insertInto(wandContainer);
  } else {
    // If wand container not found yet, observe DOM and retry
    console.log('[MP] Wand menu container not found, will retry via MutationObserver');
    const obs = new MutationObserver((mutations, observer) => {
      for (const sel of wandSelectors) {
        const el = document.querySelector(sel);
        if (el && !document.getElementById('mp_wand_buttons')) {
          insertInto(el);
          observer.disconnect();
          return;
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }
}

// ====== Optional chat/QR toolbar ======

function syncChatBarButtons() {
  const settings = getSettings();
  if (!settings.showChatBarButtons) {
    document.getElementById('mp_chat_buttons')?.remove();
    return;
  }
  if (document.getElementById('mp_chat_buttons')) return;

  const bar = document.createElement('div');
  bar.id = 'mp_chat_buttons';
  bar.className = 'mp-chat-bar';
  bar.innerHTML = `
    <button id="mp_btn_panel" class="mp-chat-btn" title="MP 管理面板">🧭 MP 管理面板</button>
    <button id="mp_btn_api" class="mp-chat-btn" title="MP API配置">🧭 MP API配置</button>
    <button id="mp_btn_monitor" class="mp-chat-btn" title="MP 召回监控">🧭 MP 召回监控</button>
  `;
  const targets = ['#qr--bar', '#form_sheld', '#send_form'];
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
    const sheld = document.getElementById('sheld');
    if (sheld) sheld.appendChild(bar);
  }
  document.getElementById('mp_btn_panel')?.addEventListener('click', () => openPanel());
  document.getElementById('mp_btn_api')?.addEventListener('click', () => openApiConfig());
  document.getElementById('mp_btn_monitor')?.addEventListener('click', () => openMonitor());
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
            <label style="display:flex;align-items:center;gap:6px;font-size:12px">
              <input type="checkbox" id="mp_show_chat_buttons" ${settings.showChatBarButtons ? 'checked' : ''}>
              显示输入区快捷按钮（QR 上方）
            </label>
            <div style="display:flex;align-items:center;gap:8px">
              <label style="min-width:80px">面板主题</label>
              <select id="mp_panel_theme" class="text_pole" style="flex:1">
                <option value="light" ${settings.panelTheme === 'light' ? 'selected' : ''}>白天</option>
                <option value="dark" ${settings.panelTheme === 'dark' ? 'selected' : ''}>黑夜</option>
              </select>
            </div>
            <div class="mp-info" style="font-size:11px;opacity:0.6;line-height:1.5">
              存储: extensionSettings · 零 /setvar · 不被 LWB 快照
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button id="mp_show_logs" class="menu_button" style="flex:1">查看日志</button>
              <button id="mp_copy_logs" class="menu_button" style="flex:1">复制日志</button>
              <button id="mp_clear_logs" class="menu_button" style="flex:1">清空日志</button>
            </div>
            <textarea id="mp_storage_log_box" class="text_pole" readonly style="display:none;width:100%;min-height:150px;font-size:11px;white-space:pre;font-family:monospace"></textarea>
            <div id="mp_storage_log_status" class="mp-info" style="font-size:11px;opacity:0.65"></div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button id="mp_update_btn" class="menu_button" style="flex:1">更新到最新版</button>
              <button id="mp_reload_btn" class="menu_button" style="flex:1">重载应用更新</button>
            </div>
            <div id="mp_update_status" class="mp-info" style="font-size:11px;opacity:0.75;line-height:1.5"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function formatStorageLogEntry(entry) {
  const time = entry?.ts ? new Date(entry.ts).toLocaleString() : 'unknown-time';
  const action = entry?.action || 'op';
  const key = entry?.key || '';
  const detail = entry?.detail ? ` ${entry.detail}` : '';
  const chat = entry?.chat ? ` [${entry.chat}]` : '';
  return `${time} ${action}:${key}${detail}${chat}`;
}

function renderStorageLogBox() {
  const logs = getStorageLogs(150);
  const text = logs.length
    ? logs.map(formatStorageLogEntry).join('\n')
    : '暂无 MemoryPilot 存储日志。';
  $('#mp_storage_log_box').val(text).show();
  $('#mp_storage_log_status').text(`已显示 ${logs.length} 条日志`);
  return text;
}

async function copyStorageLogs() {
  const text = renderStorageLogBox();
  try {
    await navigator.clipboard.writeText(text);
    toastr?.success?.('MemoryPilot 日志已复制');
  } catch {
    $('#mp_storage_log_box').trigger('select');
    document.execCommand?.('copy');
    toastr?.success?.('MemoryPilot 日志已复制');
  }
}

function getInstalledExtensionName() {
  try {
    const path = decodeURIComponent(new URL(import.meta.url).pathname);
    const match = path.match(/\/scripts\/extensions\/(?:third-party\/)?([^/]+)\//i);
    if (match?.[1]) return match[1];
  } catch {
    // Fall back to the repository/folder name used by normal installations.
  }
  return MODULE_NAME;
}

async function getInstalledExtensionTarget(extensionName) {
  const response = await fetch('/api/extensions/discover', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`无法识别扩展安装位置（HTTP ${response.status}）`);
  }

  const extensions = await response.json();
  const suffix = `/${extensionName}`.toLowerCase();
  const installed = Array.isArray(extensions)
    ? extensions.find(item => String(item?.name || '').toLowerCase().endsWith(suffix))
    : null;

  if (!installed) {
    throw new Error(`扩展管理器中未找到 ${extensionName}`);
  }

  return {
    extensionName,
    global: installed.type === 'global',
  };
}

async function handleUpdateClick() {
  const status = $('#mp_update_status');
  const updateButton = $('#mp_update_btn');
  const reloadButton = $('#mp_reload_btn');
  const originalText = updateButton.text();

  updateButton.prop('disabled', true).text('正在拉取更新...');
  reloadButton.prop('disabled', true);
  status.text('正在从仓库拉取 MemoryPilot 最新版本，请稍候...');

  try {
    const extensionName = getInstalledExtensionName();
    const target = await getInstalledExtensionTarget(extensionName);
    const getRequestHeaders = SillyTavern.getContext()?.getRequestHeaders;
    const headers = typeof getRequestHeaders === 'function'
      ? getRequestHeaders()
      : { 'Content-Type': 'application/json' };

    const response = await fetch('/api/extensions/update', {
      method: 'POST',
      headers,
      body: JSON.stringify(target),
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();
      throw new Error(detail || `服务器返回 HTTP ${response.status}`);
    }

    const result = await response.json();
    const commit = result?.shortCommitHash ? `（${result.shortCommitHash}）` : '';
    const msg = result?.isUpToDate
      ? `已确认是仓库最新版${commit}，正在刷新...`
      : `更新已拉取完成${commit}，正在刷新应用...`;

    status.text(msg);
    toastr?.success?.(msg);
    setTimeout(() => location.reload(), 800);
  } catch (e) {
    const msg = `更新失败：${e?.message || e}。未刷新页面，请检查网络、扩展安装方式或服务端日志。`;
    status.text(msg);
    toastr?.error?.(msg);
    updateButton.prop('disabled', false).text(originalText);
    reloadButton.prop('disabled', false);
  }
}

function bindSettingsEvents() {
  $('#mp_recall_version').on('change', function() {
    getSettings().recallVersion = $(this).val();
    saveSettings();
    toastr.success(`召回引擎切换为 ${$(this).val()}`);
  });
  $('#mp_show_chat_buttons').on('change', function() {
    getSettings().showChatBarButtons = this.checked;
    saveSettings();
    syncChatBarButtons();
  });
  $('#mp_panel_theme').on('change', function() {
    getSettings().panelTheme = this.value === 'light' ? 'light' : 'dark';
    saveSettings();
    const open = Boolean(document.getElementById('mp_main_panel') || document.getElementById('mp_api_panel') || document.getElementById('mp_recall_monitor_panel'));
    if (open) {
      document.getElementById('mp_main_panel')?.remove();
      document.getElementById('mp_main_style')?.remove();
      document.getElementById('mp_api_panel')?.remove();
      document.getElementById('mp_api_style')?.remove();
      document.getElementById('mp_recall_monitor_panel')?.remove();
      document.getElementById('mp_recall_monitor_style')?.remove();
      openPanel();
    }
  });
  $('#mp_show_logs').on('click', renderStorageLogBox);
  $('#mp_copy_logs').on('click', copyStorageLogs);
  $('#mp_clear_logs').on('click', function() {
    if (!confirm('清空 MemoryPilot 存储日志？')) return;
    clearStorageLogs();
    $('#mp_storage_log_box').val('').hide();
    $('#mp_storage_log_status').text('日志已清空');
    toastr?.success?.('MemoryPilot 日志已清空');
  });
  $('#mp_update_btn').on('click', handleUpdateClick);
  $('#mp_reload_btn').on('click', function() {
    if (confirm('重载当前页面以应用已下载的 MemoryPilot 更新？')) location.reload();
  });
}

// ====== Event Hooks ======

function hookRecall() {
  try {
    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async () => {
      try { await runRecall(); } catch (e) { console.error('[MP] Recall error:', e); }
      captureChatMessageSnapshot();
    });
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SENT, captureChatMessageSnapshot);
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_EDITED, captureChatMessageSnapshot);
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_SWIPED, captureChatMessageSnapshot);
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_DELETED, async () => {
      try {
        const result = await handleChatMessageDeleted();
        if (result.removed > 0) {
          toastr?.info?.(`已回退到第 ${result.deletedFloor} 楼，移除 ${result.removed} 条受影响记忆`);
        }
      } catch (e) {
        console.warn('[MP] message deletion memory rollback err', e);
      }
    });
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, async () => {
      try {
        const recovery = await onChatChanged();
        if (recovery?.restored) {
          toastr?.success?.(`已随聊天备份恢复 ${recovery.memoryCount} 条 MemoryPilot 记忆`);
        }
      } catch (e) {
        console.warn('[MP] chat backup memory recovery err', e);
      }
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
        // 静默检测，不再弹 toastr —— migrateIfNeeded 内部已做幂等，不会重复处理
        const report = detectLegacyArtifacts();
        if (report.hasLegacyMpMetadata || report.hasLegacyMpVars || report.lwbSnapHasMpTraces) {
          console.log('[MP] 检测到旧版痕迹（不弹通知），可在 MP 面板 → 过滤 中手动清理。', report.summary);
        }
      } catch (e) { console.warn('[MP] detect legacy err', e); }
    });
  } catch (e) {
    console.warn('[MP] Could not hook events:', e);
  }
}

// ====== Init ======

jQuery(async () => {
  console.log(`[${MODULE_NAME}] Extension loaded (recall: ${getSettings().recallVersion})`);

  const ctx = SillyTavern.getContext();
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = {};
  }

  try {
    const recovery = await onChatChanged();
    if (recovery?.restored) {
      toastr?.success?.(`已随聊天备份恢复 ${recovery.memoryCount} 条 MemoryPilot 记忆`);
    }
    await migrateIfNeeded();
    // 静默检测，不再弹 toastr —— migrateIfNeeded 内部已做幂等
    const report = detectLegacyArtifacts();
    if (report.hasLegacyMpMetadata || report.hasLegacyMpVars || report.lwbSnapHasMpTraces) {
      console.log('[MP] 检测到旧版痕迹（不弹通知），可在 MP 面板 → 过滤 中手动清理。', report.summary);
    }
  } catch (e) { console.warn('[MP] startup migration err', e); }

  // Settings panel in extensions drawer
  const html = buildSettingsHtml();
  $('#extensions_settings2').append(html);
  bindSettingsEvents();

  // Buttons in wand menu (extensions menu / 魔法棒) — always accessible
  addWandMenuButtons();

  // Buttons above chat input (like original taskjs) — also kept for convenience
  syncChatBarButtons();

  // Re-add buttons if chat area is rebuilt
  ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
    setTimeout(() => {
      addWandMenuButtons();
      syncChatBarButtons();
    }, 500);
  });

  hookRecall();
});
