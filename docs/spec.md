# Unified Notion MCP — 多 Workspace 统一管理与安全迁移

**文档类型：** 可交给 Claude Code / OpenAI Codex 执行的技术规格与实施计划（不是已经实现的代码）  
**版本：** v1.1，2026-11-16（Windows GUI 纳入首个正式版本的必做范围）  
**目标系统：** Windows 本地优先的 Tauri + React 图形控制台 + 统一 Notion MCP 后端；Claude Code、Codex、兼容的 Claude Desktop / OpenAI & Anthropic API；满足当前产品权限时兼容 ChatGPT 网页版  
**Notion API：** 明确固定 `Notion-Version: 2026-03-11`，升级时做回归测试  
**设计原则：** GUI 是用户主要管理入口，CLI 是自动化/故障恢复备用入口；一套 MCP 实现、多个 Workspace 的隔离授权；先复制再核验，保留源数据，禁止未批准的批量删除

> 核心目标：使用者能说“在 SilverBench 里添加下一版计划”“把 Vibecode 的 Nihilux 项目迁移到新 Workspace”，Agent 自动选择正确空间、进行合法操作、返回可检查的结果。不能要求使用者记住 Notion Workspace ID，也不能因为跨空间复制而丢失任务、版本、附件和引用。

---

## 0. 现实边界（开工前须通过）

1. **Notion Windows 桌面版不是 MCP Server。** 它可以继续用于查看和手工调整；自建 MCP 使用 Notion 云端 API，不需要通过窗口点击、OCR 或 UI 自动化来实现常规操作。
2. **一个 MCP 后端可以持有多个 Workspace 的独立授权**，但每个 Workspace 必须先授权。MCP 不会自动继承 ChatGPT / Claude 官方 Notion 连接器的 OAuth 凭证。
3. **Notion 公共内容 API 不能任意创建 Workspace、修改账单或绕过访问权限。** 用户手工创建 Workspace 并授权即可；Enterprise 管理 API 是另一套能力，不纳入第一版。
4. **`POST /v1/pages/{page_id}/move` 是普通页面的移动接口**，不支持移动数据库对象；官方文档没有明确承诺其跨 Workspace 语义。不得用它作为跨空间迁移实现。跨空间默认 **复制+重建**，源项目保持不变直到批准完成切换。
5. **跨空间不是字节级克隆。** 页面/记录 ID、原始创建者与创建时间、评论作者与历史、某些嵌入、集成权限、特殊块、视图细节与文件 URL 可能无法原样保留。需要迁移报告、可恢复快照及“需要人工处理”队列；禁止声称 100% 无损。
6. **客户端权限有区别。** Claude Code 与 Codex 支持自定义 MCP 读写；Anthropic / OpenAI API 可通过远程 MCP 调用工具；ChatGPT 网页端的自建 MCP 完整写入权限受其套餐与管理员限制，Notion Business 订阅不改变这一点。
7. **“所有操作”应理解为 Notion API / 接入客户端授权范围内的所有可用内容操作**，并非不设限的管理员身份。危险操作需要可审核的批准，不能静默删除。
8. **首个正式 Windows 版本必须提供图形管理界面。** 连接、授权、项目路由、服务状态、迁移预览、日志与恢复不能以“需要打开终端”为日常前提。GUI 不替代 Notion 编辑器，也不能绕过 API / 客户端权限限制。

## 1. 现状清单（已在 Notion 中核查，作为第一轮迁移基线）

### 1.1 已连接 Workspace

- `Vibecode` — 当前项目数据源所在 Workspace。
- `Honour` — 独立 Workspace；不能与软件项目混淆或被自动删除。
- 目标：用户手工创建 `SilverBench`、`Nihilux`、`Kuru Kuru`、`AutoHoyo`、`Blenderboo` 等新 Workspace，完成各自授权后迁移。

### 1.2 Vibecode 当前 Projects 数据源

项目目录页面：（内部链接，见本机私有配置）

项目记录（不要把“记录页”和“独立项目说明页”误认成同一个对象）：

| 项目 | Key | 项目记录页 ID | 已关联 Issues | 已关联 Releases |
|---|---|---|---:|---:|
| SilverBench | SB | *(私有)* | 20 | 2 |
| Nihilux | NX | *(私有)* | 4 | 2 |
| Kuru Kuru | KK | *(私有)* | 0 | 0 |
| AutoHoyo | AH | *(私有)* | 0 | 0 |
| Blenderboo | BB | *(私有)* | 7 | 0 |
| **合计** | | | **31** | **4** |

当前关键数据源（Vibecode 内部标识保存在本机私有配置，不入库）：

- Projects: *(私有)*
- Issues: *(私有)*
- Releases: *(私有)*

四个已验证的独立项目说明页：

- SilverBench: *(私有)*
- Nihilux: *(私有)*
- Kuru Kuru: *(私有)*
- AutoHoyo: *(私有)*

**关键结构：** 这些独立说明页中的 Issues 和 Releases 是共享数据源的筛选视图，并非项目自己的数据库。项目记录页与 Issues / Releases 之间还有 relation；因此跨 Workspace 时必须重建数据源及关系，并重新配置视图。`Blenderboo` 也必须纳入，不得只处理先前最常讨论的四个项目。

**注意：** 这是当前 `Projects` 数据源的核查，不等于整个 Vibecode Workspace 的全量清单。开发时仍须递归扫描所有顶层页面、子页面、数据库、Block、文件、评论与引用，发现未在 Projects 中登记的项目并生成异常报告。

### 1.3 实际涉及的数据属性

