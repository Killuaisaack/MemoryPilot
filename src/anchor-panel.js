/**
 * MemoryPilot v4.0.0 — Anchor Panel (分层记忆面板)
 * 
 * Standalone panel for managing layered (permanent) memories + timeline.
 * Features: timeline CRUD, AI extraction, AI recall agent, import/export.
 */

import {
  LAYER_DEFS, LAYER_KEYS, loadLayered, saveLayered,
  addLayeredEntry, updateLayeredEntry, deleteLayeredEntry,
  getLayeredStats, buildLayeredInjection, buildRecallAgentContext,
  injectRecallNarrative,
  loadTimeline, saveTimeline, addTimelineEntry, updateTimelineEntry, deleteTimelineEntry,
  loadTodos, addTodo, completeTodo, updateTodo,
  semanticRecall, buildMissingVectors, getEmbeddingConfig, loadVectors,
  EXTRACT_LAYERED_PROMPT, EXTRACT_FROM_MEMORIES_PROMPT, AI_RECALL_PROMPT
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

  if ($(PANEL_ID)) { $(PANEL_ID).remove(); $(STYLE_ID)?.remove(); return; }
  try { ['mp_main_panel','mp_api_panel','mp_recall_monitor_panel'].forEach(id => document.getElementById(id)?.remove()); } catch {}

  // ====== API helpers (shared pattern from panel.js) ======
  const _EXT = 'MemoryPilot';
  const _getStore = () => {
    const c = window.SillyTavern?.getContext?.(); if (!c?.extensionSettings) return null;
    if (!c.extensionSettings[_EXT]) c.extensionSettings[_EXT] = {};
    const charId = c?.characterId; const charObj = Number.isInteger(charId) ? c?.characters?.[charId] : null;
    const cs = String(charObj?.avatar ?? charObj?.name ?? c?.chatMetadata?.character_name ?? c?.name2 ?? '');
    const ck = `${String(c.chatId ?? c.chatMetadata?.chat_file_name ?? 'default')}::${cs}`;
    if (!c.extensionSettings[_EXT][ck]) c.extensionSettings[_EXT][ck] = {};
    return c.extensionSettings[_EXT][ck];
  };
  const AK = 'mp_api_config';
  const loadApi = () => { try { const r = localStorage.getItem(AK); if (r) return JSON.parse(r); } catch {} try { const s = _getStore(); if (s?.[AK]) return s[AK]; } catch {} return {}; };
  const normOAI = s => String(s??'').trim().replace(/\/+$/,'').replace(/\/chat\/completions$/i,'');
  const normClaude = s => String(s??'').trim().replace(/\/+$/,'').replace(/\/v1\/messages$/i,'');
  const normGemini = s => String(s??'').trim().replace(/\/+$/,'').replace(/\/models\/.*$/i,'');

  const callLLMOnce = async (prompt, signal) => {
    const api = loadApi(); const prov = api.provider||'openai'; const model = api.model||''; const key = api.key||''; const rawBase = api.url||'';
    if (!key || !model) throw new Error('请先在 MP API配置 中设置 Provider / Key / Model');
    const base = prov==='claude'?normClaude(rawBase):prov==='gemini'?normGemini(rawBase):normOAI(rawBase);
    if (prov === 'claude') {
      const r = await fetch((base||'https://api.anthropic.com')+'/v1/messages',{method:'POST',signal,headers:{'x-api-key':key,'anthropic-version':api.anthropicVersion||'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,max_tokens:Number(api.maxTokens)||4096,messages:[{role:'user',content:prompt}]})});
      if(!r.ok){const e=await r.text().catch(()=>'');throw new Error('Claude '+r.status+': '+e.slice(0,500));}
      const d=await r.json();return(d.content||[]).filter(x=>x?.type==='text').map(x=>x.text||'').join('\n');
    }
    if (prov === 'gemini') {
      const r = await fetch((base||'https://generativelanguage.googleapis.com/v1beta')+'/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',signal,headers:{'x-goog-api-key':key,'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:Number(api.maxTokens)||4096}})});
      if(!r.ok){const e=await r.text().catch(()=>'');throw new Error('Gemini '+r.status+': '+e.slice(0,500));}
      const d=await r.json();return(d.candidates||[]).flatMap(c=>c?.content?.parts||[]).map(p=>p?.text||'').join('\n');
    }
    const r = await fetch((base||'')+'/chat/completions',{method:'POST',signal,headers:{'Authorization':'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,messages:[{role:'user',content:prompt}],max_tokens:Number(api.maxTokens)||4096})});
    if(!r.ok){const e=await r.text().catch(()=>'');throw new Error('OpenAI '+r.status+': '+e.slice(0,500));}
    const d=await r.json();return d.choices?.[0]?.message?.content||'';
  };
  const callLLM = async (prompt, signal) => {
    for (let i = 0; i < 2; i++) {
      if (signal?.aborted) throw new DOMException('Aborted','AbortError');
      try { const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),120000); if(signal)signal.addEventListener('abort',()=>ctrl.abort()); try{return await callLLMOnce(prompt,ctrl.signal);}finally{clearTimeout(t);} }
      catch(e) { if(e?.name==='AbortError'&&signal?.aborted)throw e; const st=e?.status; if(st&&st>=400&&st<500&&st!==429)throw e; if(i<1)await new Promise(r=>setTimeout(r,3000)); else throw e; }
    }
  };
  const extractJson = (text) => { const r=[]; let d=0,s=-1; for(let i=0;i<text.length;i++){if(text[i]==='{'){if(d===0)s=i;d++;}else if(text[i]==='}'){d--;if(d===0&&s>=0){try{const o=JSON.parse(text.slice(s,i+1));if(o&&typeof o==='object')r.push(o);}catch{}s=-1;}}} return r; };
  const applyCleaner = (t) => String(t||'').replace(/<\s*think\b[^>]*>[\s\S]*?<\s*\/\s*think\s*>/gi,' ').replace(/<\s*details\b[^>]*>[\s\S]*?<\s*\/\s*details\s*>/gi,' ').trim();

  // ====== State ======
  let activeTab = 'identity'; // identity | scene | dynamics | timeline | recall
  let editingId = null;
  let _abort = null;

  // ====== Render helpers ======
  const renderStats = () => {
    const s = getLayeredStats();
    for (const k of LAYER_KEYS) { const el = $('mpa_c_'+k); if(el) el.textContent = s[k]; }
    const te = $('mpa_c_timeline'); if(te) te.textContent = s.timeline;
    const td = $('mpa_c_todos'); if(td) td.textContent = s.todos;
    const to = $('mpa_total'); if(to) to.textContent = s.total;
  };

  const renderList = () => {
    if (activeTab === 'timeline') { renderTimeline(); return; }
    if (activeTab === 'todos') { renderTodos(); return; }
    if (activeTab === 'recall') return; // recall tab has its own render
    const data = loadLayered();
    const list = data[activeTab] || [];
    const c = $('mpa_list'); if (!c) return;
    if (!list.length) { c.innerHTML = '<div class="mpa-empty">暂无'+LAYER_DEFS[activeTab].label+'<br><span style="font-size:11px;color:#777">点击「手动添加」或使用 AI 提取</span></div>'; return; }
    c.innerHTML = list.map((item, idx) => `<div class="mpa-item ${item.pinned===false?'mpa-unpinned':''}" data-id="${h(item.id)}"><div class="mpa-item-hd"><span class="mpa-icon">${LAYER_DEFS[activeTab].icon}</span><span class="mpa-lbl">${h(item.label)}</span>${item.dateLabel?'<span class="mpa-date">'+h(item.dateLabel)+'</span>':''}<span class="mpa-pin ${item.pinned===false?'off':''}" data-a="pin" data-id="${h(item.id)}" title="${item.pinned===false?'未注入':'已注入'}">📌</span></div><div class="mpa-ct">${h(item.content).replace(/\n/g,'<br>')}</div>${item.tags?.length?'<div class="mpa-tags">'+item.tags.map(t=>'<span class="mpa-tag">'+h(t)+'</span>').join('')+'</div>':''}<div class="mpa-acts"><button class="ab" data-a="edit" data-id="${h(item.id)}">编辑</button><button class="ab ad" data-a="del" data-id="${h(item.id)}">删除</button>${idx>0?'<button class="ab" data-a="up" data-id="'+h(item.id)+'">↑</button>':''}${idx<list.length-1?'<button class="ab" data-a="down" data-id="'+h(item.id)+'">↓</button>':''}</div></div>`).join('');
    c.querySelectorAll('[data-a]').forEach(el => { el.onclick = () => {
      const a=el.getAttribute('data-a'), id=el.getAttribute('data-id');
      if(a==='edit') startEdit(id); else if(a==='del') doDelete(id);
      else if(a==='pin') doTogglePin(id);
      else if(a==='up') doMove(id,-1); else if(a==='down') doMove(id,1);
    };});
  };

  const renderTimeline = () => {
    const tl = loadTimeline();
    const c = $('mpa_list'); if (!c) return;
    if (!tl.length) { c.innerHTML = '<div class="mpa-empty">暂无时间线条目<br><span style="font-size:11px;color:#777">手动添加或用 AI 提取</span></div>'; return; }
    const impIcon = { turning: '★', key: '●', normal: '·' };
    const impColor = { turning: '#f87171', key: '#fbbf24', normal: '#888' };
    c.innerHTML = tl.map(e => `<div class="mpa-item mpa-tl-item"><div class="mpa-item-hd"><span style="color:${impColor[e.importance]||'#888'};font-size:16px;margin-right:4px">${impIcon[e.importance]||'·'}</span><span class="mpa-date" style="font-size:13px;font-weight:600">${h(e.dateLabel||'?')}</span></div><div class="mpa-ct">${h(e.summary)}</div><div class="mpa-acts"><button class="ab" data-a="tl_edit" data-id="${h(e.id)}">编辑</button><button class="ab ad" data-a="tl_del" data-id="${h(e.id)}">删除</button></div></div>`).join('');
    c.querySelectorAll('[data-a]').forEach(el => { el.onclick = () => {
      const a=el.getAttribute('data-a'), id=el.getAttribute('data-id');
      if(a==='tl_edit') startTimelineEdit(id); else if(a==='tl_del') { if(confirm('删除此时间线条目？')){deleteTimelineEntry(id);renderList();renderStats();toastr?.success?.('已删除');} }
    };});
  };

  const renderTodos = () => {
    const todos = loadTodos().filter(t => !t.done);
    const c = $('mpa_list'); if (!c) return;
    if (!todos.length) { c.innerHTML = '<div class="mpa-empty">暂无待办事项<br><span style="font-size:11px;color:#777">当角色做出约定/承诺时自动提取，或手动添加</span></div>'; return; }
    c.innerHTML = todos.map(t => `<div class="mpa-item" style="border-left:3px solid #fb923c"><div class="mpa-item-hd"><span style="font-size:14px;margin-right:4px">📋</span><span class="mpa-ct" style="flex:1">${h(t.content)}</span>${t.dateLabel?'<span class="mpa-date">'+h(t.dateLabel)+'</span>':''}</div><div class="mpa-acts"><button class="ab ap" data-a="todo_done" data-id="${h(t.id)}">✅ 完成</button><button class="ab" data-a="todo_edit" data-id="${h(t.id)}">编辑</button><button class="ab ad" data-a="todo_del" data-id="${h(t.id)}">删除</button></div></div>`).join('');
    c.querySelectorAll('[data-a]').forEach(el => { el.onclick = () => {
      const a=el.getAttribute('data-a'), id=el.getAttribute('data-id');
      if(a==='todo_done') { completeTodo(id); renderList(); renderStats(); toastr?.success?.('已完成'); try { const { injectLayered } = require('./layered-memory.js'); injectLayered(); } catch {} }
      else if(a==='todo_del') { if(confirm('删除此待办？')){ completeTodo(id); renderList(); renderStats(); } }
      else if(a==='todo_edit') { startTodoEdit(id); }
    };});
  };

  const startTodoAdd = () => {
    $('mpa_todo_editor').style.display = '';
    $('mpa_todo_ed_content').value = '';
    $('mpa_todo_ed_date').value = '';
    $('mpa_todo_ed_title').textContent = '添加待办';
    editingId = null;
  };

  const startTodoEdit = (id) => {
    const todos = loadTodos();
    const t = todos.find(x => x.id === id); if (!t) return;
    $('mpa_todo_editor').style.display = '';
    $('mpa_todo_ed_content').value = t.content || '';
    $('mpa_todo_ed_date').value = t.dateLabel || '';
    $('mpa_todo_ed_title').textContent = '编辑待办';
    editingId = id;
  };

  const doTodoSave = () => {
    const content = ($('mpa_todo_ed_content').value || '').trim();
    const dateLabel = ($('mpa_todo_ed_date').value || '').trim();
    if (!content) { toastr?.warning?.('请输入内容'); return; }
    if (editingId) { updateTodo(editingId, { content, dateLabel }); toastr?.success?.('已保存'); }
    else { addTodo({ content, dateLabel, source: 'manual' }); toastr?.success?.('已添加'); }
    editingId = null; $('mpa_todo_editor').style.display = 'none';
    renderList(); renderStats();
  };

  // ====== Editor ======
  const startEdit = (id) => {
    const data = loadLayered(); const item = (data[activeTab]||[]).find(x=>x.id===id); if(!item) return;
    editingId = id;
    $('mpa_ed_layer').value = item.layer||activeTab; $('mpa_ed_label').value = item.label||'';
    $('mpa_ed_content').value = item.content||''; $('mpa_ed_tags').value = (item.tags||[]).join(', ');
    $('mpa_ed_date').value = item.dateLabel||'';
    $('mpa_editor').style.display = ''; $('mpa_tl_editor').style.display = 'none';
    $('mpa_ed_title').textContent = '编辑锚点'; $('mpa_ed_save').textContent = '保存修改';
  };
  const startAdd = () => {
    editingId = null;
    $('mpa_ed_layer').value = activeTab === 'timeline' ? 'dynamics' : activeTab;
    $('mpa_ed_label').value=''; $('mpa_ed_content').value=''; $('mpa_ed_tags').value=''; $('mpa_ed_date').value='';
    $('mpa_editor').style.display = ''; $('mpa_tl_editor').style.display = 'none';
    $('mpa_ed_title').textContent = '添加锚点'; $('mpa_ed_save').textContent = '添加';
  };
  const doSave = () => {
    const layer=$('mpa_ed_layer').value||activeTab, label=($('mpa_ed_label').value||'').trim(), content=($('mpa_ed_content').value||'').trim();
    const tags=($('mpa_ed_tags').value||'').split(/[,，]/).map(s=>s.trim()).filter(Boolean), dateLabel=($('mpa_ed_date').value||'').trim();
    if(!label){toastr?.warning?.('请输入标签名');return;} if(!content){toastr?.warning?.('请输入内容');return;}
    if(editingId){
      const data=loadLayered(); const oldItem=(data[activeTab]||[]).find(x=>x.id===editingId);
      if(oldItem&&layer!==activeTab){deleteLayeredEntry(activeTab,editingId);addLayeredEntry(layer,{label,content,tags,dateLabel});activeTab=layer;}
      else updateLayeredEntry(activeTab,editingId,{label,content,tags,dateLabel});
      toastr?.success?.('已保存');
    } else { addLayeredEntry(layer,{label,content,tags,dateLabel}); if(layer!==activeTab)activeTab=layer; toastr?.success?.('已添加'); }
    editingId=null; $('mpa_editor').style.display='none'; switchTab(activeTab);
  };
  const doDelete = (id) => { if(!confirm('确定删除？'))return; deleteLayeredEntry(activeTab,id); renderList(); renderStats(); };
  const doTogglePin = (id) => { const data=loadLayered(); const item=(data[activeTab]||[]).find(x=>x.id===id); if(!item)return; updateLayeredEntry(activeTab,id,{pinned:item.pinned===false}); renderList(); };
  const doMove = (id, dir) => { const data=loadLayered(); const list=data[activeTab]||[]; const i=list.findIndex(x=>x.id===id); if(i<0)return; const j=i+dir; if(j<0||j>=list.length)return; [list[i],list[j]]=[list[j],list[i]]; saveLayered(data); renderList(); };

  // Timeline editor
  const startTimelineEdit = (id) => {
    const tl=loadTimeline(); const e=tl.find(x=>x.id===id); if(!e) return;
    editingId = id;
    $('mpa_tl_date').value=e.dateLabel||''; $('mpa_tl_summary').value=e.summary||''; $('mpa_tl_imp').value=e.importance||'normal';
    $('mpa_tl_editor').style.display=''; $('mpa_editor').style.display='none';
    $('mpa_tl_title').textContent='编辑时间线'; $('mpa_tl_save').textContent='保存';
  };
  const startTimelineAdd = () => {
    editingId=null;
    $('mpa_tl_date').value=''; $('mpa_tl_summary').value=''; $('mpa_tl_imp').value='normal';
    $('mpa_tl_editor').style.display=''; $('mpa_editor').style.display='none';
    $('mpa_tl_title').textContent='添加时间线'; $('mpa_tl_save').textContent='添加';
  };
  const doTimelineSave = () => {
    const dateLabel=($('mpa_tl_date').value||'').trim(), summary=($('mpa_tl_summary').value||'').trim(), importance=$('mpa_tl_imp').value||'normal';
    if(!summary){toastr?.warning?.('请输入内容');return;}
    if(editingId){updateTimelineEntry(editingId,{dateLabel,summary,importance});toastr?.success?.('已保存');}
    else{addTimelineEntry({dateLabel,summary,importance});toastr?.success?.('已添加');}
    editingId=null;$('mpa_tl_editor').style.display='none';renderList();renderStats();
  };

  const switchTab = (tab) => {
    activeTab = tab;
    $(PANEL_ID).querySelectorAll('.mpa-tab').forEach(t=>t.classList.toggle('on',t.getAttribute('data-t')===tab));
    $('mpa_editor').style.display='none'; $('mpa_tl_editor').style.display='none';
    // Show/hide sections
    const isAnchor = LAYER_KEYS.includes(tab);
    $('mpa_toolbar_anchor').style.display = isAnchor ? '' : 'none';
    $('mpa_toolbar_tl').style.display = tab==='timeline' ? '' : 'none';
    $('mpa_toolbar_todos').style.display = tab==='todos' ? '' : 'none';
    $('mpa_recall_section').style.display = tab==='recall' ? '' : 'none';
    $('mpa_list').style.display = tab==='recall' ? 'none' : '';
    $('mpa_ai_section').style.display = (tab==='recall' || tab==='todos') ? 'none' : '';
    renderList(); renderStats();
  };

  // ====== AI Extraction ======
  const parseFloors = (input, len) => { const r=new Set(); for(const p of input.split(/[,，]/)){const t=p.trim();if(!t)continue;const rm=t.match(/^(\d+)\s*[-~～到]\s*(\d+)$/);if(rm){for(let i=Math.max(0,+rm[1]-1);i<=Math.min(+rm[2]-1,len-1);i++)r.add(i);}else if(/^最近(\d+)$/.test(t)){const n=+t.match(/最近(\d+)/)[1];for(let i=Math.max(0,len-n);i<len;i++)r.add(i);}else if(/^\d+$/.test(t)){const i=+t-1;if(i>=0&&i<len)r.add(i);}} return[...r].sort((a,b)=>a-b); };

  const processExtractResults = (items) => {
    const anchors = items.filter(o => o.type === 'anchor' && o.layer && LAYER_DEFS[o.layer] && o.label && o.content);
    const tlItems = items.filter(o => o.type === 'timeline' && o.summary);
    return { anchors, timeline: tlItems };
  };

  const doExtract = async (mode) => {
    const btn = mode==='chat' ? $('mpa_ai_chat') : $('mpa_ai_mem');
    btn.disabled=true; btn.textContent='提取中…';
    $('mpa_ai_result').innerHTML = '<div style="color:#fbbf24;font-size:12px">🔄 AI 提取中…</div>';
    _abort = new AbortController();
    let prompt = '';
    if (mode === 'chat') {
      const input = $('mpa_ai_floors').value.trim(); if(!input){toastr?.warning?.('请输入楼层范围');btn.disabled=false;btn.textContent='从对话提取';return;}
      const indices = parseFloors(input, chat.length); if(!indices.length){toastr?.warning?.('未选中有效楼层');btn.disabled=false;btn.textContent='从对话提取';return;}
      const uL=ctx.name1||'用户',cL=ctx.name2||'角色';
      const text = indices.map(i=>{const m=chat[i];if(!m)return'';const b=applyCleaner(m.mes||'');if(!b.trim())return'';return'#'+(i+1)+'['+(m.is_user?uL:(m.name||cL))+']'+b;}).filter(Boolean).join('\n');
      const tmpl = window.MemoryPilot?.getCustomPrompt?.('layeredExtract') || EXTRACT_LAYERED_PROMPT;
      prompt = tmpl.replace('{{content}}', text);
    } else {
      const store = _getStore(); const mems = store?.mp_memories || store?.memories || [];
      if(!mems.length){toastr?.warning?.('当前没有记忆列表');btn.disabled=false;btn.textContent='从记忆提取';return;}
      const memText = mems.map((m,i)=>'记忆'+(i+1)+'：\n事件名：'+(m.event||'')+'\n摘要：'+(m.summary||'')+'\n时间：'+(m.timeLabel||'')+'\n楼层：'+(Array.isArray(m.floorRange)?'#'+m.floorRange[0]+'-'+m.floorRange[1]:'未知')+'\n人物：'+(m.entityKeywords||[]).join(', ')).join('\n\n');
      const tmpl = window.MemoryPilot?.getCustomPrompt?.('layeredExtractFromMem') || EXTRACT_FROM_MEMORIES_PROMPT;
      prompt = tmpl.replace('{{content}}', memText);
    }
    try {
      const result = await callLLM(prompt, _abort.signal);
      const parsed = extractJson(result);
      const { anchors, timeline } = processExtractResults(parsed);
      if(!anchors.length && !timeline.length){$('mpa_ai_result').innerHTML='<div style="color:#f87171;font-size:12px">未提取到有效内容</div>';return;}
      renderExtractResults(anchors, timeline);
    } catch(e) {
      $('mpa_ai_result').innerHTML = e?.name==='AbortError' ? '<div style="color:#888">已中止</div>' : '<div style="color:#f87171;font-size:12px">失败: '+h(e?.message||String(e))+'</div>';
    } finally { _abort=null; btn.disabled=false; btn.textContent=mode==='chat'?'从对话提取':'从记忆提取'; }
  };

  const renderExtractResults = (anchors, tlItems) => {
    const c = $('mpa_ai_result');
    let html = '<div style="color:#4ade80;font-size:12px;margin-bottom:8px">✅ 提取到 '+anchors.length+' 条锚点 + '+tlItems.length+' 条时间线</div>';
    // Anchors
    html += anchors.map((item,i)=>{const def=LAYER_DEFS[item.layer];return`<div class="mpa-ext-item"><div class="mpa-ext-hd"><span style="color:${def.color}">${def.icon} ${def.label}</span> <b>${h(item.label)}</b>${item.dateLabel?' <span class="mpa-date">'+h(item.dateLabel)+'</span>':''}</div><div class="mpa-ext-bd">${h(item.content)}</div><button class="ab ap" data-ai="${i}">添加</button></div>`;}).join('');
    // Timeline
    html += tlItems.map((e,i)=>`<div class="mpa-ext-item" style="border-left:3px solid #fbbf24"><div class="mpa-ext-hd">📅 <b>${h(e.dateLabel||'?')}</b> <span style="font-size:10px;color:#888">[${e.importance||'normal'}]</span></div><div class="mpa-ext-bd">${h(e.summary)}</div><button class="ab ap" data-ti="${i}">添加</button></div>`).join('');
    html += '<div style="margin-top:8px"><button class="ab ap" id="mpa_add_all_ext">全部添加（'+(anchors.length+tlItems.length)+' 条）</button></div>';
    c.innerHTML = html;
    window._mpaEA = anchors; window._mpaET = tlItems;
    c.querySelectorAll('[data-ai]').forEach(el=>{el.onclick=()=>{const idx=+el.getAttribute('data-ai');const it=anchors[idx];if(!it)return;addLayeredEntry(it.layer,{label:it.label,content:it.content,tags:it.tags||[],dateLabel:it.dateLabel||''});el.textContent='✅';el.disabled=true;renderStats();}});
    c.querySelectorAll('[data-ti]').forEach(el=>{el.onclick=()=>{const idx=+el.getAttribute('data-ti');const it=tlItems[idx];if(!it)return;addTimelineEntry({dateLabel:it.dateLabel||'',summary:it.summary,importance:it.importance||'normal'});el.textContent='✅';el.disabled=true;renderStats();}});
    $('mpa_add_all_ext')?.addEventListener('click',()=>{
      let n=0;
      for(const a of anchors){addLayeredEntry(a.layer,{label:a.label,content:a.content,tags:a.tags||[],dateLabel:a.dateLabel||''});n++;}
      for(const t of tlItems){addTimelineEntry({dateLabel:t.dateLabel||'',summary:t.summary,importance:t.importance||'normal'});n++;}
      toastr?.success?.('已添加 '+n+' 条');renderStats();c.innerHTML='<div style="color:#4ade80">✅ 全部已添加</div>';
    });
  };

  // ====== AI Recall Agent ======
  // ====== Embedding Vector Management ======
  const doBuildVectors = async () => {
    const btn=$('mpa_vec_build'); btn.disabled=true; btn.textContent='构建中…';
    const resEl=$('mpa_vec_status');
    resEl.innerHTML='<div style="color:#fbbf24">🔄 正在为锚点生成 Embedding 向量…</div>';
    try {
      const apiCfg = getEmbeddingConfig();
      const result = await buildMissingVectors(apiCfg);
      const vecCount = Object.keys(loadVectors()).length;
      resEl.innerHTML = '<div style="color:#4ade80;font-size:11px">✅ 新建 '+result.built+' 条向量（总计 '+vecCount+' 条）' + (result.errors.length ? '<br><span style="color:#f87171">错误: '+h(result.errors.join('; '))+'</span>' : '') + '</div>';
      $('mpa_vec_count').textContent = vecCount;
    } catch(e) {
      resEl.innerHTML = '<div style="color:#f87171;font-size:11px">失败: '+h(e?.message||String(e))+'</div>';
    } finally { btn.disabled=false; btn.textContent='构建/更新向量'; }
  };

  const doRecall = async () => {
    const btn=$('mpa_recall_btn'); btn.disabled=true; btn.textContent='召回中…';
    const resEl=$('mpa_recall_result');
    _abort = new AbortController();

    const vectors = loadVectors();
    const hasVectors = Object.keys(vectors).length > 0;
    const recent = chat.slice(-8).map(m=>{const sp=m.is_user?(ctx.name1||'用户'):(m.name||ctx.name2||'角色');return'['+sp+'] '+applyCleaner(m.mes||'').slice(0,300);}).filter(Boolean).join('\n');
    const queryText = chat.slice(-3).map(m=>applyCleaner(m?.mes||'').slice(0,200)).filter(Boolean).join(' ');

    let candidateText = '';
    let method = '';

    if (hasVectors) {
      // Method A: Embedding 语义检索 → Top-N candidates
      resEl.innerHTML='<div style="color:#fbbf24">🔄 Embedding 语义检索中…</div>';
      try {
        const apiCfg = getEmbeddingConfig();
        const topN = parseInt($('mpa_recall_topn')?.value) || 8;
        const candidates = await semanticRecall(queryText, apiCfg, topN);
        if (candidates.length) {
          candidateText = candidates.map(c => `[${c.label}]${c.dateLabel?'('+c.dateLabel+')':''} ${c.content} (相似度:${(c.score*100).toFixed(1)}%)`).join('\n');
          method = 'Embedding 语义检索 → ' + candidates.length + ' 条候选';
        }
      } catch(e) {
        resEl.innerHTML += '<div style="color:#f87171;font-size:11px">Embedding 检索失败: '+h(e?.message)+' → 降级为全量读取</div>';
      }
    }

    if (!candidateText) {
      // Method B: 无向量 → 全量送入 AI 代理（fallback）
      method = '全量记忆读取（无 Embedding 向量）';
      candidateText = buildRecallAgentContext();
    }

    if (!candidateText.trim()) {
      resEl.innerHTML='<div style="color:#888">没有可供召回的记忆数据</div>';
      btn.disabled=false; btn.textContent='AI 智能召回'; return;
    }

    // Step 2: AI recall agent writes narrative
    resEl.innerHTML='<div style="color:#fbbf24">🔄 '+method+'<br>AI 正在生成回忆叙事…</div>';
    const tmpl = window.MemoryPilot?.getCustomPrompt?.('aiRecall') || AI_RECALL_PROMPT;
    const prompt = tmpl.replace('{{memory_context}}', candidateText).replace('{{recent_messages}}', recent);
    try {
      const result = await callLLM(prompt, _abort.signal);
      const narrative = (result||'').trim();
      if(narrative && narrative !== '无相关回忆') {
        injectRecallNarrative(narrative);
        resEl.innerHTML = '<div style="color:#4ade80;font-size:12px;margin-bottom:6px">✅ 回忆叙事已注入 <code>{{getvar::mp_recall_narrative}}</code></div><div style="font-size:10px;color:#888;margin-bottom:4px">方式: '+h(method)+'</div><div style="padding:10px;border:1px solid rgba(124,107,240,0.2);border-radius:8px;background:rgba(124,107,240,0.04);font-size:12px;color:#b0b8c8;line-height:1.6">'+h(narrative).replace(/\n/g,'<br>')+'</div>';
      } else {
        injectRecallNarrative('');
        resEl.innerHTML = '<div style="color:#888;font-size:12px">无相关回忆</div><div style="font-size:10px;color:#666">方式: '+h(method)+'</div>';
      }
    } catch(e) {
      resEl.innerHTML = e?.name==='AbortError'?'<div style="color:#888">已中止</div>':'<div style="color:#f87171;font-size:12px">失败: '+h(e?.message||String(e))+'</div>';
    } finally { _abort=null; btn.disabled=false; btn.textContent='AI 智能召回'; }
  };

  // ====== Import / Export ======
  const doExport = () => { const d={anchors:loadLayered(),timeline:loadTimeline()}; const b=new Blob([JSON.stringify(d,null,2)],{type:'application/json'}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download='mp_layered_'+Date.now()+'.json'; a.click(); URL.revokeObjectURL(u); };
  const doImport = () => { const inp=document.createElement('input'); inp.type='file'; inp.accept='.json'; inp.onchange=async()=>{ const f=inp.files[0]; if(!f)return; try{ const t=await f.text(); const d=JSON.parse(t); let n=0; if(d.anchors){const ex=loadLayered();for(const k of LAYER_KEYS){if(Array.isArray(d.anchors[k])){ex[k]=[...(ex[k]||[]),...d.anchors[k]];n+=d.anchors[k].length;}}saveLayered(ex);} if(Array.isArray(d.timeline)){const tl=loadTimeline();for(const e of d.timeline){tl.push(e);n++;}saveTimeline(tl);} if(!n&&d.identity){const ex=loadLayered();for(const k of LAYER_KEYS){if(Array.isArray(d[k])){ex[k]=[...(ex[k]||[]),...d[k]];n+=d[k].length;}}saveLayered(ex);} renderList();renderStats();toastr?.success?.('已导入 '+n+' 条'); }catch(e){toastr?.error?.('导入失败: '+(e?.message||e));} }; inp.click(); };

  // ====== Style ======
  const style = document.createElement('style'); style.id = STYLE_ID;
  style.textContent = `
    #${PANEL_ID}{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center}
    #${PANEL_ID} .mpa-mask{position:absolute;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px)}
    #${PANEL_ID} .mpa-card{position:relative;z-index:1;width:min(94vw,760px);max-height:90dvh;display:flex;flex-direction:column;background:#1a1b2e;border:1px solid rgba(255,255,255,0.1);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,0.5);overflow:hidden}
    #${PANEL_ID} .mpa-hd{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0}
    #${PANEL_ID} .mpa-hd h3{margin:0;font-size:15px;color:#e2e8f0;font-weight:600}
    #${PANEL_ID} .mpa-cls{background:none;border:none;color:#999;font-size:22px;cursor:pointer;padding:0 4px}
    #${PANEL_ID} .mpa-cls:hover{color:#fff}
    #${PANEL_ID} .mpa-tabs{display:flex;gap:0;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,0.06);overflow-x:auto}
    #${PANEL_ID} .mpa-tab{flex:1;padding:9px 6px;border:none;background:transparent;color:#888;cursor:pointer;font-size:11px;text-align:center;border-bottom:2px solid transparent;white-space:nowrap;min-width:0}
    #${PANEL_ID} .mpa-tab:hover{background:rgba(255,255,255,0.03);color:#ccc}
    #${PANEL_ID} .mpa-tab.on{color:#e2e8f0;border-bottom-color:var(--tc,#7c6bf0);background:rgba(255,255,255,0.03)}
    #${PANEL_ID} .mpa-tab .tc{font-size:10px;opacity:0.5;margin-left:2px}
    #${PANEL_ID} .mpa-bd{flex:1;overflow-y:auto;padding:12px 14px;overscroll-behavior:contain}
    #${PANEL_ID} .mpa-tb{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
    .ab{padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#ccc;cursor:pointer;font-size:11px;white-space:nowrap}
    .ab:hover{background:rgba(255,255,255,0.08);color:#fff} .ab:disabled{opacity:0.4;cursor:not-allowed}
    .ap{background:rgba(124,107,240,0.15);border-color:rgba(124,107,240,0.3);color:#a78bfa} .ap:hover{background:rgba(124,107,240,0.25)}
    .ad{color:#f87171} .ad:hover{background:rgba(248,113,113,0.1)}
    .mpa-item{padding:10px 12px;border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:7px;background:rgba(255,255,255,0.02)}
    .mpa-item:hover{border-color:rgba(255,255,255,0.12)} .mpa-item.mpa-unpinned{opacity:0.5;border-style:dashed}
    .mpa-item-hd{display:flex;align-items:center;gap:5px;margin-bottom:3px;flex-wrap:wrap}
    .mpa-icon{font-size:14px} .mpa-lbl{font-weight:600;color:#e2e8f0;font-size:12px}
    .mpa-date{font-size:10px;color:#fbbf24;background:rgba(251,191,36,0.1);padding:1px 5px;border-radius:3px}
    .mpa-pin{cursor:pointer;font-size:11px;margin-left:auto;opacity:0.6} .mpa-pin:hover{opacity:1} .mpa-pin.off{opacity:0.25;filter:grayscale(1)}
    .mpa-ct{font-size:11px;color:#b0b8c8;line-height:1.6;margin-bottom:3px}
    .mpa-tags{display:flex;flex-wrap:wrap;gap:3px} .mpa-tag{font-size:10px;padding:1px 5px;border-radius:3px;background:rgba(124,107,240,0.1);color:#a78bfa}
    .mpa-acts{display:flex;gap:3px;margin-top:5px}
    .mpa-empty{text-align:center;padding:30px 20px;color:#666;font-size:13px;line-height:1.8}
    #${PANEL_ID} .mpa-ed{display:none;padding:10px;border:1px solid rgba(124,107,240,0.2);border-radius:8px;background:rgba(124,107,240,0.04);margin-bottom:10px}
    #${PANEL_ID} .mpa-ed .fg{margin-bottom:6px} #${PANEL_ID} .mpa-ed label{font-size:11px;color:#aaa;display:block;margin-bottom:2px}
    #${PANEL_ID} .mpa-ed input,#${PANEL_ID} .mpa-ed textarea,#${PANEL_ID} .mpa-ed select{width:100%;padding:6px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:12px;resize:vertical;box-sizing:border-box}
    #${PANEL_ID} .mpa-ed textarea{min-height:70px}
    #${PANEL_ID} .mpa-ai{padding:10px;border:1px solid rgba(251,191,36,0.15);border-radius:8px;background:rgba(251,191,36,0.03);margin-bottom:10px}
    #${PANEL_ID} .mpa-ai summary{cursor:pointer;font-size:12px;color:#fbbf24;font-weight:500}
    .mpa-ext-item{padding:7px 9px;border:1px solid rgba(255,255,255,0.06);border-radius:5px;margin-bottom:5px;background:rgba(0,0,0,0.12)}
    .mpa-ext-hd{display:flex;align-items:center;gap:5px;margin-bottom:3px;font-size:11px;flex-wrap:wrap} .mpa-ext-bd{font-size:11px;color:#b0b8c8;line-height:1.5;margin-bottom:4px}
    #${PANEL_ID} .mpa-recall{padding:12px;border:1px solid rgba(124,107,240,0.15);border-radius:8px;background:rgba(124,107,240,0.03)}
    @media(max-width:600px){#${PANEL_ID} .mpa-card{width:100%;max-height:100dvh;border-radius:0} #${PANEL_ID} .mpa-tab{padding:7px 4px;font-size:10px}}
  `;
  document.head.appendChild(style);

  // ====== DOM ======
  const stats = getLayeredStats();
  const root = document.createElement('div'); root.id = PANEL_ID;
  root.innerHTML = `<div class="mpa-mask"></div><div class="mpa-card">
    <div class="mpa-hd"><h3>⚓ 分层记忆 v4.0 <span style="font-size:12px;color:#888;margin-left:6px" id="mpa_total">${stats.total}</span></h3><button class="mpa-cls" id="mpa_cls">&times;</button></div>
    <div class="mpa-tabs">
      ${LAYER_KEYS.map(k=>{const d=LAYER_DEFS[k];return`<button class="mpa-tab ${k===activeTab?'on':''}" data-t="${k}" style="--tc:${d.color}">${d.icon} ${d.label} <span class="tc" id="mpa_c_${k}">${stats[k]}</span></button>`;}).join('')}
      <button class="mpa-tab ${activeTab==='timeline'?'on':''}" data-t="timeline" style="--tc:#f472b6">📅 时间线 <span class="tc" id="mpa_c_timeline">${stats.timeline}</span></button>
      <button class="mpa-tab ${activeTab==='todos'?'on':''}" data-t="todos" style="--tc:#fb923c">📋 待办 <span class="tc" id="mpa_c_todos">${stats.todos}</span></button>
      <button class="mpa-tab ${activeTab==='recall'?'on':''}" data-t="recall" style="--tc:#818cf8">🧠 AI召回</button>
    </div>
    <div class="mpa-bd">
      <div class="mpa-tb" id="mpa_toolbar_anchor"><button class="ab ap" id="mpa_add_btn">＋ 手动添加</button><button class="ab" id="mpa_export">导出</button><button class="ab" id="mpa_import">导入</button><button class="ab" id="mpa_preview_btn">预览注入</button></div>
      <div class="mpa-tb" id="mpa_toolbar_tl" style="display:none"><button class="ab ap" id="mpa_tl_add_btn">＋ 添加时间点</button><button class="ab" id="mpa_export2">导出</button><button class="ab" id="mpa_import2">导入</button></div>
      <div class="mpa-tb" id="mpa_toolbar_todos" style="display:none"><button class="ab ap" id="mpa_todo_add_btn">＋ 添加待办</button></div>

      <div class="mpa-ed" id="mpa_editor">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;color:#e2e8f0;font-weight:600" id="mpa_ed_title">添加锚点</span><button class="ab" id="mpa_ed_cancel">取消</button></div>
        <div class="fg"><label>层级</label><select id="mpa_ed_layer">${LAYER_KEYS.map(k=>'<option value="'+k+'">'+LAYER_DEFS[k].icon+' '+LAYER_DEFS[k].label+'</option>').join('')}</select></div>
        <div class="fg"><label>标签名</label><input id="mpa_ed_label" placeholder="人物名/场景名/事件名"></div>
        <div class="fg"><label>内容</label><textarea id="mpa_ed_content" placeholder="详细描述…"></textarea></div>
        <div class="fg"><label>时间标签</label><input id="mpa_ed_date" placeholder="故事内时间，如 D3、UC0087/07/10"></div>
        <div class="fg"><label>标签（逗号分隔）</label><input id="mpa_ed_tags" placeholder="关键词1, 关键词2"></div>
        <button class="ab ap" id="mpa_ed_save" style="width:100%;padding:7px">添加</button>
      </div>
      <div class="mpa-ed" id="mpa_tl_editor">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;color:#e2e8f0;font-weight:600" id="mpa_tl_title">添加时间线</span><button class="ab" id="mpa_tl_cancel">取消</button></div>
        <div class="fg"><label>日期标签</label><input id="mpa_tl_date" placeholder="D1, D5, UC0087/07/10…"></div>
        <div class="fg"><label>当天概括</label><textarea id="mpa_tl_summary" placeholder="一句话描述当天发生的核心事件" style="min-height:50px"></textarea></div>
        <div class="fg"><label>重要程度</label><select id="mpa_tl_imp"><option value="normal">· 普通</option><option value="key">● 关键</option><option value="turning">★ 转折</option></select></div>
        <button class="ab ap" id="mpa_tl_save" style="width:100%;padding:7px">添加</button>
      </div>
      <div class="mpa-ed" id="mpa_todo_editor">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:12px;color:#e2e8f0;font-weight:600" id="mpa_todo_ed_title">添加待办</span><button class="ab" id="mpa_todo_cancel">取消</button></div>
        <div class="fg"><label>待办内容（约定/承诺/计划）</label><textarea id="mpa_todo_ed_content" placeholder="明天下午3点在咖啡馆见面" style="min-height:50px"></textarea></div>
        <div class="fg"><label>应发生时间（可空）</label><input id="mpa_todo_ed_date" placeholder="D7下午3点、下周一、比赛当天…"></div>
        <button class="ab ap" id="mpa_todo_save" style="width:100%;padding:7px">添加</button>
      </div>

      <details class="mpa-ai" id="mpa_ai_section">
        <summary>🤖 AI 提取锚点 + 时间线（共用 MP API）</summary>
        <div style="margin-top:8px">
          <div style="display:flex;gap:5px;margin-bottom:6px"><input id="mpa_ai_floors" placeholder="最近50 或 1-100" value="最近50" style="flex:1;padding:5px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:12px"><button class="ab ap" id="mpa_ai_chat">从对话提取</button></div>
          <button class="ab" id="mpa_ai_mem" style="width:100%;margin-bottom:6px">从记忆列表提取（已有记忆→锚点+时间线）</button>
          <div style="font-size:10px;color:#777;margin-bottom:6px">适合已有大量记忆列表的用户</div>
          <div id="mpa_ai_result"></div>
        </div>
      </details>

      <div id="mpa_recall_section" class="mpa-recall" style="display:none">
        <div style="font-size:13px;color:#e2e8f0;font-weight:600;margin-bottom:8px">🧠 AI 智能召回（Embedding 语义检索）</div>
        <div style="font-size:11px;color:#888;line-height:1.5;margin-bottom:10px">
          <b>工作流程：</b>当前对话 → Embedding 向量化 → 余弦相似度匹配 → Top-N 候选 → AI 代理写回忆叙事<br>
          参考 MMPEA 的三级检索设计。需要 API 支持 <code>/v1/embeddings</code> 接口。<br>
          如果没有向量数据，会降级为全量记忆读取。
        </div>
        <div style="padding:10px;border:1px solid rgba(124,107,240,0.12);border-radius:8px;background:rgba(124,107,240,0.03);margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-size:12px;color:#a78bfa;font-weight:500">📊 Embedding 向量</span>
            <span style="font-size:11px;color:#888">已构建: <b id="mpa_vec_count">${Object.keys(loadVectors()).length}</b> 条</span>
          </div>
          <div style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap">
            <button class="ab ap" id="mpa_vec_build">构建/更新向量</button>
            <input id="mpa_embed_model" placeholder="Embedding模型名 (默认 text-embedding-3-small)" value="${h(getEmbeddingConfig().embeddingModel||'')}" style="flex:1;min-width:120px;padding:5px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:11px">
          </div>
          <div style="font-size:10px;color:#666">使用 MP API 配置的地址和密钥，调用 /v1/embeddings 接口。支持 OpenAI 兼容的 Embedding API。</div>
          <div id="mpa_vec_status" style="margin-top:4px"></div>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">
          <button class="ab ap" id="mpa_recall_btn" style="flex:1;padding:8px;font-size:13px">AI 智能召回</button>
          <label style="font-size:11px;color:#888;white-space:nowrap">Top-N:</label>
          <input id="mpa_recall_topn" type="number" min="3" max="20" value="8" style="width:50px;padding:5px;border-radius:5px;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);color:#eee;font-size:11px">
        </div>
        <div id="mpa_recall_result"></div>
        <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.06)">
          <div style="font-size:11px;color:#666">上次召回结果：</div>
          <div style="font-size:11px;color:#b0b8c8;margin-top:4px" id="mpa_last_recall">${h(localStorage.getItem('mp_recall_narrative')||'（无）')}</div>
        </div>
      </div>

      <div id="mpa_list"></div>

      <div id="mpa_preview" style="display:none;padding:10px;border:1px solid rgba(52,211,153,0.2);border-radius:8px;background:rgba(52,211,153,0.04);margin-top:10px;max-height:200px;overflow-y:auto">
        <div style="font-size:11px;color:#34d399;margin-bottom:4px">📝 注入预览</div>
        <pre id="mpa_preview_text" style="font-size:11px;color:#b0b8c8;white-space:pre-wrap;word-break:break-all;margin:0;line-height:1.5"></pre>
      </div>
    </div>
  </div>`;
  document.body.appendChild(root);

  // ====== Events ======
  $('mpa_cls').onclick = () => { $(PANEL_ID).remove(); $(STYLE_ID)?.remove(); };
  root.querySelector('.mpa-mask').onclick = () => { $(PANEL_ID).remove(); $(STYLE_ID)?.remove(); };
  root.querySelectorAll('.mpa-tab').forEach(t => { t.onclick = () => switchTab(t.getAttribute('data-t')); });
  $('mpa_add_btn').onclick = startAdd;
  $('mpa_tl_add_btn').onclick = startTimelineAdd;
  $('mpa_ed_cancel').onclick = () => { $('mpa_editor').style.display='none'; };
  $('mpa_tl_cancel').onclick = () => { $('mpa_tl_editor').style.display='none'; };
  $('mpa_ed_save').onclick = doSave;
  $('mpa_tl_save').onclick = doTimelineSave;
  $('mpa_todo_add_btn').onclick = startTodoAdd;
  $('mpa_todo_cancel').onclick = () => { $('mpa_todo_editor').style.display='none'; };
  $('mpa_todo_save').onclick = doTodoSave;
  $('mpa_ai_chat').onclick = () => doExtract('chat');
  $('mpa_ai_mem').onclick = () => doExtract('mem');
  $('mpa_recall_btn').onclick = doRecall;
  $('mpa_vec_build').onclick = async () => {
    // Save embedding model name if user changed it
    const modelName = ($('mpa_embed_model')?.value || '').trim();
    if (modelName) {
      const store = _getStore();
      if (store) {
        const api = store.mp_api_config || {};
        api.embeddingModel = modelName;
        store.mp_api_config = api;
        try { localStorage.setItem(AK, JSON.stringify(api)); } catch {}
      }
    }
    await doBuildVectors();
  };
  $('mpa_export').onclick = doExport; $('mpa_export2').onclick = doExport;
  $('mpa_import').onclick = doImport; $('mpa_import2').onclick = doImport;
  $('mpa_preview_btn').onclick = () => { const el=$('mpa_preview'); if(el.style.display==='none'){el.style.display='';$('mpa_preview_text').textContent=buildLayeredInjection()||'（无数据）';}else el.style.display='none'; };
  renderList();
})();
}
