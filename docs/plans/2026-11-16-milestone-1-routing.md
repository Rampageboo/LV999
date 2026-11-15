# Milestone 1 — 页面浏览与 Project Routing

Owner 范围：接通可访问页面浏览、Project Routing GUI 和共享后端；真实验收继续等待两个测试 Workspace。不得读取 Vibecode/Honour 或将模拟响应当作真实验收。

## 已定实现

- 页面浏览按精确 Workspace 调用官方 SDK 的 page-only search，支持标题查询、分页、刷新、去重和直接页面链接/ID 检查。搜索有索引延迟且不完整，必须在界面说明；不把此功能描述为全量发现或页面内容编辑器。
- Route 的稳定身份是规范化且唯一的 Project Key。名称可重名，但按名称解析必须唯一，否则 `AMBIGUOUS_TARGET`，不得猜测 Workspace 或页面。
- 根页面须为当前凭证可读取、未归档/入垃圾箱的普通页面；数据库记录与项目独立说明页分开处理。保存及解析均重新检查 Workspace 身份和页面；不依据标题或前端缓存直接保存。
- 编辑保留 Key，明确选择新目标；切换 Workspace 清空旧根页面。SQLite revision 校验和事务审计防止旧编辑覆盖新配置。配置不是 Notion 写权限，也不是迁移切换批准。
- GUI/CLI/MCP 共用后端。MCP 新增只读 `list_projects`、`resolve_project`；本地映射保存由 GUI 或显式 CLI 执行，Notion 内容仍只读。

## 验证

单元/SDK 合约检查涵盖分页、身份混用、无权限页面、记录/归档根限制、重名、并发旧版本和解析期间变更。原生测试替换 Notion HTTP，在临时应用副本中使用真实 IPC、SQLite 与一次性 Windows 凭证；测试页面选择、编辑、切换、错误、重启及 MCP 解析后清理。

验收记录：[页面浏览与路由](../qa/2026-11-16-milestone-1-routing.md)。真实双空间、独立无 Node 环境和其余 M1 CRUD/客户端集成继续待补。
