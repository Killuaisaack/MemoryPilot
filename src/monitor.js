import { loadRecallSnapshot } from './recall-monitor-state.js';

export async function openMonitor() {
  const panelId = 'mp_recall_monitor_panel';
  const styleId = 'mp_recall_monitor_style';
  const existing = document.getElementById(panelId);
  if (existing) {
    existing.remove();
    document.getElementById(styleId)?.remove();
    return;
  }
  document.getElementById('mp_main_panel')?.remove();
  document.getElementById('mp_main_style')?.remove();
  document.getElementById('mp_api_panel')?.remove();
  document.getElementById('mp_api_style')?.remove();

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `#${panelId}{position:fixed;inset:0;z-index:10020;display:flex;justify-content:center;align-items:flex-start;padding:12px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#352f3c}#${panelId} .mask{position:absolute;inset:0;background:rgba(55,48,63,.22);backdrop-filter:blur(3px)}#${panelId} .card{position:relative;width:min(960px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:16px;box-shadow:0 18px 54px rgba(63,51,76,.18)}#${panelId} .top{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;background:#fff;border-bottom:1px solid #e8e3ed}#${panelId} .title{font-size:18px;font-weight:700}#${panelId} .close{border:0;background:transparent;font-size:22px;color:#756d7e;cursor:pointer}#${panelId} nav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e8e3ed}#${panelId} nav button,.btn{border:1px solid #d8d2df;border-radius:9px;background:#fff;color:#504858;padding:8px 12px;cursor:pointer}#${panelId} nav button.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181}#${panelId} .summary{padding:10px 14px;background:#f4f1f7;color:#655c6e;font-size:12px}#${panelId} details{margin:12px 14px;background:#fff;border:1px solid #e1dce7;border-radius:12px;overflow:hidden}#${panelId} summary{cursor:pointer;padding:13px 14px;font-weight:700;color:#493a57}#${panelId} .body{padding:12px;max-height:48vh;overflow:auto;font-size:13px;line-height:1.65}#${panelId} .item{padding:10px;margin-bottom:8px;background:#faf8fc;border:1px solid #e3dde9;border-radius:10px}#${panelId} .muted{color:#817888;text-align:center;padding:14px}#${panelId} .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:12px 14px}#${panelId} .setting{padding:8px;background:#faf8fc;border:1px solid #e7e1eb;border-radius:8px;color:#625a6b}@media(max-width:600px){#${panelId}{padding:0}#${panelId} .card{max-height:100dvh;border-radius:0}}`;
  const theme = window.MemoryPilot?.getSettings?.()?.panelTheme || 'dark';
  if (theme === 'dark') style.textContent += `#${panelId}{color:#ddd!important;color-scheme:dark}#${panelId} .mask{background:rgba(0,0,0,.55)!important}#${panelId} .card{background:#222327!important;border-color:rgba(255,255,255,.08)!important;box-shadow:0 16px 50px rgba(0,0,0,.5)!important}#${panelId} .top,#${panelId} nav{background:#292a2f!important;border-color:rgba(255,255,255,.08)!important}#${panelId} nav button{background:#303138!important;border-color:rgba(255,255,255,.12)!important;color:#c9c7d0!important}#${panelId} nav button.on{background:rgba(124,107,240,.25)!important;border-color:rgba(124,107,240,.5)!important;color:#c4b5fd!important}#${panelId} .summary{background:rgba(0,0,0,.25)!important;color:#aaa!important}#${panelId} details{background:rgba(255,255,255,.025)!important;border-color:rgba(255,255,255,.08)!important}#${panelId} summary{color:#ddd!important}#${panelId} .item,#${panelId} .setting{background:rgba(255,255,255,.03)!important;border-color:rgba(255,255,255,.08)!important;color:#ddd!important}#${panelId} .muted{color:#999!important}`;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = panelId;
  root.innerHTML = `<div class="mask"></div><div class="card"><div class="top"><div class="title">MemoryPilot</div><button class="close" id="mpr_close" aria-label="关闭">×</button></div><nav><button data-tab="memory">记忆管理</button><button class="on" data-tab="monitor">召回监控</button><button data-tab="settings">设置</button></nav><div class="summary" id="mpr_summary">正在读取最近一次召回记录…</div><details open><summary>当前召回规则</summary><div class="body" id="mpr_rules"></div></details><details open><summary>最近一次用于匹配的聊天</summary><div class="body" id="mpr_sources"></div></details><details open><summary>最近一次召回结果</summary><div class="body" id="mpr_results"></div></details></div>`;
  document.body.appendChild(root);
  const byId = id => document.getElementById(id);
  const renderList = (title, list) => `<h4>${title}（${list.length}）</h4>${list.length ? list.map(item => `<article class="item"><b>${esc(item.event || '未命名记忆')}</b><div>${esc(item.summary || '')}</div>${item.reason ? `<small>${esc(item.reason)}</small>` : ''}</article>`).join('') : '<div class="muted">没有内容</div>'}`;
  const render = () => {
    const snap = loadRecallSnapshot();
    if (!snap) {
      byId('mpr_summary').textContent = '还没有召回记录。发送一条消息并生成回复后，可以在这里查看实际结果。';
      byId('mpr_rules').innerHTML = '<div class="muted">完成一次召回后，这里会显示本次使用的设置。</div>';
      byId('mpr_sources').innerHTML = '<div class="muted">暂无记录</div>';
      byId('mpr_results').innerHTML = '<div class="muted">暂无记录</div>';
      return;
    }
    const sources = Array.isArray(snap.sources) ? snap.sources : [];
    const pinned = Array.isArray(snap.pinned) ? snap.pinned : [];
    const triggered = Array.isArray(snap.triggered) ? snap.triggered : [];
    byId('mpr_summary').textContent = `最近一次召回${snap.savedAt ? `（${new Date(snap.savedAt).toLocaleTimeString()}）` : ''}`;
    byId('mpr_rules').innerHTML = `<div>每 ${esc(snap.recallEvery || 1)} 轮重新匹配，读取最近 ${esc(snap.contextWindow || sources.length)} 条聊天。</div><div class="row"><div class="setting">最多召回 ${esc(snap.maxRecall || 6)} 条</div><div class="setting">命中后保留 ${esc(snap.stickyTurns ?? 5)} 轮</div><div class="setting">Anima 去重：${snap.animaDedupeEnabled === false ? '关闭' : '开启'}</div><div class="setting">小白 X 去重：${snap.xiaobaixDedupeEnabled === false ? '关闭' : '开启'}</div></div>`;
    byId('mpr_sources').innerHTML = sources.length ? sources.map(item => `<article class="item"><b>#${esc(item.floor)} ${esc(item.speaker)}</b><div>${esc(item.raw || '（空）')}</div></article>`).join('') : '<div class="muted">本轮没有可用于匹配的聊天内容。</div>';
    byId('mpr_results').innerHTML = renderList('常驻记忆', pinned) + renderList('关键词触发记忆', triggered);
  };
  byId('mpr_close').onclick = () => { root.remove(); style.remove(); };
  root.querySelector('[data-tab="memory"]').onclick = () => window.MemoryPilot?.openPanel?.('list');
  root.querySelector('[data-tab="settings"]').onclick = () => window.MemoryPilot?.openApiConfig?.();
  render();
}
