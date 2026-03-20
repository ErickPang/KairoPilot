# KairoPilot: 消费级 AI 操作系统实施方案

## 1. 愿景与目标 (Vision & Goal)
**"OpenClaw for Everyone"**
我们的目标是打造一个**桌面原生、开箱即用**的 AI Agent 平台，将 OpenClaw 强大的编排能力与消费级应用的易用性完美结合，大幅降低普通用户使用自主 AI 的门槛。

**核心差异化优势：**
- **零配置 (Zero Configuration)**：无需安装 Python/Node.js 环境，无需配置 Docker。下载即用，一键启动。
- **深度集成 (Deep Integration)**：通过 Electron 原生访问操作系统（文件系统、终端命令、屏幕截图），绕过 HTTP/WebSocket 开销，响应速度极快。
- **安全优先 (Security First)**：内置**可视化、细粒度**的权限管理系统（沙箱 & 白名单），默认零信任，用户完全掌控 Agent 行为。
- **隐私至上 (Privacy Focused)**：支持本地优先架构（完美集成 Ollama），聊天记录和 Agent 状态全部存储在本地数据库，数据不离身。

---

## 2. 架构设计 (Architecture Design)

### 技术栈 (Tech Stack)
- **核心框架**：Electron + TypeScript (前端使用 React/Vue + Vite)
- **后端 (主进程)**：Node.js (处理系统调用、文件操作、Agent 运行时)
- **数据存储**：SQLite (结构化数据) 或 LowDB (轻量级 JSON 存储)
- **LLM 适配层**：统一的 Provider 抽象层 (兼容 OpenAI SDK, Ollama, Anthropic)

### 核心组件 (Core Components)
1.  **Agent 运行时 (The Agent Runtime - 大脑)**
    - 实现 "Think-Act-Observe" (思考-行动-观察) 的 ReAct 循环。
    - 管理上下文窗口 (Context Window)、短期记忆 (Short-term Memory) 和工具执行 (Tool Execution)。
    - **关键点**：与网络协议解耦，直接通过函数调用执行，性能更优。

2.  **权限守卫 (The Permission Guard - 安全层)**
    - 在*每一次*工具调用前进行拦截。
    - 强制执行严格的白名单策略：
        - **文件系统**：`allowedPaths` (例如：仅允许读写 `~/Documents/KairoWorkspace`)。
        - **网络访问**：`allowedDomains` (例如：仅允许访问 `github.com`)。
        - **Shell 命令**：`allowedCommands` (例如：仅允许 `git`, `npm`，禁止 `rm`, `sudo`)。
    - 支持 "Human-in-the-loop" (人机回环)：高风险操作需弹窗由用户确认。

3.  **插件系统 (The Plugin System - 能力层)**
    - 模块化的 "技能" (Skills) 设计，支持动态加载。
    - 示例插件：`FileSystemSkill` (文件管理), `WebSearchSkill` (联网搜索), `ScreenCaptureSkill` (屏幕感知)。

---

## 3. 功能路线图 (Feature Roadmap)

### 第一阶段：奠基 (Phase 1: The Foundation / MVP)
- [ ] **项目搭建**：初始化 Electron + Vite + TypeScript 项目骨架。
- [ ] **核心引擎**：实现基础的 Agent Runtime，支持 OpenAI 和 Ollama。
- [ ] **聊天界面**：构建现代化、响应式的 React 聊天 UI。
- [ ] **基础工具**：实现文件读写工具 (带基础安全检查)。
- [ ] **配置中心**：可视化的设置面板，用于管理 API Key 和模型选择。

### 第二阶段：安全与本地化 (Phase 2: Security & Local Integration)
- [ ] **权限管理 UI**：为每个 Agent 提供独立的权限开关面板。
- [ ] **本地模型支持**：自动检测并管理本地的 Ollama 实例。
- [ ] **持久化存储**：将聊天记录和 Agent 状态保存到 SQLite/JSON。
- [ ] **上下文管理**：支持拖拽文件投喂给 Agent，建立本地知识库。

### 第三阶段：生态与高级特性 (Phase 3: Ecosystem & Advanced Features)
- [ ] **插件商店**：浏览并一键安装社区贡献的技能插件。
- [ ] **任务自动化**：支持定时任务 (Cron) 和后台静默运行的 Agent。
- [ ] **屏幕感知**：实现 "Computer Use" 能力 (截图分析与操作)。
- [ ] **语音交互**：集成 STT/TTS，实现免提操作。

---

## 4. 安全实施策略 (The "Zero-Trust" Model)

我们将采用 **纵深防御 (Defense in Depth)** 策略：

1.  **默认拒绝 (Default Deny)**：Agent 初始状态没有任何权限。
2.  **显式授权 (Explicit Grant)**：用户必须手动开启 "允许文件系统访问" 并指定具体文件夹。
3.  **运行时拦截 (Runtime Interception)**：
    ```typescript
    // 拦截层伪代码逻辑
    async function executeTool(toolName, args, permissions) {
      if (toolName === 'fs_write') {
        // 1. 检查总开关
        if (!permissions.fs.write) throw new Error("权限拒绝: 写入权限未开启");
        // 2. 检查路径白名单
        if (!isPathAllowed(args.path, permissions.fs.allowedPaths)) {
           throw new Error(`权限拒绝: 路径 ${args.path} 不在允许的工作区内`);
        }
      }
      return tool.run(args);
    }
    ```
4.  **审计日志 (Audit Logs)**：每一次工具调用的详情都会被记录，并对用户可见。

---

## 5. 建议的目录结构 (Directory Structure)

```text
KairoPilot/
├── src/
│   ├── main/                 # 后端逻辑 (Node.js)
│   │   ├── core/
│   │   │   ├── agent/        # Runtime 核心逻辑 (ReAct 循环)
│   │   │   ├── llm/          # 模型适配器 (Ollama, OpenAI)
│   │   │   ├── security/     # 权限守卫 (PermissionGuard)
│   │   │   └── tools/        # 原生工具集 (FS, Shell)
│   │   ├── ipc/              # Electron IPC 通信处理
│   │   └── index.ts          # 应用入口
│   ├── renderer/             # 前端界面 (React)
│   │   ├── components/       # UI 组件 (ChatBubble, ConfigPanel)
│   │   ├── store/            # 状态管理
│   │   └── App.tsx
│   └── preload/              # 安全桥接层 (Preload Scripts)
├── resources/                # 预设 Agent 模板与图标资源
└── package.json
```
