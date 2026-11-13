# 插件包与 MCP 连接

插件负责分发技能和连接定义；技能提供方法与资源；MCP 连接提供外部工具。安装和浏览插件不会连接服务或执行包内代码。模型只能发现当前任务已经连接并批准工具目录的工具，调用继续经过统一审批与审计。

## 使用流程

1. 在设置的插件页导入 JSON/ZIP，检查包的来源、版本、资源及连接声明，确认安装。
2. 选择需要使用工具的可执行任务，在插件详情中检查端点或完整命令，单独确认连接。
3. 展开服务实际返回的工具描述和 JSON Schema，批准这一份工具目录。安装包的声明不代替本次审查。
4. 在任务中通过 `search_tools` 按需加载工具；按任务审批策略批准具体动作。第三方的 `readOnlyHint` 等提示不作为安全证明，也不授予会话免审权限。任务明确采用免审批策略时，动作无需逐次确认。

连接和目录批准绑定任务、包版本、工作目录及权限。应用重启须重连；工具目录变化、包更新/回滚/停用/卸载、任务设置变化和项目撤权会阻断旧授权。取消不会自动重试有副作用的调用。

## 支持范围与边界

| 连接模式 | 条件 | 实际边界 |
| --- | --- | --- |
| 远程 `http` | HTTPS Streamable HTTP、任务网络策略允许该固定端点 | 禁止重定向；服务内部权限取决于服务账号，本机目录规则无法约束服务内部行为 |
| `stdio` / `trusted-local` | 绝对可执行路径、任务启用 Shell 且白名单精确包含该路径、用户确认连接 | 以当前用户权限启动，未隔离；目录/网络白名单不能约束程序内部行为 |
| `stdio` / `restricted-local` | 默认本地模式 | 本版本未实现，拒绝启动，不降级为可信模式 |

仅对话及只读任务不能连接外部 MCP。远程连接支持手动输入可选 Bearer Token，只存于当前连接内存；不支持 OAuth、持久凭证、自动重连、服务端采样/根目录回调、旧 HTTP+SSE 传输或 Hooks。远程初始化仅允许协议握手、通知与读取目录；具体服务仍需独立信任。连接本地程序本身就会执行该程序，须先审查可执行文件、参数和包内脚本。

本地进程不继承应用的 HOME、NODE_OPTIONS 或凭证环境变量，仅继承 PATH、系统临时目录、系统路径与语言字段。此处理减少凭证意外传递，不阻止可信程序自行读取当前用户可访问的文件。取消调用、断开和退出时终止程序所在的进程组（macOS/Linux）或进程树（Windows）；自行脱离进程组的程序不在保证内。远程调用取消无法撤销已经发生的服务端副作用，界面和工具错误会要求先核验结果再决定是否重试。

## 包格式

JSON 导入文件包含 `manifest` 和 `files`；可直接导入仓库中的 [skills-only.json](../examples/plugins/skills-only.json) 验证无外部连接的技能包。字段不包含可执行入口、环境变量或持久凭证。资源可保存脚本文本，但只有技能工具的单独调用或已确认的本地连接才可能执行它们。

```json
{
  "manifest": {
    "packageVersion": 1,
    "id": "example.docs",
    "name": "Documentation tools",
    "description": "Research instructions and a remote document service",
    "version": "1.0.0",
    "author": "Example",
    "skills": ["skills/research"],
    "connections": [
      {"id": "docs", "name": "Documents", "transport": "http", "url": "https://mcp.example.com/mcp"}
    ]
  },
  "files": {
    "skills/research/SKILL.md": "---\nname: research\ndescription: Research documents with approved tools\n---\nRead sources and cite evidence."
  }
}
```

上面域名是格式示例，未提供在线服务。开发者应替换为真实、已审查的服务端点。`tools`、`capabilities` 和 `riskLevel` 可选，仅是安装前说明，不能授予执行权限；运行时目录来自 MCP `tools/list` 并单独批准。端点不允许用户信息、查询串或片段，凭证通过连接表单提供。

本地连接示例（路径须按机器配置）为：

