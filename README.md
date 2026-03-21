# KairoPilot

KairoPilot 是一个**消费级 AI 操作系统 (Agent OS)**，旨在让每个人都能轻松使用、管理和定制强大的 AI Agent。
基于 Electron + Vite + React + TypeScript 构建，深度集成操作系统底层能力，采用“零信任默认”的安全沙箱机制，提供安全、本地化、高自治度的 AI 桌面体验。

## ✨ 核心特性（Phase 1 阶段）

- **多 Agent 架构与沙箱隔离**: 
  - 支持创建和管理多个独立的 Agent，每个 Agent 绑定不同的模型与专属的工作区。
  - **默认主 Agent (Main Agent)** 拥有默认工作区 `~/.kairopilot/workspace`，不可删除，保证系统基础可用性。
  - 新增 Agent 自动根据名称生成工作区后缀（例如 `~/.kairopilot/workspace-coding-assistant`），一旦创建，名称与工作区即被锁定不可修改，确保文件沙箱的安全与稳定。
- **动态上下文注入 (同心圆提示词架构)**: 
  - 采用类似于 Claude Code 的提示词模型，硬编码底层安全护栏，动态注入外部配置。
  - 支持工作区级别的 `KAIROPILOT.md` 文件（Agent 角色与工作流）与 UI 配置页的实时双向同步。
  - 规划并预留了 `MEMORY.md` 机制用于存储 Agent 的长期记忆与教训。
- **统一模型枢纽**: 完美支持云端大模型 (OpenAI, DeepSeek, Kimi, 智谱等) 与本地模型 (Ollama)，内置网络接口自动配置。
- **深度操作系统集成**: 直接操作本地文件系统，支持文件读写、目录遍历等原生操作，响应速度极快。
- **安全护栏 (PermissionGuard)**: 
  - 严格的工作区路径白名单隔离，防止路径穿越；
  - 高风险操作 (如网络搜索、页面抓取) 引入 Human-in-the-Loop (HitL) 人工确认机制。
- **技能插件市场 (Skills Marketplace)**: 内置插件生态，支持为特定 Agent 动态安装/卸载技能 (如 Web Search, System Info 等)。
- **沉浸式多会话体验**: 
  - 支持多会话 (Session) 切换，各个 Agent 之间的对话相互隔离，切换 Agent 界面自动平滑过渡。
  - 支持流式输出与思维过程 (Thinking) 展示。
- **审计与监控 (Audit & Monitor)**: 
  - 提供系统资源监控与 Agent 状态看板（含 Agent 活动状态与 Token 消耗等核心指标）。
  - 内置 Immutable Audit Logs 记录 Agent 的每一次工具调用，安全可溯源。

## 🚀 快速开始

### 前置要求

- Node.js 18+
- [Ollama](https://ollama.com/) (可选，推荐用于本地离线模型)

### 安装依赖

```bash
npm install
```

### 启动开发环境

```bash
npm run dev
```

### 构建生产包

```bash
npm run build
```

## 🛠️ 使用指南

1.  **启动应用**: 运行 `npm run dev` 启动桌面端应用。
2.  **配置大模型**:
    - 在左侧菜单点击设置图标进入 **Settings**。
    - 在 **Models** 区域点击 `Add Model`，选择提供商 (如 DeepSeek, OpenAI 或 Ollama)，填入 API Key。
3.  **配置 Agent**:
    - 在 **Agents** 区域点击 `Add Agent`，绑定刚刚创建的模型。
    - **Agent Name**: 输入名称后会自动生成对应的工作区后缀 (可手动修改)。创建保存后，名称和工作区路径将作为核心标识不可更改。
    - **系统提示词 (KAIROPILOT.md)**: 在此处编写 Agent 的角色设定，系统会自动在对应工作区目录下创建或更新 `KAIROPILOT.md` 文件。
4.  **开始对话**:
    - 回到主界面，点击左侧 `+ New Chat`。
    - 尝试让 Agent 执行任务，例如：`帮我列出当前工作区下的所有文件` 或 `帮我在当前目录下创建一个 hello.txt 文件`。
    - 切换不同的 Agent 时，历史会话将自动过滤，保证上下文清晰。

## 🏗️ 架构与技术栈

- **前端 UI**: React 18 + Vite + TypeScript + CSS Modules
- **后端 (主进程)**: Electron + Node.js (基于 `ipcMain` 和 `contextBridge` 的严格 IPC 通信)
- **本地数据库**: better-sqlite3 (支持 WAL 模式，用于持久化存储会话和消息)
- **核心模块 (`src/main/core/`)**:
  - `AgentRuntime`: 基于 ReAct 循环的任务执行引擎。
  - `PermissionGuard`: 文件系统与操作权限的安全护栏。
  - `PromptBuilder`: 负责底层安全护栏与外部配置 (`KAIROPILOT.md`) 的组装。

## 📄 许可证

MIT
