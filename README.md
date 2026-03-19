# KairoPilot

KairoPilot 是一个**消费级 AI 操作系统**，旨在让每个人都能轻松使用强大的 AI Agent。
基于 Electron + TypeScript 构建，深度集成操作系统能力，提供安全、本地化的 AI 体验。

## ✨ 特性

- **开箱即用**: 无需复杂配置，一键启动。
- **本地优先**: 完美支持 Ollama，数据隐私有保障。
- **深度集成**: 直接操作文件系统，响应速度极快。
- **安全沙箱**: 可视化权限管理，杜绝越权操作。
- **系统监控**: 实时监控系统资源（CPU/内存/Uptime）。
- **命令行工具**: 可选开启 Shell 命令执行能力（高风险操作需谨慎）。

## 🚀 快速开始

### 前置要求

- Node.js 18+
- [Ollama](https://ollama.com/) (可选，推荐用于本地模型)

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

1.  **启动应用**: 运行 `npm run dev` 启动。
2.  **配置 Agent**:
    - **Provider**: 选择 `OpenAI` 或 `Ollama`。
    - **API Key**: 如果使用 OpenAI，请输入 Key；Ollama 可留空。
    - **Model**: 输入模型名称（如 `gpt-3.5-turbo` 或 `llama3`）。
    - **Workspace**: 指定 Agent 的工作目录（默认为当前目录）。
3.  **开始对话**:
    - 尝试让 Agent 读取文件：`帮我读取当前目录下的 README.md 文件内容`。
    - Agent 会请求权限（目前 MVP 版本默认为 workspace 目录开启读写权限），然后执行操作。

## 🏗️ 架构

- **前端**: React + TypeScript + Vite
- **后端**: Electron (Node.js)
- **核心逻辑**: `electron/core/` (Agent Runtime, Security, Tools)

## 📄 许可证

MIT