- **Projects**：`Name`、`Key`、`Repository`、`Status`、`Priority`、`Description`、`Current Version`、`Issues` relation、`Releases` relation。
- **Issues**：`Title`、`Issue ID`、`Project` relation、`Status`、`Priority`、`Type`、`Found On`、`Verified On`、`Target Release` relation、`Evidence`（文件/文件夹）、`Steps to Reproduce`、`Expected Result`、`Actual Result`、`Fix Summary`、`PR / Commit`、`Affected Version`、`Due Date`。
- **Releases**：`Name`、`Version`、`Project` relation、`Issues` relation、`Status`、`Installed On`、`Verified On`、`Release Date`、`GitHub Release`、`Changelog`。

`Issue ID` 可能是唯一编号或自动编号；迁移前确认属性类型。若系统生成编号无法保留，建立稳定的 `Legacy Issue ID` 字段，避免 `DEV-12` 等引用丢失。

---

## 2. 技术架构

```text
               Windows Desktop GUI (Tauri 2 + React / TypeScript)
        Dashboard | Workspaces | Routing | AI Clients | Migration | Logs
                               |
                  Trusted local IPC / management API
                               |
Claude Code / Claude Desktop       Codex CLI / IDE        OpenAI / Anthropic API
            |                           |                          |
        local stdio                 local stdio               HTTPS + OAuth
            |                           |                          |
            +-------------+-------------+--------------------------+
                          |
                  Unified Notion MCP (Node sidecar/service)
          +---------------+------------------+
          | Workspace Router / Identity      |
          | Notion API Client / Normalizer   |
          | Tool Registry / Capability Map   |
          | Migration Engine / Job State     |
          | Audit & Approval Gate            |
          | Rate Limiter / Retry / Cache     |
          +---------------+------------------+
                          |
            Secure Workspace Credential Vault
            +--------------+--------------+
            |              |              |
        Vibecode        Honour       New project workspace(s)
          Token A       Token B           Token C...N
```

**进程原则：** GUI 是控制面，不是第二套 Notion 逻辑。Notion API、审批、凭证管理、迁移状态机全部位于后端共享服务；关闭窗口不应中断已批准且在运行的迁移任务（由后台进程/托盘负责维持），也不应使 Claude/Codex 的连接配置失效。用户退出整个服务时应明确提示对当前任务与客户端连接的影响。

### 建议技术栈

- **运行时**：当前受支持的 Node.js LTS，TypeScript，ESM；必须支持 Windows。
- **桌面 GUI（首版必做）**：Tauri **2** + React + TypeScript（可使用 Vite），采用 Windows WebView2；包含系统托盘、启动/停止服务、首次设置向导、迁移状态与日志。前端只通过有权限边界的本地 IPC / 管理 API 访问后端，不直持有 Notion Token。
- **进程打包**：把 Node MCP 服务作为 Tauri sidecar 或受控后台进程安装/启动，支持开机启动、异常重启及端口/进程冲突诊断。需验证 Tauri 资源打包、Windows 安装器、Node runtime 分发与单实例行为；不依赖用户手工安装 Node.js。
- **MCP**：官方 MCP TypeScript SDK **v2** 的 `@modelcontextprotocol/server`；本地 STDIO；后续引入 Streamable HTTP（使用 v2 对应 Node/Express adapter）。**不要从旧教程不加区分地复制 v1 `@modelcontextprotocol/sdk` API。**
- **Notion**：官方 `@notionhq/client`，锁定 API 版本 `2026-03-11`；对新功能和差异使用集中封装的 API adapter，禁止散落原始 HTTP 请求。
- **Schema/Validation**：Zod v4；每个 MCP Tool 提供强类型入参、输出、清楚的失败码。
- **状态库**：SQLite（本地，WAL），保存 workspace registry、项目映射、迁移任务、旧新 ID 映射、批次检查点、审计日志；不把 Notion access token 明文存于 SQLite。
- **凭证**：Windows Credential Manager / DPAPI 保护的 Secret Store；日志和错误消息对 token 严格脱敏。
- **网络**：本地阶段优先 STDIO。远程阶段只提供受身份验证保护的 HTTPS Streamable HTTP，支持 token 撤销及客户端身份；可以通过合规安全隧道暴露本地服务。
- **测试**：Vitest（单元）、Mock Notion Adapter（合约）、Notion 测试 Workspace（端到端）。

### 关键身份模型

`workspace_id` 是路由与权限边界，不以模糊的项目名称替代。`project_key`（SB/NX/KK/AH/BB）对应稳定的业务身份；每个项目可映射到一个目标 Workspace。路由器支持：

- `workspace.list`: 查看可用/失效/只读的 Workspace，**不返回敏感 token**。
- `workspace.add` / `workspace.reauthorize` / `workspace.remove`: 用户受保护地管理授权；remove 不删除 Notion 数据。
- `project.map`: 将项目 Key 映射到 Workspace 和目标根页面。
- `project.resolve`: 查询目标；遇到同名项目或跨空间冲突时返回 `AMBIGUOUS_TARGET`，拒绝猜测写入。
- `search_all`: 只读搜索全部已授权空间，结果必须带 `workspace_id`、`project_key`、对象 URL。

默认查询可以跨空间，但**写入操作必须解析到唯一 Workspace**；没有明确目标就失败或要求用户选择，不得自动落到 Vibecode。

---

## 3. MCP Tool 清单及优先级

### P0：连接与通用内容（必须可用）

