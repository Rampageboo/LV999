# LV999

Windows 上统一管理多个 Notion Workspace 的本地工具：一个 MCP 后端为 Claude Code 和 Codex 提供跨 Workspace 的读写与项目路由，一个 Tauri 桌面界面负责连接授权、项目映射、客户端配置、迁移预览与日志。

> 状态：Milestone 0 只读工程预览。七页原生 GUI、共享后端与 Windows 安装/卸载已验证；真实双测试 Workspace 连通和独立无 Node 环境仍待验收，尚非完整 Milestone 0 通过。

- 规格：[docs/spec.md](docs/spec.md)
- 起步计划：[docs/plans/2026-11-16-bootstrap.md](docs/plans/2026-11-16-bootstrap.md)
- 构建、启动与安全测试授权：[docs/setup-windows.md](docs/setup-windows.md)
- API 支持矩阵：[docs/api-capabilities.md](docs/api-capabilities.md)
- 安全边界：[docs/security.md](docs/security.md)
- 验收记录：[docs/qa/2026-11-16-milestone-0.md](docs/qa/2026-11-16-milestone-0.md)

开发：`npm ci` → `npm run desktop`。构建：`npm run package:desktop`。前端单独运行时会明确显示后端不可用；实际功能通过 Tauri 原生 IPC 连接随包 Node。

## 关于旧 LV999

本仓库原为旧 LV999（C#/WPF 多模型 Agent 工作台）的公开发布渠道。旧产品已停止维护，其安装包与发布已移除；新 LV999 与它不共享代码、更新格式或本机数据。装有旧版的电脑请先在 Windows“应用”中卸载旧 LV999。
