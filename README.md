# Dushan Tenon（渡山榫卯）

可装配的单人桌面工具底座：Rust + Tauri 2 + React / TypeScript。

> 当前基础版包含 account、notify、files、devtools、demo 五个模块及演示中心，不含 AI。外观仅提供标准主题的浅色、深色与跟随系统。

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
| `pnpm bundle` | [构建 Windows NSIS 安装包](docs/release.md) |
| `pnpm preset` | 从 minimal、tool、full 预设创建配置 |
| `pnpm check` | 运行全部检查 |
| `pnpm test` | 运行单元测试 |

在 PowerShell 中请使用 `pnpm.cmd`。

## 文档

- [架构与分层规则](docs/architecture.md)
- [模块与装配](docs/modules.md)
- [命令与 IPC](docs/ipc.md)
- [配置文件与设置](docs/settings.md)
- [数据、任务与恢复](docs/data.md)
- [原生能力](docs/native.md)
- [前端合同与扩展](docs/frontend.md)
- [安装包构建与发布](docs/release.md)
- [协作规则](AGENTS.md)

## 许可

[MIT](LICENSE)