| 工具名（建议） | 行为 | 风险等级 |
|---|---|---|
| `list_workspaces` | 列出授权空间、权限、健康状态 | READ |
| `list_projects` / `resolve_project` | 列出项目，精确定位目标 | READ |
| `search_all` / `search_workspace` | 跨空间或指定空间搜索 | READ |
| `get_page` / `get_page_tree` | 读取页面，递归、分页、报告未知块 | READ |
| `list_databases` / `get_database_schema` | 获取数据库、数据源、属性与视图 | READ |
| `query_data_source` | 分页筛选记录 | READ |
| `create_page` | 创建页面、子页面 | WRITE |
| `update_page` / `append_blocks` | 页面属性、Markdown 或 Block 编辑 | WRITE |
| `create_database` / `create_data_source` | 创建数据库及数据源 Schema | WRITE |
| `update_data_source` / `create_view` | 编辑属性、视图、筛选 | WRITE |
| `create_record` / `update_record` | 数据库记录及关系维护 | WRITE |
| `upload_file` | 上传并附加图片、文件 | WRITE |

### P1：更完整的 Notion 操作

- `move_page_within_workspace`：同 Workspace 内普通页面移动；跨空间直接拒绝并提示使用 migration。
- `copy_page_tree`：同空间/跨空间复制（不是原生移动）。
- `create_comment` / `list_comments`：在 API 支持范围内处理评论；历史作者不能伪造。
- `archive_page` / `restore_page` / `delete_block`：危险操作，必须 Approval Gate。
- `bulk_update_records`：带 dry-run、版本检查的批量写入。
- `get_attachment` / `copy_attachment`：安全文件下载与重新上传，文件大小和可访问性检测。
- `get_job_status` / `cancel_job` / `resume_job`：长任务检查和失败恢复。
- `diagnose_permissions` / `audit_recent_changes`：检查令牌与页面授权、读取审计日志。

### P2：Workspace 拆分自动化

- `migration_discover(source_workspace, project_key)`：产生详细资产清单、依赖图、不可迁移项目报告。
- `migration_plan(...)`：生成迁移预览，输出预期创建/修改/遗漏对象及风险、估计 API 请求量、源目标映射。
- `migration_execute(plan_id, approval_token)`：执行非破坏性的复制和重建；只使用被批准的 plan。
- `migration_verify(job_id)`：双端完整性检查，生成逐项对账报告。
- `migration_finalize(job_id, approval_token)`：显式切换项目路由；源项目保留只读或经批准归档，**不得自动删除**。
- `migration_rollback(job_id, approval_token)`：如果尚未切换，撤销本工具生成的目标副本；源始终不动。对 Notion API 无法恢复的变更报告手工步骤。

### 通用工具契约

每个 Tool 必须返回：`ok`, `code`, `workspace_id`, `project_key`, `resource_url`, `changed_objects`, `warnings`, `errors`, `job_id`（如适用），`dry_run`, `requires_approval`。写操作必须支持 `idempotency_key`，防止同一次调用被 Codex / Claude 重试时生成重复页面。

---

## 4. Workspace 授权与用户操作

### 4.1 第一版（最容易实现）

使用 **每 Workspace 一个 Notion Internal Connection**：

1. 你在 Notion 手工建立目标 Workspace，例如 `SilverBench`。
2. 在该 Workspace 创建 Internal Connection（有读取、插入、更新内容的权限）。
3. 通过 Notion 的 Connections / Share 功能授予集成必要的根页面和数据源权限。
4. 在 **Notion Hub Windows GUI → Workspaces → Connect Workspace** 选择空间并安全录入 token；保存在 Windows 安全凭证库；`notion-hub connect` 是备用 CLI。
5. 程序通过 Notion API 验证授权，记录真实 workspace ID、集成身份及可操作的根页面。
6. 在 `notion-hub map` 为项目绑定目标 Workspace；以后 Claude、Codex 自动使用正确凭证。

每个 Workspace 至少需要一次授权；后续不必每次聊天重新授权。**不能沿用 ChatGPT 官方插件已有的访问令牌。**

### 4.2 OAuth（Owner 本轮加入 Milestone 1）

把应用注册为 **Notion Public OAuth Integration**，在 GUI 中提供 `Connect with Notion`（浏览器 OAuth 流程），由用户逐个 Workspace 授权；保存各自授权结果，不再逐个手工复制 token。OAuth app 是同一个，Workspace 授权仍互相独立。需要处理 token 更新与撤销、OAuth state、回调来源验证。OAuth 未完成前，GUI 必须可通过 Internal Connection 工作，不得将后续 OAuth 当成首版交付的隐含前置条件。

当前源码已加入本机回调、一次性 state、安全凭证保存、逐空间授权/重新授权和显式 token 刷新。2026-11-19 已用同一个 app 完成两个测试空间的真实 OAuth、身份/搜索/页面读取、跨空间拒绝和重启持久化验证；113 项测试及 Windows CI 通过，最终便携版已打开。内容调用仍只读，真实 token 刷新/撤销及其余 M1 功能单独验收，见 [真实验收记录](qa/2026-11-19-real-oauth.md)。

### 4.3 Windows 图形管理界面（首个正式版本必须交付）

**定位：** GUI 是主要用户入口，CLI 仅用于无界面部署、诊断和高级自动化。不接受“先只做 CLI，以后再补 UI”作为完整第一版的交付结果。界面不需要内置通用 Notion 页面编辑器：用户继续用官方 Notion Desktop 编辑页面；本程序负责连接、跨空间管理、Agent 接入与迁移。

**技术要求：** Tauri 2 + React + TypeScript、Windows WebView2、适配 Windows 11 亮色/暗色主题、合理缩放与键盘操作；优先简单稳定的本地控制台，不要为了拟物动画拖慢核心功能。主窗口采用侧边导航，长任务可在后台持续，通知应可点击回到对应 Job。

