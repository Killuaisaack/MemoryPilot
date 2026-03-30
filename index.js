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
    };
  }
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
}

// ====== Event Hooks ======

function hookRecall() {
  try {
    const ctx = SillyTavern.getContext();
    ctx.eventSource.on(ctx.eventTypes.MESSAGE_RECEIVED, async () => {
      try { await runRecall(); } catch (e) { console.error('[MP] Recall error:', e); }
    });
    ctx.eventSource.on(ctx.eventTypes.CHAT_CHANGED, async () => {
      try { onChatChanged(); } catch {}
      try {
        const prev = localStorage.getItem('mp_active_chat');
        const curr = String(ctx.chatId ?? '');
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

jQuery(async () => {
  console.log(`[${MODULE_NAME}] Extension loaded (recall: ${getSettings().recallVersion})`);

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
