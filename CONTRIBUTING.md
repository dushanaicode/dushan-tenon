# 参与贡献

[English](CONTRIBUTING.en.md)

谢谢你愿意参与 Dushan Tenon。这个项目由一个人维护，下面几条约定是为了不让你的时间白花。

## 反馈

- 问题和建议请到 GitHub 提 Issue：<https://github.com/dushanaicode/dushan-tenon/issues>。Gitee 仓库是只读镜像，Issue 和 PR 请都提到 GitHub。
- 报告 bug 时，请写上 Windows 版本和复现步骤，并附上“设置 → 关于 → 复制诊断信息”的内容。诊断信息已经脱敏，不含路径和账号。
- 安全问题不要公开提 Issue，请按[安全说明](SECURITY.md)私下报告。

## 提 PR 之前

- 错字、文档、明显的 bug，可以直接提 PR。
- 新功能或较大的改动，请先开 Issue 说明想法，商量好了再动手。
- 一个 PR 只做一件事。

## 本地跑起来

环境要求和第一次启动见 [README 第 4 节](README.md#4-本地跑起来)。简单说，在仓库根目录运行：

```powershell
pnpm install
pnpm dev
```

在 PowerShell 里请用 `pnpm.cmd`。

## 提交前检查

```powershell
pnpm check
pnpm test
```

- `pnpm check` 检查格式、lint、类型、分层结构和生成的合同；`pnpm test` 跑 Rust、前端和脚本的全部单元测试。
- 改动不大时，可以先跑相关的测试，例如 `pnpm test web:src/modules/notify`、`pnpm test rust:ipc_tests`，提 PR 前再完整跑一遍。
- 格式问题用 `cargo fmt --all` 和 `pnpm exec biome check --write .` 自动修好。
- PR 上的 CI 会在 Windows 上跑同样的两条命令，通过后才能合并。

## 提交说明

沿用现有的格式：`类型(范围): 一句话`，例如 `fix(account-ui): one centred card layout for every auth screen`。

- 类型用 `feat`、`fix`、`docs`、`test`、`refactor`；范围写改动所在的模块或目录，可以省略。
- 需要的话，空一行再写正文，说明为什么改、改了什么。
- 中文或英文都可以。

## 代码规则

完整规则见 [AGENTS.md](AGENTS.md) 和 [docs/](docs/)。最常碰到的几条：

- 用满足需求的最小改动，沿用现有写法；不加兼容层、旧名字的别名或用不上的抽象。
- 依赖单向：前端 lib → kit → core → visual / shell / modules → app，模块之间不互相导入，见[架构](docs/architecture.md)。
- 新依赖必须是宽松许可、发布满 14 天，先在 Issue 里说明用途；npm 的直接依赖写精确版本。
- 凭据、运行数据和私钥不要进入代码、提交或日志。

## 许可

你提交的内容按本仓库的 [MIT 许可](LICENSE)发布。提 PR 就表示你同意这一点，并且有权提交这些内容。
