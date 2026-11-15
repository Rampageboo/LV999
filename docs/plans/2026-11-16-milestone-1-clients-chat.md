# Milestone 1 — AI Clients 与 Workspace 群聊

Owner 要求：接通 Claude Code/Codex 配置检测、生成与 MCP 握手；把附件 Messenger 功能纳入产品，并确保每个 Workspace 都有群聊、Workspace 页面可进入、另有按 Project 组织的独立 Chats 总览。真实 Notion 验收继续等测试 Workspace。

Owner 将交付顺序交给实现方安排。本轮完成客户端接入和可用的持久化群聊基础；自动唤醒后续以原生会话能力和明确权限为前提推进，不启动模型 turn、不消耗模型额度，也不宣称完整 Messenger T01–T20 已通过。

## 决定与范围

- 每个 Workspace 一个群组，Project 是消息主题和总览维度；同一条消息不复制散落到多个项目。保留路由变更前后的历史及原 Workspace 上下文。
- User / Claude / Codex 各有独立未读回执。摘要、推送或握手不等于 Agent 已读；Read 不等于 Ack/Done。普通 @ 文本不唤醒；结构化 mention 在本阶段明确返回未支持。
- MCP 启动配置固定发送者角色并显式列出允许的 Workspace；模型工具参数不能冒充发送者。此为单用户本地接口权限，不是同 OS 账户恶意进程隔离或原生模型身份认证。
- 客户端检测只读取已知 user-scope 配置并返回自身 LV999 条目的状态，不暴露其它配置内容。生成片段，Owner 合并；不覆盖现有全局文件。原生握手使用隔离配置和工作目录，SDK 握手与原生客户端证据分开显示。
- 本阶段仍复用私有管道和 SQLite，不提前引入无认证 HTTP/WebSocket 服务。自动唤醒、Channels/App Server session bridge、暂停/恢复、任务证据后续独立验收。

参见 [Messenger 适配规格](../agent-messenger.md)、[原生能力矩阵](../messenger-capabilities.md) 和 [验收记录](../qa/2026-11-16-milestone-1-clients-chat.md)。