| 页面 / 模块 | 必备控件与行为 | 第一版交付范围 |
|---|---|---|
| Dashboard | 后端状态（Running/Stopped/Error）、API 健康、已连接空间数、最近任务、最近错误；明确区分“配置存在”与“实际连通” | **必做** |
| Workspaces | 列出 Vibecode、Honour 及新增空间；添加、验证、重新授权、查看被授权的根页面、断开连接；不展示 token | **必做** |
| Project Routing | 显示项目 Key / Workspace / Root Page；搜索、手工改映射、重名冲突警告，显示当前路由目标 | **必做** |
| AI Clients | Claude Code / Codex 状态、配置检测、一键生成/应用配置、测试实际 MCP 握手、复制诊断信息；不可仅凭配置文件存在就报 Connected | **必做** |
| Migration Manager | 选择源空间、项目和目标空间；Discover / Snapshot / Dry-run / 依赖预览、风险清单、批准、开始/暂停/恢复、实时进度及验证报告 | **首版包含界面框架和 Dry-run；完整执行随迁移里程碑交付** |
| Activity & Logs | 时间线、过滤项目/Workspace/操作/级别、可读错误与解决提示、一键导出已脱敏诊断包 | **必做** |
| Settings | 启动项、关闭到托盘、通知、日志保留、备份位置、服务端口、安全状态、更新检查与版本信息 | **必做** |

#### 4.3.1 首次启动向导（零命令行）

1. 自动检测本机后端安装、端口冲突、凭证库与 Windows WebView2 状态；若缺组件，给出可理解的修复方式。
2. 选择 `Connect workspace`，先支持 Internal Connection Token 的安全录入和即时验证；保存时不明文写入配置、日志或前端本地存储。
3. 若还没有新 Workspace，提供 **Open Notion to create Workspace** 的外部链接和步骤；**不得显示虚假的“Create Workspace succeeded”**。可用已登录的 Notion 桌面版或浏览器完成用户操作。
4. 选择项目根页面并建立 project mapping，展示源/目标 Workspace 信息及已获得的访问范围。
5. 一键添加 Claude Code / Codex MCP 配置，测试真正的 Tool List/握手及只读 Notion 调用；要区分 `Not installed`、`Configured`、`Connected`、`Degraded`、`Auth required`。
6. 完成时显示可测试的示例指令；以后可以随时添加新 Workspace，无须重复配置每个 Agent 的 Notion Token。

#### 4.3.2 启动与托盘

- 默认**不**开启开机自启；用户在 Settings 中明确开启后执行。支持 `Start MCP`、`Stop MCP`、`Restart MCP`、`Open Dashboard` 和 `Quit`。
- GUI 关闭按钮可按设置隐藏到托盘；完全退出时明确告知是否会停止服务以及是否有活跃迁移任务，不得不提示就终止。
- 开机自启必须避免重复服务实例；本地单实例互斥锁 + 后端健康检查 + 自动恢复，停止时优雅完成在途写入或保存 checkpoint。
- 局域网/远程 MCP 默认关闭；仅 loopback 监听。启用远程必须单独配置 HTTPS、身份验证与授权。

#### 4.3.3 迁移可视化交互

- 在 GUI 里先展示 `Source → Target`、每类对象数量、共享数据源依赖、预计风险与不可复制项，用户能在开始前展开查看每一项。
- 未完成 Snapshot/Dry-run 时，`Execute Migration` 不可用。执行前需批准**具体 plan hash**；如果计划或源发生变化，重新批准。
- 进度条按真实已验证工作量计算：展示 `Discovered / Snapshotted / Copied / Relinked / Verified` 计数，不按猜测百分比或单纯 API 请求完成量显示。
- 支持 Pause / Resume / Retry failed items / Export report；失败时显示错误对象 URL、原因、重试安全性和人工处理提示。
- `Finalize` 与 `Archive source` 为独立动作。默认只切换 Router；归档/删除源数据必须二次确认，GUI 不能暗藏删除按钮。

#### 4.3.4 安全与可访问性验收

- UI 不暴露 token、refresh token 或审批密钥；错误导出包自动脱敏，剪贴板复制不会包括 secret。
- IPC 每个操作必须验证本地调用者与权限；WebView 禁止加载任意远程脚本和不受信任页面，外部链接用系统浏览器打开；前端不能绕过后端 Approval Gate。
- 迁移、断开 Workspace、批量编辑等高影响操作须显示目标 Workspace 与影响范围；模糊项目名必须先消歧。
- 键盘可访问、能使用系统缩放、具有等待/空状态/错误反馈；网络断开时 UI 可读缓存与历史审计，但不可误显示“已同步”。

### 4.4 CLI（保留但不作为日常前提）

```text
notion-hub init
notion-hub connect
notion-hub workspaces
notion-hub projects
notion-hub map SilverBench --workspace SilverBench
notion-hub doctor
notion-hub migrate plan --project SB --from Vibecode --to SilverBench
notion-hub migrate status <job-id>
notion-hub migrate verify <job-id>
```

这些是拟实现的辅助命令，不是当前已存在的程序；GUI 和 CLI 必须调用**同一个**后端业务服务，不能维护两套独立项目映射。 

---

## 5. 跨 Workspace 迁移引擎（本项目核心）

### 5.1 必须采用的状态机

```text
DISCOVERED -> SNAPSHOTTED -> TARGET_READY -> COPYING
    -> RELINKING -> VALIDATING -> READY_TO_CUTOVER
    -> CUTOVER_DONE -> SOURCE_RETAINED

任意阶段失败：FAILED / PARTIAL -> RESUMABLE
```

每个项目是独立 Job；避免一次性并行迁移全部项目，先验证一个小项目。

### 5.2 Step A — Discovery / 影响分析（不写入）

- 通过 Projects + 页面树递归发现项目全部资料和子页面。
- 枚举 Issues、Releases、附属数据库、视图、表单、模板、block、附件、评论、提及、外部链接。
- 识别共享对象：尤其 `Projects`、`Issues`、`Releases`；不能把整个共享数据源复制到每个项目中。
- 按 relation `Project` 归类记录，标记跨项目记录/无项目记录/多项目记录，避免漏迁或重复归属。
- 记录无法通过公开 API 读取、迁移或复原的对象，例如特殊块、部分链接视图、系统字段与历史活动。
- 为每个项目输出 `Migration Plan`：对象数、依赖关系、文件体积估计、可复制性、需人工干预项。

