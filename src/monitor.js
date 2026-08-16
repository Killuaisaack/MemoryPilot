import { loadRecallSnapshot } from './recall-monitor-state.js';

export async function openMonitor() {
  const PANEL = 'mp_recall_monitor_panel';
  const STYLE = 'mp_recall_monitor_style';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if ($(PANEL)) { $(PANEL).remove(); $(STYLE)?.remove(); return; }
  document.getElementById('mp_main_panel')?.remove();
  document.getElementById('mp_main_style')?.remove();
  document.getElementById('mp_api_panel')?.remove();
  document.getElementById('mp_api_style')?.remove();

  const css = document.createElement('style');
  css.id = STYLE;
  css.textContent = `#${PANEL}{position:fixed;inset:0;z-index:10020;display:flex;justify-content:center;align-items:flex-start;padding:12px;box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#352f3c}#${PANEL} .mask{position:absolute;inset:0;background:rgba(55,48,63,.22);backdrop-filter:blur(3px)}#${PANEL} .card{position:relative;width:min(960px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:16px;box-shadow:0 18px 54px rgba(63,51,76,.18)}#${PANEL} .top{display:flex;justify-content:space-between;align-items:center;padding:13px 18px;background:#fff;border-bottom:1px solid #e8e3ed}#${PANEL} .title{font-size:18px;font-weight:700}#${PANEL} .close{border:0;background:transparent;font-size:22px;color:#756d7e;cursor:pointer}#${PANEL} nav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e8e3ed}#${PANEL} nav button,.btn{border:1px solid #d8d2df;border-radius:9px;background:#fff;color:#504858;padding:8px 12px;cursor:pointer}#${PANEL} nav button.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181}#${PANEL} .summary{padding:10px 14px;background:#f4f1f7;color:#655c6e;font-size:12px}#${PANEL} details{margin:12px 14px;background:#fff;border:1px solid #e1dce7;border-radius:12px;overflow:hidden}#${PANEL} summary{cursor:pointer;padding:13px 14px;font-weight:700;color:#493a57}#${PANEL} .body{padding:12px;max-height:48vh;overflow:auto;font-size:13px;line-height:1.65}#${PANEL} .item{padding:10px;margin-bottom:8px;background:#faf8fc;border:1px solid #e3dde9;border-radius:10px}#${PANEL} .muted{color:#817888;text-align:center;padding:14px}#${PANEL} .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:12px 14px}#${PANEL} .setting{padding:8px;background:#faf8fc;border:1px solid #e7e1eb;border-radius:8px;color:#625a6b}@media(max-width:600px){#${PANEL}{padding:0}#${PANEL} .card{max-height:100dvh;border-radius:0}.row{grid-template-columns:1fr}}`;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id = PANEL;
  root.innerHTML = `<div class="mask"></div><div class="card"><div class="top"><div class="title">MemoryPilot</div><button class="close" id="mpr_close" aria-label="关闭">×</button></div><nav><button data-tab="memory">记忆管理</button><button class="on" data-tab="monitor">召回监控</button><button data-tab="settings">设置</button></nav><div class="summary" id="mpr_summary">正在读取最近一次召回记录…</div><details open><summary>当前召回规则</summary><div class="body" id="mpr_rules"></div></details><details open><summary>最近一次用于匹配的聊天</summary><div class="body" id="mpr_sources"></div></details><details open><summary>最近一次召回结果</summary><div class="body" id="mpr_results"></div></details></div>`;
  document.body.appendChild(root);

  const render = () => {
    const snap = loadRecallSnapshot();
    if (!snap) {
      $('mpr_summary').textContent = '还没有召回记录。发送消息并生成回复后，可以在这里查看实际结果。';
      $('mpr_rules').innerHTML = '<div class="muted">完成一次召回后，这里会显示本次实际使用的设置。</div>';
      $('mpr_sources').innerHTML = '<div class="muted">暂无记录</div>';
      $('mpr_results').innerHTML = '<div class="muted">暂无记录</div>';
      return;
    }
    const sources = Array.isArray(snap.sources) ? snap.sources : [];
    const pinned = Array.isArray(snap.pinned) ? snap.pinned : [];
    const triggered = Array.isArray(snap.triggered) ? snap.triggered : [];
    $('mpr_summary').textContent = `最近一次召回记录${snap.savedAt ? `：${new Date(snap.savedAt).toLocaleTimeString()}` : ''}`;
    $('mpr_rules').innerHTML = `<div>每 ${esc(snap.recallEvery || 1)} 回合重新匹配，读取最近 ${esc(snap.contextWindow || sources.length)} 条聊天。</div><div class="row"><div class="setting">最多召回 ${esc(snap.maxRecall || 6)} 条触发记忆</div><div class="setting">命中后保持 ${esc(snap.stickyTurns ?? 5)} 轮</div><div class="setting">Anima 去重：${snap.animaDedupeEnabled === false ? '关闭' : '开启'}</div><div class="setting">小白 X 去重：${snap.xiaobaixDedupeEnabled === false ? '关闭' : '开启'}</div></div>`;
    $('mpr_sources').innerHTML = sources.length ? sources.map(item => `<article class="item"><b>#${esc(item.floor)} ${esc(item.speaker)}</b><div>${esc(item.raw || '（空）')}</div>${item.cleaned && item.cleaned !== item.raw ? `<details><summary>查看清洗后的内容</summary><div>${esc(item.cleaned)}</div></details>` : ''}</article>`).join('') : '<div class="muted">本轮没有可用于匹配的聊天内容。</div>';
    const renderList = (title, list) => `<h4>${title}（${list.length}）</h4>${list.length ? list.map(item => `<article class="item"><b>${esc(item.event || '（未命名记忆）')}</b><div>${esc(item.summary || '')}</div>${item.reason ? `<small>${esc(item.reason)}</small>` : ''}</article>`).join('') : '<div class="muted">没有内容</div>';
    $('mpr_results').innerHTML = renderList('常驻记忆', pinned) + renderList('关键词触发记忆', triggered);
  };
  $('mpr_close').onclick = () => { root.remove(); css.remove(); };
  root.querySelector('[data-tab="memory"]').onclick = () => window.MemoryPilot?.openPanel?.('list');
  root.querySelector('[data-tab="settings"]').onclick = () => window.MemoryPilot?.openApiConfig?.();
  render();
}
