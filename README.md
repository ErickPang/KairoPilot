# KairoPilot

KairoPilot 是一个**消费级 AI 操作系统 (Agent OS)**，旨在让每个人都能轻松使用、管理和定制强大的 AI Agent。
基于 Electron + Vite + React + TypeScript 构建，深度集成操作系统底层能力，采用“零信任默认”的安全沙箱机制，提供安全、本地化、高自治度的 AI 桌面体验。

## ✨ 核心特性

- **多 Agent 架构**: 支持创建和管理多个独立的 Agent，每个 Agent 可绑定不同的模型和专属的工作区。
- **动态上下文注入**: 采用类似 Claude Code 的“同心圆”提示词架构，支持工作区级别的 `KAIROPILOT.md` (Agent设定) 和 `MEMORY.md` (长期记忆) 动态注入。
- **统一模型枢纽**: 完美支持云端大模型 (OpenAI, DeepSeek, Kimi, 智谱等) 与本地模型 (Ollama)，自动配置接口。
- **深度操作系统集成**: 直接操作本地文件系统，支持文件读写、目录遍历等原生操作，响应速度极快。
- **安全沙箱 (PermissionGuard)**: 严格的工作区路径白名单隔离，防止路径穿越；高风险操作 (如网络搜索、页面抓取) 引入 Human-in-the-Loop (HitL) 人工确认机制。
- **技能插件市场 (Skills Marketplace)**: 内置插件生态，支持为全局或特定 Agent 动态安装/卸载技能 (如 Web Search, System Info 等)。
- **沉浸式对话体验**: 支持 Markdown 渲染、代码高亮、多会话 (Session) 切换、流式输出与思维过程 (Thinking) 展示。
- **审计与监控**: 提供实时的系统资源监控面板，并内置 Immutable Audit Logs 记录 Agent 的每一次工具调用，安全可溯源。

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
    - **Agent Name**: 输入名称后会自动生成对应的工作区后缀 (如 `~/.kairopilot/workspace-your-agent`)。
    - **KAIROPILOT.md**: 在此处编写 Agent 的角色设定和工作流指令，系统会自动同步到对应工作区目录下的文件中。
4.  **开始对话**:
    - 回到主界面，点击左侧 `+ New Chat`。
    - 尝试让 Agent 执行任务，例如：`帮我列出当前工作区下的所有文件` 或 `帮我在当前目录下创建一个 hello.txt 文件`。
    - Agent 将自动调用底层工具完成任务。

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
