# 🧭 MemoryPilot v3.5

**SillyTavern 可控记忆管理系统** — 半插件化架构，适配 LWB (LittleWhiteBox)。

为角色扮演 / 长期对话场景提供 **可控、可编辑、可解释** 的记忆召回能力。你可以精确管理 AI 在每轮对话中"想起"什么、忽略什么。

---

## v3.5 更新内容

### 新功能
- **🔗 事件关联链**：记忆条目之间可设置关联关系（`linkedIds`），当某条记忆被召回时，若召回槽位未满，会连带召回其关联记忆
- **🔄 自动总结**：可在设置面板开启，每 N 条消息（默认20）自动触发分析提取记忆
- **📋 Prompt 多版本管理**：分析 Prompt 支持保存多个版本，可随时切换
- **🔑 激活码验证**：首次使用需输入激活码（一次验证，同浏览器永久有效）

### 改进
- **🔧 关键词重构不再限于 XB 事件**：所有来源的记忆（手动、批量、合并、XB）都支持 AI 关键词重构
- **✏️ 合并预览可编辑**：合并事件后的预览界面支持直接修改事件名、摘要、关键词等字段
- **🔍 XB 事件搜索+跳转**：搜索框输入后可直接跳转到首个匹配的事件
- **📊 记忆列表排序**：新增按事件时间、楼层范围排序（可与现有筛选切换使用）
- **📱 移动端 UI 修复**：修复面板打开后遮挡/顶掉顶部按钮栏的问题
- **🧹 旧数据清理逻辑修复**：修正检测逻辑——不再将轻量指针误判为旧数据，mp_recall_pin/ctx 不再被误报为残留变量

### 从 v3.4 升级
- **兼容性**：v3.5 完全兼容 v3.4 的数据格式，无需手动迁移
- **新字段**：记忆条目新增可选字段 `linkedIds`（关联事件 ID 数组），旧数据无此字段不影响使用
- **激活码**：升级后首次加载需输入激活码

---

## 核心功能

### 📋 记忆管理面板

- **查看 / 搜索 / 编辑** 所有记忆条目（事件名、摘要、关键词、时间标签、楼层范围）
- **手动添加** 新记忆，或从 LWB 事件 (XB Events) 导入
- **批量操作**：选中多条记忆进行 AI 关键词重构、事件合并、批量删除
- **三层关键词体系**：primaryKeywords（主触发）、secondaryKeywords（辅助门控）、entityKeywords（实体标记）
- **优先级分级**：high（始终置顶）、medium（默认参与评分）、low（保底召回）
- **事件关联链**：通过 `linkedIds` 字段设置事件间关联，被召回时连带关联事件（仅填充空余槽位）
- **多维排序**：默认排序 / 按事件时间升降 / 按楼层范围升降
- **导入 / 导出**：JSON 格式，支持覆盖或追加模式

### 🔍 召回引擎

每条用户消息后自动执行，基于当前对话上下文匹配最相关的记忆注入 prompt：

- **关键词精确匹配 + 模糊匹配**：CJK n-gram 分词，适配中文场景
- **评分公式**：`score = (keywordScore × 0.65 + priorityWeight × 0.10 + freshness × 0.15) × secondaryMul`
- **关联链召回**：已触发记忆的 `linkedIds` 关联记忆会在剩余槽位中被连带召回
- **Sticky 机制**：被召回的记忆在后续若干轮保持注入，避免"一闪而过"
- **节奏控制**：每 N 轮执行一次完整评估（`recallEvery`），中间轮沿用上次结果
- **文本清洗**：自动去除 `<think>`、`<details>` 等标签块和自定义行前缀
- **上下文窗口**：只分析最近 N 条消息（`contextWindow`），聚焦当前话题

#### 双版本召回引擎（可切换）

| | v34（推荐） | v32（经典） |
|---|---|---|
| low 优先级 | 分层选择：medium 优先填槽，low 保底至少 1 个槽位 | 跳过 low 优先级 |
| 评分权重 | low=0.15, medium=0.5, default=0.3 | medium=0.5, default=0.2 |

### 🔄 自动总结

- 在扩展面板开启后，每 N 条消息自动触发一次分析
- 默认间隔 20 条，可调整（5~200）
- 结果需在管理面板确认后才会写入记忆库

### 🔧 API 配置面板

- 支持 **OpenAI / Claude / Gemini** 三种 provider
- 可配置 base URL、model、temperature、top_p、max_tokens 等
- 用于 AI 分析（提取记忆）、关键词重构、事件合并等操作
- API 配置独立于 SillyTavern 主 API，不影响对话生成

### 📊 召回监控面板

- **实时预览** 当前轮的召回结果（置顶 + 触发的记忆）
- **对比视图**：预测结果 vs 实际注入内容
- **评分详情**：每条记忆的匹配原因（关键词命中、权重、新鲜度）
- **可编辑**：直接在监控面板中删除或调整记忆

