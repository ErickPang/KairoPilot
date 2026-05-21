# AGENT.md

## 项目介绍
KairoPilot 是一个面向本地工作流的桌面 AI Agent 工作台
它将"聊天式 AI"升级为"可持续协作的本地 AI 操作环境"。核心差异化：
- **多 Agent 隔离**：每个 Agent 拥有独立的模型绑定、权限策略、工作区与会话历史
- **Prompt 文件系统**：通过 `KAIROPILOT.md` / `IDENTITY.md` / `USER.md` / `SOUL.md` / `MEMORY.md` 组织 Agent 行为、人格与长期上下文
- **桌面原生能力**：文件系统、Shell 命令、网络检索、系统监控等工具链
- **安全可观测**：高风险操作可确认、关键工具调用可审计、Token消耗可监控

## 核心原则
1. **编码前思考:** 不要假设。不要隐藏困惑。呈现权衡。
- 明确陈述你的所有假设。如果不确定，直接询问用户。
- 当指令存在歧义时，列出多种可能解释，并说明你准备采用哪一种（不要默默选择）。
- 如果发现明显更简单、更高效的方案，主动提出异议并说明理由。
- 如果有任何地方不清楚，立即停止，指出困惑点并请求澄清。
2. ** 简洁优先:** 用最少的代码解决问题，不要过度推测。
- 严格只实现用户明确要求的功能，不要额外添加“可能有用”的特性。
- 如果能用50行解决，就不要写200行。写完后主动检查是否可以简化。
3. **精准修改:** 只碰必须碰的。只清理自己造成的混乱。
- 不要“顺手”改进相邻的代码、注释、格式或命名。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | Electron 30 |
| 构建工具 | Vite 5 + vite-plugin-electron |
| 前端 | React 18 + TypeScript 5 (strict 模式) |
| 打包 | electron-builder（支持 macOS / Windows / Linux） |
| 本地存储 | better-sqlite3 + lowdb + electron-store |
| AI SDK | OpenAI SDK v6 |
| 数据校验 | Zod 4 + zod-to-json-schema |
| Markdown | react-markdown + remark-gfm |
| 图标 | lucide-react |
| 定时调度 | node-schedule |
| 测试 | Vitest 3 |
| 代码检查 | ESLint 8 + @typescript-eslint + eslint-plugin-react-hooks |

**架构模式：**
- **三层架构**：主进程（main）→ 预加载层（preload）→ 渲染进程（renderer），通过 IPC 通信
- **桥接安全**：preload 使用 `contextBridge` 暴露受限接口，渲染进程不直接获得 Node.js 能力
- **IPC 合同**：所有 channel 在 `src/shared/ipc.ts` 中显式声明，禁止魔法字符串
- **存储层**：SQLite（会话/审计/统计）+ JSON 文件（配置），通过 store 模块集中管理

## 项目结构

### 整体项目结构
src/
├── main/
│   ├── index.ts                    # Electron 入口，注册协议、启动生命周期
│   ├── bootstrap/
│   │   └── appBootstrap.ts         # 应用启动与生命周期绑定
│   │
│   ├── core/
│   │   ├── agent/                  # 运行时、任务编排、工具调用协调、审批控制
│   │   ├── context/                # 上下文装配（assembler）、压缩（compactor）、记忆（memory）
│   │   ├── llm/                    # Provider 适配、Prompt 组装、类型定义
│   │   ├── plugins/                # 插件管理与加载
│   │   ├── security/               # 权限模型、策略常量、访问控制判断
│   │   ├── skills/                 # 技能索引、导入、解析、校验、存储
│   │   └── tools/                  # 文件系统 / Shell / Web / System 工具实现
│   │
│   ├── bridge/ipc/                 # IPC handler 注册与分发
│   ├── services/                   # 窗口管理、协议服务、应用运行时
│   ├── store/                      # 配置 / 会话(SQLite) / 审计 / 统计 / 附件
│   └── workspace/                  # 工作区布局约定
│
├── preload/
│   └── index.ts                    # contextBridge 安全桥接（唯一暴露面）
│
├── renderer/
│   ├── main.tsx                    # React 入口
│   ├── App.tsx                     # 根组件
│   ├── components/                 # UI 组件（聊天/配置/监控/设置/技能商店等）
│   ├── hooks/                      # 领域逻辑与状态 Hook
│   ├── i18n/                       # 中英文国际化文案
│   └── theme.ts                    # 外观主题配置
│
└── shared/
    ├── ipc.ts                      # IPC channel 合同定义（唯一来源）
    └── contracts.ts                # 主进程/渲染进程共享类型