### 5.3 Step B — Snapshot / 本地备份（不更改源）

- 保存 `manifest.json`、项目元数据、完整 block tree JSON、页面 Markdown、副本数据库 schema 和可访问的附件原始文件。
- 保留附件原始文件名、MIME、大小、SHA-256；备份加密并放在用户指定的私有目录。
- 对每个页面存储 `id`、`url`、`parent`、`last_edited_time`，同时记录备份采集时间。
- 检查分页：API 有 `has_more` / `next_cursor` 时必须读取到结束。
- 如果页面的 Markdown 带 `truncated` 或 `unknown_block_ids`，必须回退到 Block API 并记录不能处理的块。
- 对源页面的修改时间执行前后检查：备份期间发生并发编辑的页面必须重采或进入冲突队列。
- 保存可重新开始的 checkpoint；**不能把“已经请求 API”当作“已经写入成功”。**

### 5.4 Step C — 在目标 Workspace 重建基础结构

每个目标空间建立或识别以下根页面与数据库：

```text
<Project Workspace>
  ├─ Project Home
  ├─ Tasks & Bugs       (独立 Issues 数据库/数据源)
  ├─ Releases           (独立 Releases 数据库/数据源)
  ├─ Docs & Research
  ├─ References & Assets
  ├─ Development Playbook
  └─ Migration Report
```

- 不要无脑复制原始共享 Projects 数据库；每个新 Workspace 以 `Project Home` 为单项目元数据源，必要时建立小型 `Project Settings` 数据源。
- 先创建 Issues / Releases 的目标 Schema，包括 Select / Multi-select 枚举、Date、People、Files、URL、Rich text、Relation 等，顺序遵守目标引用对象的依赖。
- 对数据库属性中不能直接写入的 formula、rollup、created_time、created_by、自动编号，创建兼容字段或记录迁移差异。
- 视图优先按 API 重建；若不支持某个原有配置，输出精确的手动修复说明，不能静默丢弃。

### 5.5 Step D — 复制内容与建立 ID 映射

- 两遍复制：**第一遍创建页面/记录/数据库/文件并记录新 ID；第二遍填充关系和内部链接**。
- 使用 `old_workspace_id + old_page_id -> new_workspace_id + new_page_id` 映射表。
- 按父子关系拓扑顺序创建；同名目录可幂等匹配，不能一重试就重复建立。
- 复制文本、格式、标题、代码块、表格、媒体、封面、emoji、链接、嵌套页面；遇到不支持的块记录为 `UNSUPPORTED_BLOCK`，并保留原始内容快照。
- 附件流程：读取源下载 URL → 文件哈希与大小验证 → 上传至目标 Workspace → 绑定新 file_upload_id；临时 URL 不能当永久链接使用。
- 对用户 @mention、页面引用、嵌入和关系链接做显式映射；不允许仅替换 URL 字符串就声称关系修复完毕。
- GitHub Repository / PR / Commit / Release URLs 原样保留。

### 5.6 Step E — 重建关系（绝对不可省略）

例如 SilverBench：

1. 创建新 Workspace 中的 SilverBench Project Home。
2. 按 Project 关系筛选旧 Issues，复制 20 条；按对应关系复制 Releases 2 条。
3. 为全部新记录创建 `old_id -> new_id` 映射。
4. 重建 Issues ↔ Releases 的关联，并把 `Target Release` 指向新版本记录。
5. 把文档中对旧项目记录、Bug、版本的 Notion mention / link 改为新目标，外部跨项目引用另做明确策略。
6. 重建原有的 Status、Priority、Type、Found On 等选项及视图筛选。
7. 如果 `Issue ID` 是自动生成值，则用 `Legacy Issue ID` 保留旧编号；文本中的 `DEV-12` 等标识不得自动重写成新编号。

对 Nihilux / Blenderboo / Kuru Kuru / AutoHoyo 做同样处理，缺失 Issue 或 Release 的项目也需要正确创建空数据库与页面结构。

### 5.7 Step F — Verify / 验收与手动切换

生成 `migration-report.md` / `migration-report.json`：

- 源/目标的页面、子页面、记录、Block、附件数量及哈希/内容抽样对照。
- 属性类型与枚举一致性；关键字段非空值对比。
- 关系与内部链接连通性：不能指向错误的 Workspace；跨项目链接要明确保留或重定向。
- 跳过项目的精确清单（附源 URL 和错误码），不得用“成功率 100%”隐藏任何警告。
- 来源与目标页面可打开性；权限健康状态；源页面导出文件存在且完整。
- 再次检查源的 `last_edited_time`，阻止遗漏同步期间改动。

只有 `VERIFY=PASS` 且用户批准后，才更新 Router 的项目映射。默认仍保留 Vibecode 里的旧数据，以 `Migrated / Read-only` 标记；用户可以以后手工决定归档或删除。**任何删除或归档需要二次批准。**

### 5.8 特殊情况

| 情形 | 要求 |
|---|---|
| 源数据源被多个项目共享 | 按 relation 拆分，重建各项目自己的数据源 |
| 一条 Issue 与多个项目关联 | 复制到多个目标或保留中央引用，必须在 plan 里要求决策 |
| 同名页面 | 依赖 ID + parent + project_key，不按标题盲目合并 |
| 迁移中网络中断 | checkpoint 恢复，避免重复创建 |
| Notion 429 / 529 | 按 `Retry-After` + exponential backoff + jitter；队列限速 |
| Notion 403 / 404 | 区分未授权/对象不可见/对象不存在；不可盲目重试 |
| 无法复制评论历史/作者、系统时间 | 保留审计快照与原链接，列出不可完整还原项 |
| 文件大于目标 Workspace 上传限制 | 报告精确文件和容量；不能吞掉错误 |
| Markdown 未知块或特殊 embed | 走 Block API 或排入手动修复 |
| 两个 Agent 同时修改同一项目 | 项目级写锁 + 版本检查 + 冲突记录 |

