# LV999

Windows 上统一管理多个 Notion Workspace 的本地工具：一个 MCP 后端为 Claude Code 和 Codex 提供跨 Workspace 的读写与项目路由，一个 Tauri 桌面界面负责连接授权、项目映射、客户端配置、迁移预览与日志。

> 状态：Milestone 1 开发中。两个测试 Workspace 已完成真实 OAuth、身份/搜索/页面读取及跨空间拒绝验证，页面浏览和群聊总览已实测。Windows CI 已通过 113 项测试，最终便携版已在本机打开。Notion 内容仍只读；真实路由变更、token 刷新/撤销、Claude 模型验收、独立无 Node 环境及其余 CRUD 仍待验证或实现。

- 规格：[docs/spec.md](docs/spec.md)
- 起步计划：[docs/plans/2026-11-16-bootstrap.md](docs/plans/2026-11-16-bootstrap.md)
- 构建、启动与安全测试授权：[docs/setup-windows.md](docs/setup-windows.md)
- API 支持矩阵：[docs/api-capabilities.md](docs/api-capabilities.md)
- 安全边界：[docs/security.md](docs/security.md)
- 验收记录：[docs/qa/2026-11-16-milestone-0.md](docs/qa/2026-11-16-milestone-0.md)
- Workspace GUI 进度：[docs/qa/2026-11-16-milestone-1-workspaces.md](docs/qa/2026-11-16-milestone-1-workspaces.md)
- 页面浏览与路由进度：[docs/qa/2026-11-16-milestone-1-routing.md](docs/qa/2026-11-16-milestone-1-routing.md)
- 客户端与群聊进度：[docs/qa/2026-11-16-milestone-1-clients-chat.md](docs/qa/2026-11-16-milestone-1-clients-chat.md)
- OAuth 进度及构建阻塞（历史记录，其中的唤醒功能已移除）：[docs/qa/2026-11-16-milestone-1-wake-oauth.md](docs/qa/2026-11-16-milestone-1-wake-oauth.md)
- Windows CI 构建与原生启动：[docs/qa/2026-11-16-windows-ci-oauth.md](docs/qa/2026-11-16-windows-ci-oauth.md)
- 真实 OAuth 与双测试空间只读验收：[docs/qa/2026-11-19-real-oauth.md](docs/qa/2026-11-19-real-oauth.md)

开发：`npm ci` → `npm run desktop`。构建：`npm run package:desktop`。前端单独运行时会明确显示后端不可用；实际功能通过 Tauri 原生 IPC 连接随包 Node。

## 关于旧 LV999

本仓库原为旧 LV999（C#/WPF 多模型 Agent 工作台）的公开发布渠道。旧产品已停止维护，其安装包与发布已移除；新 LV999 与它不共享代码、更新格式或本机数据。装有旧版的电脑请先在 Windows“应用”中卸载旧 LV999。