### 仓库外部
skills/                             # 内置技能定义（find-skills、skill-creator 等）


## 编码规范
### 命名规范
- 文件名使用小写加下划线（例如main_process.js、app_controller.cpp）。
- 函数和变量名使用驼峰式命名。
- 类名使用帕斯卡命名法。
- 常量使用全大写下划线分隔（例如API_BASE_URL）。

## 常用命令

```bash
npm run dev          # 启动开发环境（Vite HMR + Electron）
npm run build        # 完整构建：tsc 编译 → Vite 打包 → electron-builder 产出安装包
npm run lint         # ESLint 检查全部 ts/tsx 文件（--max-warnings 0）
npm run typecheck    # TypeScript 类型检查（noEmit，不产出文件）
npm test             # 运行全部单元测试（vitest run）
npm run preview      # 预览 Vite 构建产物的服务
npm run postinstall  # 安装 Electron 原生依赖（postinstall 钩子）
```

## 测试

### 测试文件约定

- 与被测文件同名，后缀 `.test.ts` 或 `.spec.ts`，存放于**同一目录**
- 测试文件被 `.gitignore` 排除，不提交到仓库（仅本地运行）

### 覆盖范围

| 模块 | 测试类型 | 覆盖内容 |
|------|----------|----------|
| agent/ | 单元测试 / 集成测试 | 运行时状态、工具调用、审批、能力编排 |
| core/context/ | 单元测试 | 上下文装配逻辑 |
| core/skills/ | 单元测试 | 技能索引、导入、解析、存储 |
| core/tools/ | 单元测试 | Web 搜索、路由 |
| core/security/ | 单元测试 | 权限判断、策略 |
| bridge/ipc/ | 单元测试 | Agent handler、handler service |
| store/ | 单元测试 | SQLite 数据库、配置、会话、统计、附件 |

### 验证要求

完成改动后按顺序执行：

1. `npm run lint` — 无 ESLint 警告
2. `npm run typecheck` — 无类型错误
3. 涉及运行逻辑时：运行相关测试 `npm test`（或指定文件）
4. 高风险改动（见第 7 节）必须至少验证一条允许路径和一条拒绝路径


## 约束



## 文档同步规则
以下内容发生变化时，应同步更新相关文档，至少包括 `README.md`，必要时补充更专门的说明：
- 权限模型或安全策略
- Prompt 文件系统结构或核心文件约定
- Agent 创建、初始化、运行或审批流程
- 工具能力、支持范围或限制条件
- 审计字段、监控指标、统计口径
- 技能/插件安装与管理方式

## git提交规范
- 每个提交都必须包含一个清晰、简洁的提交信息，描述改动的内容和原因。
- 提交信息应符合git提交信息规范，建议使用 [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) 格式。
- 提交的文件按照.gitignore规则过滤，避免提交敏感信息、临时文件、测试文件。

### 分支命名

| 类型 | 格式 | 示例 |
|------|------|------|
| 功能分支 | `feature/<描述>` | `feature/user-login` |
| 修复分支 | `bugfix/<描述>` | `bugfix/fix-header-layout` |
| 热修复 | `hotfix/<描述>` | `hotfix/critical-security` |
| 发布分支 | `release/<版本号>` | `release/v1.2.0` |

回答应优先帮助维护者快速判断风险和是否可合并，而不是只罗列改动文件。