---

## 6. 连接 A/O 的方案

### 6.1 Phase 1：本机 STDIO（成本与复杂度最低）

同一套代码与同一份 Workspace Registry/凭证库，Claude Code 和 Codex 各启动各自的 STDIO MCP 进程；它们是**共享实现和数据，不是共享同一个运行中的进程**。桌面 GUI 负责一键生成客户端配置、连通测试及进程状态；下方命令仅用于排查问题或没有 GUI 的情况。

安装完成后，假定可执行入口是 `C:\Tools\unified-notion-mcp\dist\stdio.js`：

**Claude Code 示例**（在 Windows PowerShell 运行，路径按实际修改）：

```powershell
claude mcp add --transport stdio --scope user unified-notion -- node "C:\Tools\unified-notion-mcp\dist\stdio.js"
claude mcp list
```

**Codex CLI 示例**：

```powershell
codex mcp add unified-notion -- node "C:\Tools\unified-notion-mcp\dist\stdio.js"
codex mcp list
```

或在 Codex 的 `~/.codex/config.toml` 设置 `command = "node"` 和 `args = ["..."]`。这些示例以最终生成的入口文件存在为前提，不是开箱即用命令。

**重要：** 在多实例进程并行时，SQLite 使用 WAL + 事务锁；迁移任务只允许一个进程获得对应项目的 lease，不能两个客户端同时发起同一迁移。

### 6.2 Phase 2：真正单实例共享服务

由 GUI 启动/监控一个常驻 `127.0.0.1:8787/mcp` 的 Streamable HTTP 服务，Claude Code 与 Codex 都连接该地址，服务端统一处理 Workspace Registry、队列、迁移任务和审计。必须开启本机客户端身份认证；仅监听 loopback，不能无认证监听 `0.0.0.0`。GUI 的 `Running` 仅指后端健康，客户端是否连接须以实际调用证据判断。

Claude Code 支持：

```powershell
claude mcp add --transport http --scope user unified-notion http://127.0.0.1:8787/mcp
```

Codex 的配置：

```toml
[mcp_servers.unified_notion]
url = "http://127.0.0.1:8787/mcp"
```

**以上两个 HTTP 示例只演示连接地址**。发布前必须补齐实际身份验证配置，不能把示例当作安全的生产部署。

### 6.3 Phase 3：远程 API / ChatGPT

- 为需要远程访问的服务器增加 HTTPS 与 MCP OAuth/其他客户端支持的授权方式、权限 scope、token 撤销、访问日志和每客户端可用工具白名单。
- Claude API / OpenAI Responses API 使用**可从云端访问的远程 HTTPS MCP**；不能直接访问电脑的 `127.0.0.1` 或本地 STDIO。
- ChatGPT 网页端若账户允许接入自定义 MCP，按该产品的连接与写入权限限制配置；**不能保证个人版拥有自建 MCP 全量写入权限**。要用 ChatGPT 自定义 MCP 写入，应在真实账户中完成端到端验证。ChatGPT 的官方 Notion 插件与自建 MCP 是不同的权限渠道。
- 如不希望自建公网服务，可优先测试所支持的安全 MCP Tunnel，不要无认证转发内网端口。

---

## 7. 操作安全、审批与审计

### 权限级别

- `READ`: 查找、枚举、读取、预览。
- `WRITE`: 创建和修改已确定目标的页面、数据库、记录。
- `BULK_WRITE`: 大范围复制、批量字段修改、批量链接修复，需要先展示 diff 并获取一次针对计划 ID 的授权。
- `DESTRUCTIVE`: 归档、删除、清空内容、回滚目标副本、迁移源数据清理，需要明确二次批准，权限 token 不可复用。

### Approval Gate

`migration_plan` 返回 `plan_id + plan_hash + source + destination + object_count + warnings`；只有用户批准完全相同的计划后才生成有时效的 `approval_token`。执行过程中如果对象数量、权限或源修改时间出现重大变化，旧 approval 失效，必须重新提交计划。

### 最低安全要求

- 不在代码库、配置示例、MCP 工具结果或日志中输出 Notion token；不得传给模型上下文。
- 只接受来自已配置授权源的 Notion workspace ID，不允许客户端拼接任意外部 API 地址。
- 严格过滤用户提供的远程附件 URL，防止 SSRF（内网地址、localhost、云实例元数据地址等）；源文件限制大小、类型与下载超时。
- Notion 页面内容作为不可信输入，**不能把页面内的文本指令当成系统命令或 MCP 调用授权**。
- 错误返回明确但不泄露敏感凭证；所有写入生成本地追加式审计记录（调用者、工具、对象、变更摘要、时间、结果）。
- 用项目级分布锁/SQLite lease 防止跨客户端重复迁移。支持取消、恢复和最少一次写入情况下的幂等处理。

### 速率与性能

Notion 官方文档当前说明：每个 connection 平均约 **3 requests/second**，同时还有按 workspace 计划计算的共享限制；遇到 429/529，遵循 `Retry-After`，采用指数退避与抖动。迁移引擎要采用增量、批次和分页，限制同时进行的上传/写入任务，缓存只读元数据但不得缓存权限结果过久。

---

## 8. 推荐代码结构（GUI + MCP 共用核心）

