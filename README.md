# KairoPilot

面向本地工作流的桌面 AI 工作台。按项目组织任务，连接本地或云端模型，通过对话处理文件、运行命令、搜索资料，并用技能与插件扩展能力。

[下载](https://github.com/ErickPang/KairoPilot/releases) · [快速开始](#快速开始) · [使用指南](docs/user-guide.md) · [开发与贡献](docs/development.md)

## 快速开始

### 下载安装

前往 [GitHub Releases](https://github.com/ErickPang/KairoPilot/releases)，查看与你的系统和架构匹配的安装包。发布平台以实际产物为准；没有对应安装包时，可从源码启动。当前采用手动下载安装与更新，详见[安装与分发说明](docs/releases.md#下载安装与更新)。

### 从源码启动

需要 **Node.js 24+**、**npm 10+** 和 Git。

```bash
git clone https://github.com/ErickPang/KairoPilot.git
cd KairoPilot
npm ci
npm run dev
```

### 开始第一个任务

1. 在设置中添加模型服务，填写所需的 API Key 或本地服务地址，并选择默认模型。本地模型可搭配 [Ollama](https://ollama.com/)。
2. 新建独立会话，或创建项目并选择工作目录。
3. 选择执行策略，输入任务并发送；需要授权时，在输入区查看操作并决定是否允许。
4. 在对话中查看结果，在文件与成果面板检查交付物。输入 `/` 可选择已安装的技能。

## 核心功能

- **项目与任务**：分别保存对话、模型、工作目录、草稿、附件和成果，支持排队续办。
- **本地与云端模型**：支持 Ollama、OpenAI、DeepSeek 等服务及自定义 OpenAI 兼容接口。
- **文件与工具**：在授权范围内读写文件、执行 Shell 命令、搜索和读取网页；聊天内展示执行活动。
- **技能与插件**：用 `/` 选择技能，按需加载技能说明与插件工具，支持安装审核和版本管理。
- **规则与记忆**：通过 `AGENTS.md` 管理工作规则，按项目管理记忆；支持任务模板、计划确认与只读子任务委派。
- **审批与用量**：提供操作确认、目录与命令限制、审计记录及按任务、模型和时间查看的 Token 统计。

## 权限与数据

默认数据目录为 `~/.kairopilot`。模型与搜索服务的 API Key 使用系统安全存储能力加密保存；任务中发给模型或联网工具的内容取决于所选服务、操作与授权。

工具执行受目录、命令和网络规则约束；会话内批准不能覆盖明确禁止的操作。Shell 限制属于应用层控制，不提供操作系统级沙箱。关闭窗口会隐藏到托盘并保留运行；真正退出应用会中断运行与待审批操作，再次启动进入空白新对话，历史可手动查看。

详细规则见[使用指南](docs/user-guide.md#目录与审批)。数据格式兼容性与安装限制见[发布说明](docs/releases.md)。

## 开发与验证

项目基于 Electron、React 和 TypeScript，使用 SQLite 与 JSON 保存本地数据。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动开发环境 |
| `npm run verify` | 运行 ESLint、类型检查、单元测试与产品冒烟检查 |
| `npm run smoke:native` | 使用隔离数据和本地模型夹具进行 Electron 原生验收 |
| `npm run build` | 构建应用与安装包，不自动发布 |

完整环境说明、独立检查命令、项目结构和分支约定见[开发与贡献](docs/development.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [使用指南](docs/user-guide.md) | 工作台操作、技能、审批、规则记忆与数据格式 |
| [开发与贡献](docs/development.md) | 本地开发、验证、构建与协作约定 |
| [架构说明](docs/architecture.md) | 进程通信、任务组织与存储结构 |
| [发布说明](docs/releases.md) | 封板验证、安装更新、兼容性与隐私说明 |

反馈问题或建议请提交 [Issue](https://github.com/ErickPang/KairoPilot/issues)。

## 许可证

[MIT](LICENSE)
