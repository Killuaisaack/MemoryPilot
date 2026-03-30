// MemoryPilot - SillyTavern Extension
// Storage: extensionSettings (server-synced, outside chat jsonl)
// Prompt injection: chatMetadata.variables only (for {{getvar::}} macro)
// ZERO STscript /setvar calls — immune to LWB_SNAP snapshot bloat

import { runRecall as runRecallV34 } from './src/recall-v34.js';
import { runRecall as runRecallV32 } from './src/recall-v32.js';
import { openPanel } from './src/panel.js';
import { openApiConfig } from './src/api-config.js';
import { openMonitor } from './src/monitor.js';

const MODULE_NAME = 'MemoryPilot';
const extensionFolderPath = `scripts/extensions/third-party/MemoryPilot`;

function getSettings() {
  const { extensionSettings } = SillyTavern.getContext();
  if (!extensionSettings[MODULE_NAME]) {
    extensionSettings[MODULE_NAME] = {};
  }
  const s = extensionSettings[MODULE_NAME];
  // Global settings (not per-chat)
  if (!s._global) {
    s._global = {
      recallVersion: 'v34',
      customPrompts: {},
    };
  }
  return s._global;
}

function saveSettings() {
  try { SillyTavern.getContext().saveSettingsDebounced(); } catch {}
}

// Run the selected recall engine version
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

// Make these available globally for panel/monitor code
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
};

// ====== Settings Panel HTML ======

function buildSettingsHtml() {
  const settings = getSettings();
  return `
    <div class="mp-settings-panel">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>MemoryPilot</b>
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
            <hr>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button id="mp_open_panel" class="menu_button">管理面板</button>
              <button id="mp_open_api" class="menu_button">API 配置</button>
              <button id="mp_open_monitor" class="menu_button">召回监控</button>
            </div>
            <div class="mp-info" style="font-size:11px;color:var(--SmartThemeQuoteColor);margin-top:4px">
              存储: extensionSettings (服务端同步)<br>
              Prompt 注入: chatMetadata.variables<br>
              STscript /setvar: 0 (不被 LWB 快照)
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
  $('#mp_open_panel').on('click', () => openPanel());
  $('#mp_open_api').on('click', () => openApiConfig());
  $('#mp_open_monitor').on('click', () => openMonitor());
}

// ====== Event Hooks ======

function hookRecall() {
  try {
    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async () => {
      try { await runRecall(); } catch (e) { console.error('[MP] Recall error:', e); }
    });
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, () => {
      try {
        const prev = localStorage.getItem('mp_active_chat');
        const curr = String(ctx.chatId ?? '');
        if (prev && prev !== curr) {
          ['mp_memories_' + prev].forEach(k => {
            try { localStorage.removeItem(k); } catch {}
          });
        }
        localStorage.setItem('mp_active_chat', curr);
      } catch {}
    });
  } catch (e) {
    console.warn('[MP] Could not hook events:', e);
  }
}

function registerCommands() {
  try {
    const ctx = SillyTavern.getContext();
    const parser = ctx.SlashCommandParser;
    if (parser?.addCommandObject) {
      // Use the new API if available
      console.log('[MP] Registering slash commands via new API');
    }
    // Fallback: register via eventSource
    ctx.eventSource.on('mp_open_panel', () => openPanel());
  } catch (e) {
    console.warn('[MP] Slash command registration:', e);
  }
}

// ====== Init ======

jQuery(async () => {
  console.log(`[${MODULE_NAME}] Extension loaded (recall: ${getSettings().recallVersion})`);

  const ctx = SillyTavern.getContext();
  if (!ctx.extensionSettings[MODULE_NAME]) {
    ctx.extensionSettings[MODULE_NAME] = {};
  }

  // Add settings panel
  const html = buildSettingsHtml();
  $('#extensions_settings2').append(html);
  bindSettingsEvents();

  hookRecall();
  registerCommands();
});