### ✏️ 自定义 Prompt

三种 Prompt 模板均可自定义，编辑后自动保存、跨聊天共享、跨设备同步：

| Prompt | 用途 | 变量 | 多版本 |
|--------|------|------|--------|
| 分析 Prompt | AI 分析聊天内容，提取记忆 | `{{context}}` | ✅ 支持 |
| 关键词重构 Prompt | AI 为记忆重构三层关键词 | `{{event}}` `{{summary}}` `{{entities}}` | 单版本 |
| 事件合并 Prompt | AI 合并多条记忆为一条 | `{{memories}}` `{{context}}` | 单版本 |

---

## 安装

### 方法 1：通过 GitHub 安装（推荐）

1. SillyTavern → 扩展面板 → **Install Extension**
2. 输入仓库 URL：`https://github.com/<你的用户名>/MemoryPilot`
3. 安装完成后刷新页面
4. 首次加载输入激活码

### 方法 2：手动安装

将此文件夹放入：
```
public/scripts/extensions/third-party/MemoryPilot/
```

### 迁移注意

- **从 v3.4 升级**：直接覆盖文件即可，数据完全兼容，无需额外操作
- **从 taskjs 迁移**：安装后请 **禁用或删除** 原来 taskjs 中的四个 MP 任务，避免冲突。首次加载会自动迁移旧数据

### 激活码

v3.5 需要激活码才能使用。验证后同浏览器永久有效。

源码中不包含明文激活码，仅存储 SHA-256 哈希值。如需自定义激活码：

1. 计算你的激活码的 SHA-256：`echo -n "YOUR-CODE" | sha256sum`
2. 将哈希值添加到 `index.js` 中的 `MP_VALID_HASHES`

默认预置了 3 个激活码哈希，请向作者获取激活码。

---

## 存储架构

### 新存储分层

```
extensionSettings (settings.json — 独立于聊天文件，服务端同步)
├── MemoryPilot/
│   ├── <chatKey>/
│   │   ├── mp_memories: [...]        ← 记忆主体
│   │   ├── mp_api_config: {...}      ← API 配置
│   │   ├── mp_kw_blacklist: [...]    ← 关键词黑名单
│   │   ├── stickyState: {...}        ← Sticky 状态
│   │   └── mp_recall_settings: {}    ← 召回设置
│   └── _global/
│       ├── recallVersion: 'v34'      ← 引擎版本
│       ├── customPrompts: {}         ← 自定义 Prompt
│       ├── promptSlots: {}           ← Prompt 多版本
│       ├── autoSummarize: false      ← 自动总结开关
│       └── autoSummarizeEvery: 20    ← 自动总结间隔

chatMetadata.variables (仅供 {{getvar::}} 宏读取)
├── mp_recall_pin: "..."              ← 置顶记忆文本
└── mp_recall_ctx: "..."              ← 召回上下文文本

chatMetadata.extensions (极轻量指针 ~100 bytes)
└── MemoryPilot: { version, chatKey, storeMode }

localStorage (浏览器运行缓存)
└── mp_memories_<chatKey>: "[...]"    ← 快速读取缓存
```

### 对比

| | 旧 taskjs 版 | 本插件版 |
|---|---|---|
| STscript /setvar | 每条消息 4-6 次 | **0 次** |
| LWB_SNAP 快照 | mp_memories 被重复快照 (99.7%) | 不暴露，不被快照 |
| chatMetadata 体积 | 数 MB ~ 数百 MB | ~100 bytes |
| 每条消息 saveChat | 4-6 次 | **0 次** |
| 跨端同步 | ✅ 但文件太大导致 502 | ✅ extensionSettings 独立同步 |
| Prompt 自定义 | 绑定单个聊天 | 全局共享，跨聊天跨设备 |

---

## 使用

### 按钮

三个按钮位于聊天输入栏上方（与原 taskjs 位置相同）：
- **🧭 MP 管理面板**
- **🧭 MP API配置**
- **🧭 MP 召回监控**

版本切换和自动总结开关在扩展面板 → MemoryPilot。

### Prompt 注入

在角色卡或系统 prompt 中使用：
```
{{getvar::mp_recall_pin}}
{{getvar::mp_recall_ctx}}
```

### 记忆数据结构

```json
{
  "id": "uuid",
  "event": "事件名",
  "summary": "详细摘要",
  "priority": "high | medium | low",
  "primaryKeywords": ["主词1", "主词2"],
  "secondaryKeywords": ["辅助词1"],
  "entityKeywords": ["实体1"],
  "floorRange": [100, 120],
  "timeLabel": "下午",
  "linkedIds": ["mp_xxxxxxxx"],
  "source": "xb_event | manual | batch | merged"
}
```

---

## 许可

MIT License
