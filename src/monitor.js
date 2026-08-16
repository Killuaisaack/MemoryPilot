// MemoryPilot recall inspection panel.
// Displays a passive snapshot produced by the latest real recall run.

import { loadRecallSnapshot } from './recall-monitor-state.js';

export async function openMonitor() {
  const PANEL = 'mp_recall_monitor_panel';
  const STYLE = 'mp_recall_monitor_style';
  const $ = id => document.getElementById(id);
  const h = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));

  if ($(PANEL)) {
    $(PANEL).remove();
    $(STYLE)?.remove();
    return;
  }
  document.getElementById('mp_main_panel')?.remove();
  document.getElementById('mp_main_style')?.remove();
  document.getElementById('mp_api_panel')?.remove();
  document.getElementById('mp_api_style')?.remove();

  const css = document.createElement('style');
  css.id = STYLE;
  css.textContent = `
    #${PANEL}{position:fixed;inset:0;z-index:10020;display:flex;align-items:flex-start;justify-content:center;padding:max(12px,env(safe-area-inset-top)) 12px max(12px,env(safe-area-inset-bottom));box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#352f3c}
    #${PANEL} .mask{position:absolute;inset:0;background:rgba(55,48,63,.22);backdrop-filter:blur(3px)}
    #${PANEL} .card{position:relative;width:min(980px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#f8f6fb;border:1px solid #ddd7e5;border-radius:16px;box-shadow:0 18px 54px rgba(63,51,76,.18)}
    #${PANEL} .topline{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;background:#fff;border-bottom:1px solid #e8e3ed}
    #${PANEL} .ttl{font-size:18px;font-weight:700;color:#302a37}
    #${PANEL} .topactions{display:flex;align-items:center;gap:4px}
    #${PANEL} .iconbtn{width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:#756d7e;font-size:18px;cursor:pointer}
    #${PANEL} .iconbtn:hover{background:#f0ecf5;color:#3f3748}
    #${PANEL} .hubnav{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:8px 12px;background:#fff;border-bottom:1px solid #e8e3ed}
    #${PANEL} .hubtab{min-height:38px;border:1px solid #ded8e6;border-radius:10px;background:#faf9fb;color:#625a6b;font-size:12px;font-weight:600;cursor:pointer}
    #${PANEL} .hubtab.on{background:#ebe5f4;border-color:#b7a8cb;color:#675181}
    #${PANEL} .summarybar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;background:#f4f1f7;border-bottom:1px solid #e3dfe8}
    #${PANEL} .summarytext{font-size:12px;line-height:1.55;color:#655c6e}
    #${PANEL} .btn{border:1px solid #d8d2df;border-radius:9px;background:#fff;color:#504858;padding:8px 12px;cursor:pointer;white-space:nowrap}
    #${PANEL} .btn:hover{background:#f0ecf4}
    #${PANEL} .rules{padding:10px 14px 0}
    #${PANEL} .rules>summary{cursor:pointer;color:#6d5488;font-size:12px;font-weight:700;list-style:none}
    #${PANEL} .rules>summary::-webkit-details-marker{display:none}
    #${PANEL} .rules>summary::before{content:"▸";display:inline-block;margin-right:6px;transition:transform .15s ease}
    #${PANEL} .rules[open]>summary::before{transform:rotate(90deg)}
    #${PANEL} .rulesbody{margin-top:8px;padding:11px 13px;background:#fff;border:1px solid #e1dce7;border-radius:10px;color:#625a6b;font-size:12px;line-height:1.7}
    #${PANEL} .flowtitle{margin:0 0 7px;color:#493a57;font-size:12px;font-weight:700}
    #${PANEL} .flowline{padding:9px 10px;background:#f7f3fa;border-radius:8px;color:#51465b;line-height:1.7}
    #${PANEL} .flowhint{margin-top:7px;color:#786f80}
    #${PANEL} .settingshead{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding-top:11px;border-top:1px solid #eee9f1}
    #${PANEL} .settingshead h4{margin:0;color:#493a57;font-size:12px}
    #${PANEL} .settingshead .btn{padding:6px 9px;font-size:11px}
    #${PANEL} .settingslist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:8px}
    #${PANEL} .settingitem{padding:8px 9px;background:#faf8fc;border:1px solid #e7e1eb;border-radius:8px;color:#625a6b}
    #${PANEL} .content{padding:14px;display:grid;gap:12px}
    #${PANEL} .fold{display:block;overflow:hidden;background:#fff;border:1px solid #e1dce7;border-radius:12px;box-shadow:0 2px 8px rgba(66,54,78,.035)}
    #${PANEL} .fold>summary{position:relative;list-style:none;cursor:pointer;padding:13px 44px 13px 14px;background:#fcfbfd}
    #${PANEL} .fold>summary::-webkit-details-marker{display:none}
    #${PANEL} .fold>summary::after{content:"›";position:absolute;right:16px;top:50%;color:#765d8f;font-size:25px;line-height:1;transform:translateY(-50%);transition:transform .16s ease}
    #${PANEL} .fold[open]>summary::after{transform:translateY(-50%) rotate(90deg)}
    #${PANEL} .fold[open]>summary{border-bottom:1px solid #e7e2eb}
    #${PANEL} .foldtitle{display:block;color:#362f3d;font-size:14px;font-weight:700}
    #${PANEL} .foldsub{display:block;margin-top:4px;color:#746c7c;font-size:12px;line-height:1.5}
    #${PANEL} .foldbody{height:min(48vh,380px);padding:12px;overflow:auto;box-sizing:border-box;color:#494151;font-size:13px;line-height:1.65}
    #${PANEL} .source{padding:10px 11px;margin-bottom:9px;background:#faf8fc;border:1px solid #e3dde9;border-radius:10px}
    #${PANEL} .sourcehead{display:flex;gap:8px;align-items:center;margin-bottom:6px;color:#6d5488;font-size:12px;font-weight:700}
    #${PANEL} .sourcetext{white-space:pre-wrap;word-break:break-word;max-height:170px;overflow:auto}
    #${PANEL} .cleaned{margin-top:8px;padding-top:8px;border-top:1px dashed #ddd5e5}
    #${PANEL} .cleaned summary{cursor:pointer;color:#796589;font-size:12px}
    #${PANEL} .cleanedtext{margin-top:6px;white-space:pre-wrap;color:#5e5665}
    #${PANEL} .grouphead{display:flex;justify-content:space-between;align-items:center;margin:2px 1px 8px;color:#4b3b59;font-size:12px;font-weight:700}
    #${PANEL} .count{padding:1px 7px;border-radius:999px;background:#eee7f5;color:#715985;font-weight:600}
    #${PANEL} .memory{padding:11px;margin-bottom:9px;background:#faf8fc;border:1px solid #e3dde9;border-radius:10px}
    #${PANEL} .memoryevent{font-weight:700;color:#564067}
    #${PANEL} .memorysummary{margin-top:6px;white-space:pre-wrap;word-break:break-word;max-height:150px;overflow:auto}
    #${PANEL} .reason{margin-top:7px;padding-top:7px;border-top:1px dashed #ddd5e5;color:#765d8f;font-size:12px}
    #${PANEL} .divider{height:1px;margin:13px 0;background:#e8e2ec}
    #${PANEL} .empty{padding:14px;color:#817888;text-align:center}
    @media(max-width:600px){
      #${PANEL}{padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
      #${PANEL} .card{max-height:100dvh;border-radius:0;border-left:0;border-right:0}
      #${PANEL} .topline{padding:11px 13px}
      #${PANEL} .hubnav{padding:7px 8px;gap:5px}
      #${PANEL} .hubtab{min-height:36px;font-size:11px}
      #${PANEL} .summarybar{padding:9px 10px}
      #${PANEL} .content{padding:10px}
      #${PANEL} .foldbody{height:min(52vh,390px)}
      #${PANEL} .settingslist{grid-template-columns:1fr}
    }
  `;
  document.head.appendChild(css);

  const root = document.createElement('div');
  root.id = PANEL;
  root.innerHTML = `
    <div class="mask"></div>
    <div class="card">
      <div class="topline"><div class="ttl">MemoryPilot</div><div class="topactions"><button class="iconbtn" id="mpr_help" title="新手指引">?</button><button class="iconbtn" id="mpr_close" aria-label="关闭">&times;</button></div></div>
      <nav class="hubnav" aria-label="MemoryPilot 主导航">
        <button class="hubtab" data-hub="memory">记忆管理</button>
        <button class="hubtab on" data-hub="monitor">召回监控</button>
        <button class="hubtab" data-hub="settings">设置</button>
      </nav>
      <div class="summarybar"><div class="summarytext" id="mpr_summary">正在读取最近一次召回记录…</div><button class="btn" id="mpr_refresh">刷新显示</button></div>
      <details class="rules"><summary>当前召回规则</summary><div class="rulesbody" id="mpr_rules"></div></details>
      <div class="content">
        <details class="fold"><summary><span class="foldtitle">最近一次用于匹配的聊天</span><span class="foldsub" id="mpr_source_sub">最近一次召回读取的聊天内容。</span></summary><div class="foldbody" id="mpr_sources"></div></details>
        <details class="fold"><summary><span class="foldtitle">最近一次召回结果</span><span class="foldsub" id="mpr_result_sub">原召回引擎实际写入记忆变量的结果。</span></summary><div class="foldbody" id="mpr_results"></div></details>
      </div>
    </div>`;
  document.body.appendChild(root);

  const formatTime = timestamp => {
    if (!timestamp) return '';
    try { return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  };
  const sameText = (a, b) => String(a || '').trim() === String(b || '').trim();

  const renderSources = sources => {
    if (!sources.length) return '<div class="empty">本轮没有可用于匹配的聊天内容。</div>';
    return sources.map(item => {
      const changed = !sameText(item.raw, item.cleaned);
      return `<article class="source"><div class="sourcehead"><span>#${h(item.floor)}</span><span>${h(item.speaker)}</span></div><div class="sourcetext">${h(item.raw || '（空）')}</div>${changed ? `<details class="cleaned"><summary>查看清洗后用于匹配的内容</summary><div class="cleanedtext">${h(item.cleaned || '（已被清洗为空）')}</div></details>` : ''}</article>`;
    }).join('');
  };

  const renderMemory = item => `<article class="memory"><div class="memoryevent">${h(item.event || '（无事件名）')}</div><div class="memorysummary">${h(item.summary || '')}</div>${item.reason ? `<div class="reason">${h(item.reason)}</div>` : ''}</article>`;
  const renderResults = snapshot => {
    const pinned = Array.isArray(snapshot.pinned) ? snapshot.pinned : [];
    const triggered = Array.isArray(snapshot.triggered) ? snapshot.triggered : [];
    if (!pinned.length && !triggered.length) return '<div class="empty">本轮没有召回任何记忆。</div>';
    return `<div class="grouphead"><span>常驻记忆</span><span class="count">${pinned.length}</span></div>${pinned.length ? pinned.map(renderMemory).join('') : '<div class="empty">无</div>'}<div class="divider"></div><div class="grouphead"><span>关键词触发记忆</span><span class="count">${triggered.length}</span></div>${triggered.length ? triggered.map(renderMemory).join('') : '<div class="empty">无</div>'}`;
  };

  const render = () => {
    const snapshot = loadRecallSnapshot();
    if (!snapshot) {
      $('mpr_summary').textContent = '还没有召回记录。发送一条消息并生成 AI 回复后，再回到这里查看。';
      $('mpr_sources').innerHTML = '<div class="empty">暂无记录</div>';
      $('mpr_results').innerHTML = '<div class="empty">暂无记录</div>';
      $('mpr_source_sub').textContent = '最近一次召回读取的聊天内容。';
      $('mpr_result_sub').textContent = '原召回引擎实际写入记忆变量的结果。';
      $('mpr_rules').innerHTML = `<h4 class="flowtitle">召回流程</h4><div class="flowline">AI 回复到达 → MemoryPilot 按原引擎时序计算召回 → 更新下一轮使用的记忆变量</div><div class="flowhint">本页只被动记录最近一次真实召回，不预测下一次召回，也不会修改命中、评分、排序或配额。</div><div class="settingshead"><h4>当前设置</h4><button class="btn" id="mpr_open_recall_settings">修改召回设置</button></div><div class="empty">完成一次召回后显示本次实际使用的设置。</div>`;
    } else {
      const sources = Array.isArray(snapshot.sources) ? snapshot.sources : [];
      const pinned = Array.isArray(snapshot.pinned) ? snapshot.pinned : [];
      const triggered = Array.isArray(snapshot.triggered) ? snapshot.triggered : [];
      $('mpr_summary').textContent = `最近一次召回记录：${formatTime(snapshot.savedAt)}`;
      $('mpr_source_sub').textContent = `读取最近 ${snapshot.contextWindow || sources.length} 条聊天；本轮实际取得 ${sources.length} 条。`;
      const dedupeText = Number(snapshot.animaDedupeRemoved) > 0 ? `；已避免 ${snapshot.animaDedupeRemoved} 条 Anima 重复注入` : '';
      $('mpr_result_sub').textContent = `${pinned.length} 条常驻记忆，${triggered.length} 条关键词触发记忆${dedupeText}。`;
      $('mpr_sources').innerHTML = renderSources(sources);
      $('mpr_results').innerHTML = renderResults(snapshot);
      $('mpr_rules').innerHTML = `<h4 class="flowtitle">召回流程</h4><div class="flowline">AI 回复到达 → MemoryPilot 按原引擎时序计算召回 → 更新下一轮使用的记忆变量</div><div class="flowhint">本页只被动记录最近一次真实召回，不预测下一次召回，也不会修改命中、评分、排序或配额。</div><div class="settingshead"><h4>当前设置</h4><button class="btn" id="mpr_open_recall_settings">修改召回设置</button></div><div class="settingslist"><div class="settingitem">每 ${h(snapshot.recallEvery || 1)} 回合重新匹配</div><div class="settingitem">读取最近 ${h(snapshot.contextWindow || sources.length)} 条聊天</div><div class="settingitem">最多召回 ${h(snapshot.maxRecall || 6)} 条触发记忆</div><div class="settingitem">命中后保持 ${h(snapshot.stickyTurns ?? 5)} 轮</div><div class="settingitem">Anima 召回去重：${snapshot.animaDedupeEnabled === false ? '关闭' : '开启'}</div></div>`;
    }
    $('mpr_open_recall_settings')?.addEventListener('click', () => window.MemoryPilot?.openPanel?.('cfg', 'recall'));
  };

  root.querySelector('[data-hub="memory"]')?.addEventListener('click', () => window.MemoryPilot?.openPanel?.('list'));
  root.querySelector('[data-hub="settings"]')?.addEventListener('click', () => window.MemoryPilot?.openApiConfig?.());
  $('mpr_help').onclick = async () => { await window.MemoryPilot?.openPanel?.('list'); setTimeout(() => document.getElementById('mp_help')?.click(), 180); };
  $('mpr_close').onclick = () => { root.remove(); css.remove(); };
  $('mpr_refresh').onclick = render;
  render();

  let refreshTimer = null;
  const chatContainer = document.getElementById('chat');
  if (chatContainer) {
    const observer = new MutationObserver(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => { if ($(PANEL)) render(); }, 500);
    });
    observer.observe(chatContainer, { childList: true, subtree: false });
    const cleanup = setInterval(() => {
      if (!$(PANEL)) { observer.disconnect(); clearInterval(cleanup); }
    }, 3000);
  }
}