```text
unified-notion-mcp/
  README.md
  package.json                       # monorepo/workspaces
  pnpm-workspace.yaml
  .env.example                       # 仅变量名，无真实凭证
  apps/
    desktop/                         # 第一版必做：Tauri 2 + React + TS
      src/
        screens/
          Dashboard.tsx
          Workspaces.tsx
          ProjectRouting.tsx
          AIClients.tsx
          MigrationManager.tsx
          ActivityLogs.tsx
          Settings.tsx
        components/
        state/
        ipc/
      src-tauri/
        src/
        capabilities/
        tauri.conf.json
        icons/
    server/                          # Node MCP sidecar / service
      src/
        entry/
          stdio.ts
          http.ts
          cli.ts
        mcp/
          server.ts
          tools/
            workspace.ts
            search.ts
            pages.ts
            databases.ts
            files.ts
            migrate.ts
          schemas/
        management/                   # GUI 专用本地 IPC / 管理接口
          service-control.ts
          workspace-auth.ts
          client-config.ts
          migration-jobs.ts
        core/
          workspace-router.ts
          project-registry.ts
          capability-matrix.ts
          approval-gate.ts
          audit.ts
          errors.ts
        notion/
          client-pool.ts
          api-adapter.ts
          pages.ts
          blocks.ts
          databases.ts
          data-sources.ts
          views.ts
          comments.ts
          file-transfers.ts
          rate-limit.ts
        migration/
          discover.ts
          snapshot.ts
          plan.ts
          schema-clone.ts
          copy.ts
          relation-relink.ts
          link-rewrite.ts
          verify.ts
          finalize.ts
          rollback.ts
          job-store.ts
        infra/
          sqlite.ts
          credentials-windows.ts
          logger.ts
          process-lock.ts
  packages/
    contracts/                       # Zod schemas、状态、错误码；前后端共用
  tests/
    unit/
    contracts/
    integration/
    migration-fixtures/
    desktop-e2e/
  docs/
    api-capabilities.md
    migration-limitations.md
    setup-windows.md
    desktop-ui-spec.md
    security.md
```

**打包关键点：** Tauri 不能只打包 UI；安装器必须包含可运行的 Node MCP sidecar / runtime、首次初始化脚本、所需配置和卸载策略。开发时先验证 Windows 目标机无需独立安装 Node.js 即可使用；GUI / sidecar / CLI 共用类型与状态定义。不得在浏览器端保存 SQLite 凭证库或复制服务端业务逻辑。 

---

## 9. 开发阶段与验收门槛（GUI 从第一个里程碑开始，不是尾期附加）

### Milestone 0 — API 合约 + Windows GUI Shell

**交付：** 独立 Git 仓库、TypeScript MCP v2 启动项目、Notion API 封装、官方端点支持矩阵、Tauri 2 + React Windows 主窗口、侧边导航和首次启动检测；两个测试 Workspace 的只读连通。

**验收：** 可直接启动 Windows GUI 并打开 Dashboard / Workspaces / Routing / Clients / Migration / Logs / Settings 页面；真实状态源来自后端（尚未实现的操作明确禁用），两个 Workspace ID/name 可读；不能把一个 Token 当作另一个 Workspace Token，错误 403/404 有清楚归因。

### Milestone 1 — 首版可用 GUI + 通用 CRUD + 双客户端

**交付：** P0 工具、Workspace Router、Windows 凭证库、SQLite registry、STDIO 入口；GUI 完成新增/验证 Workspace、项目映射、健康显示、Claude Code / Codex 配置与测试，以及真实 Activity 日志。

**验收：** **用户无需打开终端**，即可在 GUI 内配置两个测试 Workspace、映射项目并完成客户端连接；Claude Code 和 Codex 分别能在两个测试 Workspace 创建页面、写入文字并读回；模拟同名项目必须拒绝错误写入；验证普通页面、数据库记录、关系和附件。不能以截图或配置文件存在代替真实 Tool 握手。

### Milestone 2 — 后台单实例 + 托盘 + 安全与可恢复性

**交付：** GUI 服务开关、系统托盘、开机启动开关（默认关闭）、单实例/崩溃恢复、本地 Streamable HTTP、调用者身份验证、审计日志、冲突控制、重试与限流、迁移任务锁。

**验收：** 关闭主窗口到托盘后服务按设置持续可用；从 GUI 停止/重启服务时状态准确；重启 Windows 不出现两个后端；Claude 和 Codex 同时连接一个运行实例，对同一记录的冲突被检测，重复提交不会造成重复对象。

### Milestone 3 — 迁移 Manager 可视化 Dry-run

**交付：** GUI Migration Manager 的源/目标选择器、全量发现、快照与附件备份、数据库依赖图、Dry-run 清单、错误与风险详情、日志及进度；不写入目标。

**验收：** 在 GUI 操作下识别 Vibecode 5 个项目、31 Issues、4 Releases，以及共享数据源和独立文档；展示源/目标、对象数量、关系风险、不可迁移项；可导出计划/备份/诊断，未 Snapshot 时 `Execute` 不可用；不会擅自改动 Vibecode。

### Milestone 4 — GUI 驱动的首个项目完整迁移

**推荐先迁移 Kuru Kuru 或 AutoHoyo**（当前 Issues / Releases 均为 0，适合测页面结构）；然后迁移 Blenderboo（7 Issues）；最后迁移 SilverBench（20 Issues、2 Releases）并测试完整关系图。

**交付：** GUI 中逐项目批准计划、复制/重建、Pause/Resume、失败重试、Verify、Finalize、报告查看与导出；CLI/MCP Tool 可执行同样的任务。

**验收：** 目标 Workspace 的页面和独立数据库/视图可用，记录数量/字段/附件匹配，源不被删除；重复运行不会创建第二份；UI 进度基于实际已验证工作；失败可从 checkpoint 恢复；`Finalize` 与 `Archive source` 明确分开且后者二次批准。

