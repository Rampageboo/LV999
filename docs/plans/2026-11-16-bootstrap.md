# LV999 起步计划

## 目标

按 [规格](../spec.md) 的 Milestone 0 建立可运行的工程：Tauri 2 + React + TypeScript 桌面界面、Node MCP 后端（MCP TypeScript SDK v2、`@notionhq/client`，Notion API `2026-03-11`），两个测试 Workspace 只读连通，界面各页面存在且状态来自后端。完成标准见规格第 9 节 Milestone 0 的验收。

## 已定

- **身份。** 显示名 `LV999`；内部标识必须与旧 LV999 不同：Tauri `identifier` 用新的反向域名（例如 `com.rampageboo.lv999`），数据目录、单实例锁、托盘与开机启动项都不得使用旧版的名字或 `%LOCALAPPDATA%\LV999`。理由：旧版可能仍残留在机器上。
- **图标。** 沿用 `assets/LV999.ico`，由它生成 Tauri 所需尺寸。
- **发布与更新。** 与 Silverbench、Nihilux 一致：公开仓库，GitHub Actions 中用 `tauri-action` 构建 NSIS 安装包，`tauri-plugin-updater` 读取本仓库 release 的 `latest.json`，签名密钥放 Actions secrets。参照 `Rampageboo/Silverbench` 的 `.github/workflows/release.yml` 与 `apps/desktop/src-tauri/tauri.conf.json`；LV999 生成自己的签名密钥，不复用 Silverbench 的。不使用 Velopack，不接旧版的更新通道。
- **机密不入库。** Notion token 只进 Windows 凭证库；Workspace、页面与数据源 ID 是本机运行时配置，不写进代码、测试夹具或文档。仓库是公开的。
- **不碰真实数据。** 开发与测试只用测试 Workspace；Vibecode、Honour 只读，且在 Milestone 3 之前不读。

## 待实现方决定

- 工程骨架：可参考 `Rampageboo/ai-dotfiles` 标签 `archive/pre-skills-repo` 下的 `tools/claude-codex-mcp/desktop`（Tauri 2 + React + TS + Node bridge，`scripts/prepare-runtime.mjs` 似乎处理 Node 运行时打包）。只取工程结构与打包做法，业务代码不要；用之前先确认它确实能在未装 Node 的机器上运行。
- 目录结构、包管理器、Node sidecar 的打包方式，在满足规格第 8 节“GUI/CLI/MCP 共用同一后端”的前提下自定。

## 待 Owner 决定

- **先迁移还是先做界面。** Claude 的意见：迁移是一次性的（5 个项目、31 条 Issue、4 条 Release），可以先用脚本按规格第 5 节的规则迁移 Kuru Kuru 验证，不必等界面完成；界面按里程碑推进。

## 风险

- Node sidecar 随 Tauri 安装包分发（规格第 8 节“打包关键点”）是最大的未知项，应在 Milestone 0 就验证。
- 旧 LV999 未卸载的机器上，若误用旧标识会与残留状态冲突。

## 验证

- 规格 Milestone 0 验收项逐条通过。
- 在未安装 Node.js 的 Windows 环境中，安装包能启动后端。
- `git grep` 确认仓库中没有 token、Notion 页面或数据源 ID。

## Milestone 0 进度（2026-11-16）

工程部分已实现并在现有 Windows 主机通过构建、25 项自动化测试、真实 MCP v2 握手/调用、七页原生 GUI 巡检和安装/卸载检查。详见 [验收记录](../qa/2026-11-16-milestone-0.md)。

Owner 已确认两个测试 Workspace 尚未创建，本轮先完成可验证的工程部分。因此 **Milestone 0 整体尚未验收通过**：真实双空间只读连通，以及独立无 Node 的 Windows 环境安装仍待完成。现有主机已验证清空系统 Node PATH 后，安装版和独立暂存后端均能使用随包 runtime。

## 双测试空间后续验收（2026-11-19）

两个测试空间已完成真实 OAuth、身份/搜索/页面读取、双向跨空间页面拒绝及重启持久化检查；页面浏览和群聊总览也已在原生 GUI 观察。已修复真实 API 的页面字段兼容与错误后 OAuth 类型丢失问题，113 项测试及 Windows CI 通过，最终预览已打开。见 [验收记录](../qa/2026-11-19-real-oauth.md)。独立干净 Windows GUI 环境的无 Node 安装仍是未完成项，不据此宣称 M0/M1 整体通过。
