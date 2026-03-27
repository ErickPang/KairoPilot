# KairoPilot

KairoPilot 是一个面向本地工作流的桌面 AI Agent 工作台。  
它基于 Electron + React + TypeScript 构建，融合了多 Agent、工作区沙箱、Prompt 文件系统、原生桌面能力、审计日志与系统监控，目标是把“聊天式 AI”升级为“可持续协作的本地 AI 操作环境”。

项目整体设计受 OpenClaw / Claude Code 类工作流启发，但更强调桌面端落地、本地工作区隔离与可控的系统权限边界。

## 0.2.0 亮点

- 新增按 Agent 维度的 Tokens 消耗明细页，可从监控面板直接进入对应 Agent 的用量详情
- 明细页支持展示请求时间、模型名称、提示 Tokens、补全 Tokens 与总消耗 Tokens
- Tokens 明细支持分页查询，便于查看长周期历史记录
- 审计日志链路改为显式传递 `sessionId`，提升会话归属准确性
- 多 Agent 会话状态进一步隔离，避免不同 Agent 之间的上下文串扰
- 预加载层 IPC 白名单收紧，插件加载与执行边界进一步增强

## 核心定位

KairoPilot 当前聚焦以下四个方向：

- 本地工作区：每个 Agent 拥有独立 workspace，具备文件读写、目录遍历、命令执行等桌面能力
- Prompt 文件系统：通过 `KAIROPILOT.md`、`IDENTITY.md`、`USER.md`、`SOUL.md`、`MEMORY.md` 组织 Agent 的行为、人格与长期上下文
- 多 Agent 协作：支持多个 Agent 独立绑定模型、权限与会话，适合不同角色分工
- 安全可观测：所有高风险操作可确认、所有关键工具调用可审计、所有主要消耗可监控

## 主要能力

### 多 Agent 与会话隔离

- 内置默认主 Agent `main`，默认工作区位于 `~/.kairopilot/workspace`
- 支持创建多个 Agent，并为每个 Agent 绑定独立模型、工作区与权限
- Agent 级会话隔离，切换 Agent 时只展示该 Agent 自身的会话历史
- 支持多会话管理、标题更新与 SQLite 持久化存储

### Prompt 文件系统

- 启动或创建 Agent 时，会自动初始化 Prompt 文件与工作目录
- 支持以下核心文件：
  - `KAIROPILOT.md`：核心指令与工作流约束
  - `IDENTITY.md`：Agent 身份设定
  - `USER.md`：用户背景信息
  - `SOUL.md`：风格、原则与表达倾向
  - `MEMORY.md`：长期记忆入口
- 支持以下工作区目录：
  - `prompts/`
  - `memory/`
  - `skills/`
  - `tasks/`
  - `artifacts/`
  - `images/`
  - `media/`

### 模型与推理接入

- 支持接入本地与云端模型
- 当前内置支持 OpenAI 兼容接口与常见提供商配置，包括：
  - OpenAI
  - Ollama
  - DeepSeek
  - Kimi
  - 智谱
  - 通义千问
  - 自定义 OpenAI-Compatible Base URL
- 支持模型列表拉取、模型配置保存与 Agent 绑定

### 桌面能力与原生工具

- 文件系统工具：读取、写入、删除文件，列出目录内容
- Shell 工具：在受控命令白名单内执行命令
- System 工具：读取系统基础信息与运行状态
- Web 工具：网页搜索与页面抓取
- `kairopilot://` 协议：用于在安全根目录内展示本地文件资源，例如图像产物

### 技能与插件

- 支持公共技能与 Agent 专属技能
- 支持从工作区 `skills/` 目录扫描技能定义
- 插件加载前执行 manifest 校验
- 插件工具执行具备超时控制与基础边界保护
- 当前已具备插件管理与技能展示能力，插件商店接口仍在持续建设中

### 安全、审计与监控

- 文件系统访问采用允许路径白名单策略
- Shell 执行采用命令白名单策略
- 网络访问支持域名白名单
- 高风险操作支持 Human-in-the-Loop 确认弹窗
- 保护性禁止直接访问敏感目录与核心 Prompt 文件
- 预加载层 IPC 使用显式白名单，减少渲染进程暴露面
- 审计日志记录工具调用、参数、结果、错误与策略标签
- 系统监控面板支持查看：
  - Agent 活动统计
  - 提示 / 补全 / 总 Tokens
  - Agent 维度 Tokens 消耗明细
  - CPU / 内存 / 运行时长等系统资源

## 适合的使用场景

