# MemoryPilot

SillyTavern 半插件化记忆管理系统，适配 LWB (LittleWhiteBox)。

## 安装

### 方法 1：通过 GitHub URL 安装（推荐）

1. 打开 SillyTavern → 扩展面板 → Install Extension
2. 输入仓库 URL
3. 点击安装，重启 SillyTavern

### 方法 2：手动安装

将此文件夹放入：
```
data/<你的用户名>/extensions/MemoryPilot/
```
或（全局安装）：
```
public/scripts/extensions/third-party/MemoryPilot/
```

## 功能

- **召回引擎**：可在 v32（经典）和 v34（支持 low 优先级分层）之间切换
- **管理面板**：记忆增删改查、合并、批量重构关键词
- **API 配置**：OpenAI/Claude/Gemini 多 provider 支持
- **召回监控**：实时查看召回结果和评分
- **自定义 Prompt**：分析/重构/合并 prompt 均可自定义并持久保存

## 存储架构

**核心改进：所有大数据存储在 `extensionSettings` 中，完全脱离 chat jsonl 文件。**

```
┌─────────────────────────────────────────────┐
│              extensionSettings              │
│         (settings.json, 服务端同步)          │
│                                             │
│  MemoryPilot/                               │
│    <chatKey>/                               │
│      memories: [...]     ← 记忆主体         │
│      apiConfig: {...}    ← API 配置         │
│      blacklist: [...]    ← 黑名单           │
│      stickyState: {...}  ← Sticky 状态      │
│      recallSettings: {}  ← 召回设置         │
│    _global/                                 │
│      recallVersion: 'v34'← 引擎版本         │
│      customPrompts: {}   ← 自定义 Prompt    │
├─────────────────────────────────────────────┤
│            chatMetadata.variables           │
│         (仅供 {{getvar::}} 宏读取)           │
│                                             │
│  mp_recall_pin: "..."   ← 置顶记忆文本      │
│  mp_recall_ctx: "..."   ← 召回上下文文本     │
├─────────────────────────────────────────────┤
│            chatMetadata.extensions          │
│         (极轻量指针, ~100 bytes)             │
│                                             │
│  MemoryPilot: { version, chatKey }          │
├─────────────────────────────────────────────┤
│              localStorage                   │
│           (浏览器运行缓存)                    │
│                                             │
│  mp_memories_<chatKey>: "[...]" ← 快速读取   │
└─────────────────────────────────────────────┘
```

### 为什么这样设计

| 问题 | 旧 taskjs 版 | 本插件版 |
|------|-------------|---------|
| LWB_SNAP 快照膨胀 | STscript /setvar 写入变量层，被 LWB 整包拍照 → 148MB+ | 零 /setvar 调用，不暴露给变量层 |
| chat jsonl 文件膨胀 | 全量记忆写入 chatMetadata → saveChat 超时 502 | chatMetadata 仅存指针 (~100B) |
| 每条消息触发多次保存 | syncMeta → saveChat × 5-10 次/消息 | 零 saveChat 触发（仅迁移时一次） |
| 跨端同步 | 依赖 chatMetadata（但太大导致保存失败） | extensionSettings 独立同步 |

## 自定义 Prompt

在管理面板中编辑的 Prompt 模板会自动保存到 `extensionSettings._global.customPrompts`，跨聊天共享、跨端同步。

支持的 Prompt 类型：
- **分析 Prompt**：用于 AI 分析聊天内容提取记忆
- **关键词重构 Prompt**：用于 AI 重构记忆的关键词分层
- **事件合并 Prompt**：用于 AI 合并多条记忆

每个 Prompt 都支持：
- ✅ 编辑后自动保存
- ✅ 恢复默认
- ✅ 跨聊天共享
- ✅ 跨设备同步

## 从 taskjs 版本迁移

首次加载时自动执行：
1. 检测 chatMetadata 中的旧版记忆数据 → 迁移到 extensionSettings
2. 清理 chatMetadata 中的冗余字段（stickyState, turnCounter 等）
3. 清理 chatMetadata.variables 中的 mp_ 前缀大变量

**重要**：安装此扩展后，请禁用或删除原来 taskjs 中的四个 MP 任务，避免冲突。

## 使用

- 打开扩展面板 → 展开 MemoryPilot → 点击按钮
- 或在设置中选择召回引擎版本

## 许可

MIT License
