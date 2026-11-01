# 当前工作台结构

## 组织与执行

项目与任务是持久化单元。任务保存模型、策略、目录、模板、计划、引用和草稿。运行引擎中的 AgentConfig 是内部执行配置，不提供独立人格管理或会话隔离功能。

主进程通过显式 IPC 合同提供能力；渲染进程只使用 preload 桥接。主任务共用执行锁，只读子调查按父任务策略与额度执行。取消、授权拒绝、失败、暂停分别记录状态；待授权操作不会因切换任务而执行。

## 配置、规则与数据

配置文件 kairopilot.json 的当前版本为 4.2.0，workbench 为 2，包含模型服务、工作台默认值、外观、技能插件来源和联网配置。全局 AGENTS.md 位于数据根目录，项目规则位于授权目录。内置要求、用户输入、规则、技能方法、背景记忆分别装配；规则不能授予权限。

chatDb.ts 直接创建 schema 7 的完整表、索引和触发器，不运行版本升级。数据库持久化任务、运行、工具、审批、成果、草稿、队列、记忆、辅助用量及项目授权。不建立项目与人格绑定表。无效格式明确拒绝，不自动覆盖、转换或删除其他数据目录。

API Key 使用 safeStorage，配置原子保存与普通故障备份仍保留。它们是当前格式的写入保护，不是历史格式转换。

## 代码与验收入口

- src/main/bootstrap/appBootstrap.ts：启动与生命周期。
- src/main/store/configNormalization.ts：当前配置规范化；configRepository.ts：读取、原子保存和首次规则初始化。
- src/main/core/llm/provider.ts：模型工厂与能力查询；utils.ts：唯一的提供商辅助函数实现。
- src/main/store/chatDb.ts：当前数据库结构。
- scripts/p0-electron-smoke.mjs：统一验收入口，支持默认原生验收、--ui-polish 和显式真实模型验收。
- scripts/unified-workbench-entry.ts：新数据目录验收及重启验收，复用任务计划、记忆、委派、技能插件、授权、队列和 UI 测试。

验证命令：npm run verify、npx vite build、npm run smoke:native。原生验收使用隔离目录和本地合成模型，不发送真实项目资料。真实模型验收需要显式选择，不默认调用。
