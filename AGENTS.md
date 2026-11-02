# Dushan Tenon 协作规则

Dushan Tenon（渡山榫卯）是可装配的单人桌面工具底座：Rust + Tauri 2 + React / TypeScript。本文件只写短规则，每条一行；合同细节写进 `docs/`，这里只放链接。

## 工作方式

- 若存在本地协作总线 `.docs/`（Git 忽略），先读其 README、STATUS 与相关决定，再核对分支和工作区。
- 在 `main` 开发；GitHub 为来源，Gitee 为单向同步目标；不强推、不传播删除。
- 采用满足需求的最小改动；按明确契约实现，不加推测性默认值、兼容入口、旧名别名或无消费者的抽象。
- 新增依赖须宽松许可且发布满 14 天，先报告库名、用途、维护情况与许可再加；npm 直接依赖用精确版本。
- 凭据、运行数据和私钥不得进入源码、提交或日志。

## 分层（正文见 [docs/architecture.md](docs/architecture.md)）

- 前端按 lib → kit → core → visual / shell / modules → app 单向依赖；`import type` 也算依赖。
- 模块之间不互相导入，唯一例外 demo → ai；模块注册表只由 app 读取，经 props 或 context 下发。
- `window.__TENON_*__` 在 `src/` 下只出现在外观桥 `src/core/appearance-bridge.ts` 及其同名测试中，其余代码经外观桥读取。
- shell、app、modules 不用 `document.querySelector` 等 DOM 查询驱动焦点或状态；例外登记在 check-structure 白名单并写明原因。
- 自定义 DOM 事件经类型化事件通道收发，事件名用 `tenon:` 前缀。
- Rust：只有宿主 `src-tauri` 依赖 `tauri*`；framework 不依赖任何 `tenon-*`；模块只依赖 framework 与声明的模块（都可依赖 account，demo 另依赖 ai）。
- framework 内部按架构文档的模块顺序单向引用，汇总（错误码、内置字典）只在 module；不含产品身份与应用语义。
- desktop（tenon-desktop）承载配置文件模型与设置合同，不依赖 Tauri，只被宿主依赖。
- 单个函数不超过 300 行，测试代码除外；本文件总量不超过 30KB、单行不超过 300 字。

## 命名

- 产品名 Dushan Tenon，中文名渡山榫卯；仓库与程序 `dushan-tenon`；identifier `com.dushan.tenon`。身份唯一来源是 `src-tauri/tauri.conf.json`。
- 代码代号 `tenon`（identifier 最后一段）：crate 用 `tenon-*`，`crates/` 下的 package 名为 `tenon-` 加目录名；环境变量 `TENON_*`；前端全局变量 `__TENON_*__`。
- 品牌拼音（渡山）只许以产品身份的形式出现（identifier、程序名、产品名），另有 check-structure 里登记的账号与出处；旧项目的标识一律不得出现。

## 工程

- 技术栈：Rust stable ≥ 1.98（edition 2024）、Tauri 2、React 19、TypeScript strict、Vite、Tailwind CSS 4；Node 24，pnpm 固定 11.16.0。
- 命令：`pnpm dev` 开发窗口，`pnpm build` 构建可执行文件，`pnpm check` 全部检查，`pnpm test [目标...]` 单元测试；PowerShell 用 `pnpm.cmd`。
- 自动化代理先加载 `node scripts/environment.mjs` 输出的隔离环境，再运行 pnpm 或 cargo；不重写 HOME 或 USERPROFILE。
- 构建输出与缓存放 `Temp/`；Tauri 固定生成的 `src-tauri/gen/` 是唯一例外，已被 Git 忽略。
- 测试辅助放在能提供它的最低一层，命名为 `*.test-support.ts(x)`。
- Rust 生产代码不用 `unwrap`、`expect`、`panic!`、`unreachable!`、`todo!`、`unimplemented!`（Clippy 拦截）；确属不变量的用 `#[expect(lint, reason = "…")]`，不用 `#[allow]`。
- 错误码一律三段 `<所属>.<领域>.<名称>`；迁移 SQL 发布后不改，结构变化只新增迁移。
- 验证默认只跑与改动相关的定向测试和 `pnpm check`；全量测试只在维护者要求时运行。
- 每轮完成后按改动风险检查结构、import、格式与受影响行为，如实记录验证结果与限制，不以文件存在代替功能完成。