### Milestone 5 — Windows 正式发行与维护

**交付：** 可安装的 Windows 程序（包含 Node sidecar，无需用户手工安装 Node.js）、卸载和升级策略、GUI 首次配置向导、CLI 使用手册、自动诊断/安全日志、备份与恢复文档；远程 HTTPS MCP 可作为后续增强。

**验收：** 全新 Windows 环境上通过安装器完成安装→连接测试 Workspace→配置 Claude/Codex→执行读写；在重启 Windows、令牌过期、网络断开、API 429、迁移中断时能从 GUI 诊断/恢复。卸载不得静默销毁尚未导出的备份或用户数据；无权限的 Workspace 不影响其他 Workspace。

**正式 v1.0 发布门槛：** 除完整 MCP 核心、GUI 基础模块、双客户端读写外，**必须有真实可用的迁移预览与可恢复的迁移操作**。不得以“CLI 能用，UI 下版再做”或“迁移按钮仅是外观”为完成标准。不要为了赶进度跳过状态机、快照、关系重建或验收。

---

## 10. 最终用户体验：自然语言指令 + 可视化管理双入口

1. “把 SilverBench 的下个版本规划放进它自己的 Workspace，并创建四条 Task。”
2. “搜索我所有 Workspace，找有哪些还处于 Testing 的 Bug，按项目汇总。”
3. “把旧 Vibecode 的 Kuru Kuru 迁到新 Kuru Kuru Workspace。先扫描和预览，不要删除任何东西。”
4. “刚才迁移中断了，恢复上一个 Job，跳过已成功创建的页面。”
5. “检查 SilverBench 的 20 条旧 Issues 是否全部迁入新数据库，关联的两个 Release 是否有效。”
6. “我新建了 Blenderboo Workspace，帮我连接并把 BB 项目映射过去。”
7. “把旧 Vibecode 项目档案设为归档”→ **必须生成影响范围并请求批准，不能直接执行。**

同等重要的 GUI 操作：打开 Notion Hub → 在 Workspaces 点击 Add → 验证授权 → 在 Project Routing 将 `SB` 指向新 SilverBench → 在 AI Clients 测试 Claude/Codex → 在 Migration Manager 选择 `Vibecode → SilverBench`，查看快照与预览、批准执行、检查验证报告。**整个常见流程不应要求用户打开命令行。**

---

## 11. 交给 Claude Code / Codex 的执行提示（可直接复制）

> 请从这份文档实施 **Unified Notion MCP + Windows Notion Hub GUI**，不要做成仅能从命令行运行的 MCP。严格采用官方 MCP TypeScript SDK v2、Notion API `2026-03-11`，桌面使用 **Tauri 2 + React + TypeScript**，并打包 Node MCP 后端为 Windows sidecar / 服务。**Milestone 0 就建立可运行 GUI，Milestone 1 必须实现 GUI 的 Workspace 授权、Project Routing、Claude Code / Codex 配置与真实 MCP 连通测试；Migration Manager 的预览与执行功能按 Milestone 3–4 完成。** GUI 是主要用户入口，CLI 仅备用。必须支持服务状态、系统托盘、可选开机自启、日志/错误诊断、迁移进度、恢复与报告。前端不能直接保存 token，全部凭证进 Windows 安全凭证库，操作须经过服务端权限验证和 Approval Gate。不得自动修改或迁移我正在使用的 Vibecode / Honour 数据；先用测试 Workspace 验证 CRUD、路由和权限。每个里程碑列出实现细节和测试用例，完成代码、自动化测试、真实 GUI 操作验证、实际 MCP Tool 调用、提交与验收记录。迁移必须 dry-run、快照、旧新 ID 映射、关系重建、附件处理、幂等重试与逐项对账；切换项目 Workspace 之前由我明确批准。Notion API 不支持的操作须标明限制，不得模拟成功结果。

---

## 12. 技术来源与版本校验

- Notion 官方 API Integration 权限/创建： https://www.notion.com/help/create-integrations-with-the-notion-api
- Notion 官方 Workspace 切换与迁移： https://www.notion.com/help/create-delete-and-switch-workspaces
- Notion API 页面移动限制： https://developers.notion.com/reference/move-page
- Notion API 版本管理： https://developers.notion.com/reference/versioning
- Notion API Rate limits： https://developers.notion.com/reference/request-limits
- Notion API Markdown： https://developers.notion.com/reference/retrieve-page-markdown
- Notion API File Upload： https://developers.notion.com/reference/file-upload
- Notion API Data Source： https://developers.notion.com/reference/create-a-data-source
- MCP TypeScript SDK v2： https://github.com/modelcontextprotocol/typescript-sdk
- Claude Code MCP： https://code.claude.com/docs/en/mcp
- Codex MCP： https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- Anthropic API MCP connector： https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- OpenAI API Remote MCP： https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- ChatGPT 自建 MCP 套餐/权限： https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt

**声明：** 此文档是设计与实施规格；新增 Windows GUI 是**开发要求**，不是已经交付的功能。当前并未新建 Notion Workspace、开发/部署 GUI 或 MCP 服务器、迁移数据、验证外部客户端的真实运行状态。需要完成开发后逐项验收。

## 13. 2026-11-21 变更：移除群聊与自动唤醒

2026-11-16 曾加入 Workspace 群聊与自动唤醒（Agent Messenger）。2026-11-21 起改用每个项目的 Notion 普通页面留言板：Claude、Codex 只在用户发起任务后通过 MCP 读写，留言不会触发 turn。本地群聊、@ 唤醒、原生会话桥及其管理入口均已移除；历史设计见 git 记录与 `docs/plans`、`docs/qa` 中的旧文档。