- 把 AI 作为本地编码助手、研究助手或运营助手长期使用
- 为不同角色创建独立 Agent，例如开发、文档、数据整理、网页研究
- 在本地工作区内安全地执行“读文件 → 分析 → 生成 → 保存”闭环任务
- 通过 Prompt 文件系统持续迭代 Agent 的人格、规则与知识沉淀

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+
- [Ollama](https://ollama.com/)（可选，用于本地模型）

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 代码检查

```bash
npm run lint
```

### 构建应用

```bash
npm run build
```

说明：

- 开发环境基于 Vite + Electron
- 生产构建会先执行 TypeScript 编译与前后端打包，再调用 electron-builder 产出安装包
- 当前构建配置已覆盖 macOS、Windows 与 Linux 打包目标

## 上手流程

### 1. 配置模型

- 打开设置面板
- 进入模型配置
- 新增模型并填写 provider、API Key、Base URL、模型名称等信息

### 2. 创建 Agent

- 在 Agent 配置中新增 Agent
- 绑定一个模型
- 设置 Agent 名称与工作区
- 配置文件系统、网络、Shell 等权限

### 3. 编辑 Prompt 文件

- 可直接在配置界面维护核心 Prompt 内容
- 系统会自动同步到对应工作区中的 Prompt 文件
- 后续也可直接在工作区中维护这些 `.md` 文件

### 4. 开始对话

- 在侧边栏创建新会话
- 让 Agent 读取文件、整理内容、执行命令或进行联网检索
- 高风险操作会触发确认弹窗

### 5. 查看审计与监控

- 在 Dashboard 中查看系统资源与 Agent Tokens 消耗
- 点击 Agent 活动统计中的总 Tokens 可查看该 Agent 的详细消耗记录
- 在 Audit Logs 中追踪工具调用详情

## Prompt 工作区结构

一个典型的 Agent 工作区如下：

```text
workspace/
├── KAIROPILOT.md
├── IDENTITY.md
├── USER.md
├── SOUL.md
├── MEMORY.md
├── prompts/
├── memory/
├── skills/
├── tasks/
├── artifacts/
├── images/
└── media/
```

这些目录分别承载规则、记忆、技能、任务规划与生成产物，是 KairoPilot 与普通聊天应用最大的区别之一。

## 项目结构

```text
src/
├── main/
│   ├── core/
│   │   ├── agent/       # Agent 运行时
│   │   ├── llm/         # 模型适配与 Prompt 组装
│   │   ├── plugins/     # 插件与技能加载
│   │   ├── security/    # 权限与安全策略
│   │   └── tools/       # 文件、命令、系统、Web 工具
│   ├── ipc/             # 主进程 IPC 处理
│   ├── services/        # 启动与协议服务
│   └── store/           # SQLite / 配置 / 审计存储
├── preload/             # contextBridge 安全桥接
└── renderer/
    ├── components/      # UI 组件
    ├── hooks/           # 领域逻辑与状态 Hook
    ├── i18n/            # 中英文文案
    └── App.tsx
```

## 技术栈

- Electron 30
- React 18
- Vite 5
- TypeScript 5
- better-sqlite3
- OpenAI SDK
- Zod

## 当前状态

KairoPilot 目前已经具备一个可用的桌面 Agent MVP，并持续向“本地工作区 + Prompt 文件系统 + 多 Agent + 桌面能力”的 Agent OS 方向演进。

当前已完成的重点包括：

- 多 Agent 与独立会话
- Prompt 文件系统初始化与装配
- SQLite 持久化
- 安全权限拦截与确认流
- 审计日志与系统监控
- Agent 级 Tokens 消耗明细
- 插件 / 技能的基础加载框架

后续将继续完善：

- Prompt 文件系统进一步建模
- 插件商店与技能生态
- 更细粒度的权限管理
- 更清晰的主进程服务化结构
- 更多桌面端自动化能力

## 项目协作规范

### Git Flow（适合有发布周期的项目）

- **主分支**：`main` —— 存放正式发布版本，每个提交对应一个版本。
    
- **开发分支**：`develop` —— 集成所有功能，准备下一次发布。
    
- **功能分支**：`feature/xxx` —— 从 `develop` 切出，完成后合并回 `develop`。
    
- **发布分支**：`release/v1.0` —— 从 `develop` 切出，用于发布前的测试和修复，完成后合并到 `main` 和 `develop`。
    
- **热修复分支**：`hotfix/v1.0.1` —— 从 `main` 切出，修复线上紧急问题，完成后合并到 `main` 和 `develop`。

### 分支命名规范

社区普遍遵循以下命名规则，让分支一看就懂：

| 分支类型    | 命名格式                     | 示例                         |
| ------- | ------------------------ | -------------------------- |
| 主分支     | `main` 或 `master`        | `main`                     |
| 开发分支    | `develop`                | `develop`                  |
| 功能分支    | `feature/<描述>`           | `feature/user-login`       |
| 修复分支    | `bugfix/<描述>`            | `bugfix/fix-header-layout` |
| 热修复分支   | `hotfix/<描述>`            | `hotfix/critical-security` |
| 发布分支    | `release/<版本号>`          | `release/v1.2.0`           |
| 文档/实验分支 | `docs/<描述>` 或 `exp/<描述>` | `docs/api-guide`           |

**命名要点**：

- 全部使用**小写字母**，单词间用**连字符 `-`** 分隔（避免空格、下划线、驼峰）。
  
- 描述应简洁明了，例如 `feature/add-dark-mode` 比 `feature/dark` 更清晰。
  
- 如果与 issue 关联，可包含编号，如 `bugfix/issue-123`


## 许可证

MIT
