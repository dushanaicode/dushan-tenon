# Dushan Tenon（渡山榫卯）

可装配的单人桌面工具底座：Rust + Tauri 2 + React / TypeScript。

> 当前处于骨架阶段：只有一个空窗口和分层检查，功能正在按依赖顺序迁入，暂不可用。

## 环境要求

- Windows 10 / 11（WebView2）
- Node.js 24，pnpm 11.16.0
- Rust stable 1.98 或更新版本

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm install` | 安装依赖 |
| `pnpm dev` | 启动开发窗口 |
| `pnpm build` | 构建可执行文件（不生成安装包） |
| `pnpm check` | 运行全部检查 |
| `pnpm test` | 运行单元测试 |

在 PowerShell 中请使用 `pnpm.cmd`。

## 文档

- [架构与分层规则](docs/architecture.md)
- [协作规则](AGENTS.md)

## 许可

[MIT](LICENSE)
