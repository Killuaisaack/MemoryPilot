# 🧭 MemoryPilot

**SillyTavern 可控记忆管理系统** — 半插件化架构，适配 LWB (LittleWhiteBox) https://github.com/RT15548/LittleWhiteBox。

为角色扮演 / 长期对话场景提供 **可控、可编辑、可解释** 的记忆召回能力。你可以精确管理 AI 在每轮对话中"想起"什么、忽略什么。

---

## 核心功能

### 📋 记忆管理面板

- **查看 / 搜索 / 编辑** 所有记忆条目（事件名、摘要、关键词、时间标签、楼层范围）
- **手动添加** 新记忆，或从 LWB 事件 (XB Events) 导入
- **批量操作**：选中多条记忆进行 AI 关键词重构、事件合并、批量删除
- **三层关键词体系**：primaryKeywords（主触发）、secondaryKeywords（辅助门控）、entityKeywords（实体标记）
- **优先级分级**：high（始终置顶）、medium（默认参与评分）、low（保底召回）
- **导入 / 导出**：JSON 格式，支持覆盖或追加模式

### 🔍 召回引擎

每条用户消息后自动执行，基于当前对话上下文匹配最相关的记忆注入 prompt：

- **关键词精确匹配 + 模糊匹配**：CJK n-gram 分词，适配中文场景
- **评分公式**：`score = (keywordScore × 0.65 + priorityWeight × 0.10 + freshness × 0.15) × secondaryMul`
- **Sticky 机制**：被召回的记忆在后续若干轮保持注入，避免"一闪而过"
- **节奏控制**：每 N 轮执行一次完整评估（`recallEvery`），中间轮沿用上次结果
- **文本清洗**：自动去除 `<think>`、`<details>` 等标签块和自定义行前缀
- **上下文窗口**：只分析最近 N 条消息（`contextWindow`），聚焦当前话题

#### 双版本召回引擎（可切换）

| | v34（推荐） | v32（经典） |
|---|---|---|
| low 优先级 | 分层选择：medium 优先填槽，low 保底至少 1 个槽位 | 跳过 low 优先级 |
| 评分权重 | low=0.15, medium=0.5, default=0.3 | medium=0.5, default=0.2 |

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

| Prompt | 用途 | 变量 |
|--------|------|------|
| 分析 Prompt | AI 分析聊天内容，提取记忆 | `{{context}}` |
| 关键词重构 Prompt | AI 为记忆重构三层关键词 | `{{event}}` `{{summary}}` `{{entities}}` |
| 事件合并 Prompt | AI 合并多条记忆为一条 | `{{memories}}` `{{context}}` |

---

## 安装

### 方法 1：通过 GitHub 安装（推荐）

1. SillyTavern → 扩展面板 → **Install Extension**
2. 输入仓库 URL：`https://github.com/<你的用户名>/MemoryPilot`
3. 安装完成后刷新页面

### 方法 2：手动安装

将此文件夹放入：
```
public/scripts/extensions/third-party/MemoryPilot/
```

### 迁移注意

安装后请 **禁用或删除** 原来 taskjs 中的四个 MP 任务，避免冲突。首次加载会自动迁移旧数据。

---

## 存储架构

### 为什么重新设计

旧版 taskjs 使用 `STscript /setvar` 写入变量层。但 LWB 的快照机制会把变量层中的所有变量按楼层整包拍照存入 `LWB_SNAP`。

**实测数据**（来自一个 953 楼的聊天）：
- `LWB_SNAP` 总大小：**25.6 MB**
- 其中 MP 变量重复拷贝：**25.5 MB（占 99.7%）**
- `mp_memories`（40KB）× 951 个快照 ≈ 20.5 MB
- `mp_recall_ctx`（12KB）× 951 个快照 ≈ 5.0 MB
- LWB 自身数据仅占 **0.07 MB（0.3%）**

换句话说，一个 26MB 的聊天文件里，消息只占 0.03MB，剩下几乎全是 MP 变量被 LWB 反复快照。

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
│       └── customPrompts: {}         ← 自定义 Prompt

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

### 数据读取 fallback

```
localStorage → extensionSettings → chatMetadata（旧版兼容） → 默认值
```

---

## 使用

### 按钮

三个按钮位于聊天输入栏上方（与原 taskjs 位置相同）：
- **🧭 MP 管理面板**
- **🧭 MP API配置**
- **🧭 MP 召回监控**

版本切换在扩展面板 → MemoryPilot → 下拉选择。

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
  "source": "xb_event | manual"
}
```

---

## 许可

MIT License
