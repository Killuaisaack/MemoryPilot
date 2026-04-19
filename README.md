# 🧭 MemoryPilot v4.0.0

**SillyTavern 可控记忆管理系统** — 自动总结 + 分层永久记忆 + 时间线 + 待办事项 + NPC 关系网 + AI 智能召回

独立运行，不依赖任何其他插件。可选桥接 LWB (LittleWhiteBox) XB 事件导入。

---

## 概述

自动总结每 N 条消息 → 一次 API 调用同时产出：关键词召回记忆 + 人物/场景/动态锚点 + 时间线 + 待办事项。锚点和时间线永久注入，待办事项常驻到完成，NPC 和场景信息只在被提到时才注入。

---

## 系统架构

```
一次自动总结 API 调用 →
  ├── A类：关键词召回记忆（event/summary/primaryKeywords/...）
  │         → 存入记忆列表 → 关键词匹配触发召回
  │
  └── B类：分层数据（自动写入，无需确认）
            ├── 人物锚点（identity）  → 提到时注入
            ├── 场景锚点（scene）     → 提到时注入
            ├── 动态锚点（dynamics）  → 每轮注入
            ├── 时间线（timeline）    → 每轮注入
            └── 待办事项（todo）      → 每轮注入，完成后删除
```

### 注入逻辑

| 数据类型 | 注入时机 | 注入变量 |
|---|---|---|
| 时间线 | 每轮（常驻） | `mp_layered_ctx` |
| 待办事项 | 每轮（常驻，完成后消失） | `mp_layered_ctx` |
| 动态锚点 | 每轮（关系变化始终相关） | `mp_layered_ctx` |
| 人物锚点 | **条件注入**：最近对话提到该 NPC 名字或别名时 | `mp_layered_ctx` |
| 场景锚点 | **条件注入**：最近对话提到该场景名或标签时 | `mp_layered_ctx` |
| 置顶记忆 | 每轮 | `mp_recall_pin` |
| 关键词召回 | 匹配时 | `mp_recall_ctx` |
| AI 回忆叙事 | 手动触发 | `mp_recall_narrative` |

---

## 核心功能

### 📋 待办事项（v4 新增）

解决"总结+隐藏楼层后，AI 忘记之前的约定"问题。

- 角色说"明天下午3点咖啡馆见" → 自动总结时 AI 提取为待办 → 常驻注入直到你标记完成
- 在 ⚓ 面板 → 📋 待办 Tab 管理：添加/编辑/完成/删除
- 注入格式：`<待办事项与约定> · 明天下午3点在咖啡馆见面（D7下午3点）</待办事项与约定>`

### 👤 NPC 条件注入（v4 新增）

不是所有 NPC 信息都常驻注入（浪费 token），而是**提到谁就注入谁**。

- 对话里出现"夏亚" → 注入夏亚的人物锚点
- 对话里没提到夏亚 → 不注入，省 token
- 场景锚点同理：提到"D-12舱室"才注入舱室细节
- 匹配方式：NPC 名字 + 别名（`aliases`）+ 场景标签（`tags`）

### 👥 NPC 角色分级 + 别名

```json
"entityRole": {"阿尔忒弥斯": "major", "夏亚": "minor", "酒馆老板": "npc"}
"entityAliases": {"阿尔忒弥斯": ["月神", "Artemis", "队长"]}
```

- **minor NPC** 名字被匹配时，记忆获得 +0.05 评分加成（稀有 = 高价值信号）
- **major 角色** 名不加权（到处出现，信号量为零）
- 别名自动展开：对话提到"月神" → 引擎知道是阿尔忒弥斯 → 触发关联记忆

### 🔄 召回频率奖励（v4 新增）

反复被召回的记忆获得 α 衰减抵消，"越用越强"：

```
frequencyReward = min(0.3, log2(1 + recallCount) × 0.08)
effectiveAlpha = distanceAlpha - frequencyReward
```

召回 3 次 → α 减 0.16 | 召回 7 次 → α 减 0.24 | 上限 0.30

### 📅 时间线

故事大纲，按天排列，三级标记：`★ 转折` / `● 关键` / `· 普通`

### 🧠 AI 智能召回（可选）

Embedding 语义检索 → AI 代理写回忆叙事。需要 `/v1/embeddings` API。纯可选，不影响核心功能。

---

## Prompt 注入配置

```
## 故事记忆锚点
{{getvar::mp_layered_ctx}}
以上包含时间线、待办事项、相关人物/场景/事件锚点。回复时保持一致。

## 持续生效的核心记忆
{{getvar::mp_recall_pin}}
这些内容属于长期稳定记忆，回复时应始终保持一致。

## 当前话题触发的相关记忆
{{getvar::mp_recall_ctx}}
这些内容只在与当前话题相关时自然参考，不要逐条复述。

## 回忆叙事（可选）
{{getvar::mp_recall_narrative}}
以上为根据当前话题联想到的相关回忆，自然融入回复。
```

---

## 从 v3.5.0 升级

- ✅ 完全向后兼容，零迁移
- ✅ 新字段（`entityRole`, `entityAliases`, `_recallCount`）安全默认
- ✅ 新存储键（`layeredMemory`, `timeline`, `todos`, `embeddingVectors`）增量添加
- ✅ 已自定义分析 Prompt 的用户：旧 prompt 继续工作，不产出 B 类数据
- ✅ 使用默认 Prompt 的用户：自动获得锚点+时间线+待办提取

### 与 LWB 的关系

v4.0 的记忆系统**完全自给自足**。自动总结独立产出所有数据，不依赖 LWB 的 XB 事件。

XB 事件 Tab 保留作为**可选桥接**——你可以从 LWB 的 storySummary 导入事件到 MP 记忆列表。但这不是必需的。

---

## 文件结构

```
index.js                    入口 + 自动总结（含 B 类解析）
src/
  layered-memory.js         分层记忆 + 时间线 + 待办 + Embedding + AI召回
  anchor-panel.js           ⚓ 分层记忆面板（锚点/时间线/待办/AI召回）
  recall-v34.js             召回引擎（NPC加权 + 频率奖励 + 别名展开）
  recall-v32.js             召回引擎 v32（经典，未修改）
  panel.js                  管理面板（记忆列表/XB/分析/过滤）
  api-config.js             API 配置（未修改）
  monitor.js                召回监控（未修改）
  storage.js                存储层（未修改）
```

---

## 致谢

- [MMPEA](https://github.com/chenc4892-code/memory-manager) — Embedding 检索 + AI 记忆代理 + 时间线
- [Horae](https://github.com/SenriYuki/SillyTavern-Horae) — 结构化保持 + 时间锚点 + 场景记忆 + 待办事项
- [LittleWhiteBox](https://github.com/RT15548/LittleWhiteBox) — 多层存储 + 因果链 + Dense-Lexical 融合

## 许可证

MIT License