```json
{"id":"local","name":"Local service","transport":"stdio","command":"/absolute/path/to/node","args":["${PLUGIN_ROOT}/server.cjs"],"executionMode":"trusted-local"}
```

`${PLUGIN_ROOT}` 只在参数中替换为当前不可变版本的 `resources` 目录，进程工作目录使用任务目录。`command` 不作 Shell 字符串解析，参数按数组传递；不自动下载、安装或执行包管理器。未指定 `executionMode` 时采用尚不可用的 `restricted-local`。

ZIP 导入使用根目录或包目录内的 `plugin.json` 保存 manifest，该目录下其他 UTF-8 文件保存为相对资源；恰好允许一个 `plugin.json`。资源目录不包含 `files` JSON 包装。例如：

```text
plugin.json
skills/research/SKILL.md
server.cjs
```

资源不接受绝对路径、上级目录、反斜杠、盘符、符号链接及大小写冲突。ZIP 只接受 stored/deflate，不支持加密。包 ID 最长 160 字符，使用字母、数字、点、下划线或连字符且以字母/数字开始。JSON 包最多 128 个资源、合计 2 MiB；ZIP 压缩文件最多 8 MiB、160 个条目，展开总量最多 2 MiB，解析后的 JSON 包仍须满足 2 MiB 上限。最多 20 个连接、30 个技能根目录；仅支持文本资源，不内置二进制依赖安装。

自定义插件来源为 HTTPS JSON 端点，返回完整包数组或 `{"plugins":[完整包]}`。禁止下载重定向、响应最多 2 MiB；不执行旧 JS 注册表。当前没有默认在线商店，也没有签名发布或发行者认证；SHA-256 用于版本绑定与完整性复核，不能证明发行者可信。

## 版本、技能与审计

每次安装/更新写入独立随机版本目录 `plugin-packages/<revision>/`，校验后通过原子配置保存切换注册引用。磁盘资源和 manifest 在读取技能、连接及调用前复核；本地文件被更改后须重新审查安装。更新失败保留旧注册与旧资源，未提交版本可能作为未引用文件保留。

再次导入相同 ID 和作用域的本地包会进入更新审查，显示版本差异并保留回滚快照；不会静默覆盖。

包内技能按原目录索引，ID 含包/作用域/技能路径的稳定哈希，不复制进独立技能目录。停用或卸载后不再提供这些技能；不会删除用户单独安装的技能。卸载只移除注册，保留版本文件；自动清理历史版本尚未实现。回滚只接受已验证的新格式快照，不能恢复旧 JS 执行器。

连接和目录批准记录插件、连接、任务与哈希，不记录 Token。动作通过已有工具审计记录参数、结果、审批及 `plugin_connection`、`plugin_package`、`plugin_catalog` 标签。业务参数/结果仍可能包含敏感信息，应按现有任务与审计数据政策管理。

每个应用进程最多 8 个活动连接；每个目录最多 200 个工具、512 KiB、10 页，总读取期限 15 秒；单页请求最多 10 秒。连接握手最多 10 秒，工具调用最多 30 秒。传输消息/HTTP 响应最多 1 MiB，工具返回最多 256 KiB；超限失败，不自动截断为成功。

旧插件注册和原 JS 文件保留并标记为阻止执行，不运行自动转换。需要重新制作声明式包；移除旧执行器后，没有双运行时兼容路径。

## 后续评审项

- 操作系统级本地隔离：应单独设计平台实现、文件与网络授权及子进程归属；当前不提供该能力。
- OAuth、账号范围与系统凭证存储：当前仅支持连接内存中的手动 Bearer Token，不提供持久登录。
- Hooks、发行者签名、自动更新与历史版本清理：尚未实现，需要独立的授权和撤销规则。
- 验证覆盖：自动验收使用本地合成模型、合成 MCP 服务和隔离数据，未验证真实第三方账号及 Windows/Linux 原生运行。
- 依赖审计：本次 SDK 安装时 npm 报告 11 项 moderate，尚未归因或自动修复；应另行区分既有依赖与新增传递依赖的影响。
