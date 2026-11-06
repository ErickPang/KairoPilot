# 开发与贡献

[返回首页](../README.md) · [使用指南](user-guide.md) · [架构说明](architecture.md) · [发布说明](releases.md)

这里集中记录开发环境、验证命令、项目结构和分支协作约定。首次使用应用请先阅读首页的[快速开始](../README.md#快速开始)。

## 本地开发

### 环境要求

- Node.js 24+
- npm 10+
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

### 产品冒烟检查

```bash
npm run smoke
```

### 发布前验证

```bash
npm run verify
```

CI 会在 push、pull request 与手动触发时运行同一条验证命令，并覆盖 Node.js 24。

### 构建应用

```bash
npm run build
```

说明：

- 开发环境基于 Vite + Electron
- 发布前建议先运行 `npm run verify`，统一覆盖 ESLint、TypeScript、Vitest 与产品冒烟检查
- 生产构建会先执行 TypeScript 编译与前后端打包，再调用 electron-builder 产出安装包
- 当前构建配置已覆盖 macOS、Windows 与 Linux 打包目标

### 统一工作台原生验收

```bash
npm run smoke:native
```

在临时数据目录运行真实 Electron main/preload/renderer，直接创建当前数据库，使用本机模型协议夹具。覆盖新安装、初始化并发、跨任务查看、审批定位、权限撤销、取消与重启；不发送真实项目资料，不调用付费模型。证据目录由命令输出。

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
│   ├── bridge/ipc/             # 主进程 IPC 处理
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

- Electron 45.2.1
- React 18
- Vite 7.3.7
- TypeScript 5
- better-sqlite3
- OpenAI SDK
- Zod

## 当前范围

统一工作台 W0–W3 已交付。W4 已接入任务模板、计划确认、项目自动记忆和按需只读委派；并发写入协调和自动化仍在后续范围。Shell 的固定 cwd 与命令白名单是应用限制，不代表操作系统级沙箱。

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
