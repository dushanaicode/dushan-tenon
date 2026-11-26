# 架构与分层规则

本文是 Dushan Tenon 分层与命名规则的正文，由 `pnpm check` 中的检查强制执行；AGENTS.md 只保留摘要。

## 命名

- 产品身份的唯一来源是 `src-tauri/tauri.conf.json`：产品名 `Dushan Tenon`（中文名渡山榫卯），程序 `dushan-tenon`，identifier `com.dushan.tenon`。
- 代码代号取 identifier 的最后一段，即 `tenon`。crate 前缀 `tenon-`、环境变量 `TENON_*`、前端全局变量 `__TENON_*__`、DOM 事件 `tenon:` 都由它派生，检查脚本也从身份读取，不写死名字。
- 品牌拼音（渡山）只许以产品身份的形式出现：identifier 及以它加 `.` 开头的标识，程序名及以它加 `.` 或 `-` 开头的标识，程序名的下划线形式及以它加 `_` 开头的标识，产品名原文。此外只允许检查脚本里登记的账号名与代码出处名。旧项目的标识一律不得出现。

## 目录结构

```text
crates/
  framework/        tenon-framework：内核，不依赖 Tauri 和任何模块
  desktop/          tenon-desktop：桌面应用层，配置文件模型与设置合同，不依赖 Tauri
  module-<id>/      tenon-module-<id>：业务模块
src-tauri/          宿主 dushan-tenon：只做装配和 Tauri 适配
src/
  lib/              纯工具、IPC 封装、Rust 生成的合同（generated/）
  kit/              UI 套件：组件、页面模板、基础令牌
  core/             共享基础设施：契约类型、外观桥、认证状态、i18n、IPC 错误、模块启用、可见性、设置原语、任务/字典/导入导出
  visual/           视觉子系统：主题、背景层与氛围场景，可整体裁剪
  shell/            外壳：布局、导航、命令面板、窗口控件
  modules/<id>/     前端业务模块
  app/              组合根：入口、路由、模块注册表、设置页装配
public/  presets/  scripts/  docs/  vendor/
Temp/               构建产物与临时文件（Git 忽略）
```

目录在有代码时才建立，不建占位文件；规则对尚未出现的目录同样生效。

## 前端依赖方向

| 层 | 可以导入 |
|---|---|
| lib | 无 |
| kit | lib |
| core | lib、kit |
| visual | lib、kit、core |
| shell | lib、kit、core |
| modules/<id> | lib、kit、core、本模块 |
| app | 全部 |

- 按文件路径判断所在层。静态导入、`export … from`、动态 `import()` 与 `import type` 都计入；动态导入的路径必须是字符串字面量。
- `src/` 下的每个源文件都必须属于上表中的一层；`src/main.tsx` 属于 app。
- 测试文件遵守同样的方向。测试辅助放在能提供它的最低一层，命名为 `*.test-support.ts(x)`。
- 模块注册表只由 app 读取，再通过 props 或 context 交给 shell 与 core，避免组合根与基础设施互相依赖、形成导入环。
- 跨层共享的契约类型（模块清单、导航徽标、对象引用、懒加载组件）放在 `src/core/contracts/`。
- visual 只由 app 挂载。删除 `src/visual/` 与 app 中的挂载点即可裁剪视觉子系统；kit 只派发类型化的 DOM 事件，不依赖 visual。
- `window.__TENON_*__` 在 `src/` 下只能出现在外观桥 `src/core/appearance-bridge.ts` 及其同名的 `.test.ts`、`.test-support.ts` 中，其他代码经外观桥读取。首屏脚本 `public/` 与宿主注入脚本不受此限。
- shell、app、modules 的非测试代码不得用 `document.querySelector`、`document.getElementById` 一类的查询驱动焦点或状态，改用 ref、context 或焦点注册表。确需例外的，登记在检查脚本的白名单里并写明原因；不再命中的白名单条目同样报错。
- 自定义 DOM 事件经类型化事件通道收发，事件名用 `tenon:` 前缀。

## CSS 级联

- 层序由 `src/app/styles.css` 的第一条语句声明：`theme, base, components, utilities, appearance-defaults, appearance-themes, appearance-system, appearance-overrides, appearance-a11y`。
- 主题共用的规则（例如隐藏系统标题栏时的窗口控件）只写一次，放在 `appearance-system` 层；主题 CSS 不得靠叠写同一属性选择器来提高特异性。

## Rust 依赖方向

- 只有宿主 `src-tauri` 可以依赖 `tauri` 与 `tauri-*`。
- `tenon-framework` 不依赖任何 `tenon-*` crate。
- 模块只依赖 framework 与 account（account 自身只依赖 framework）；模块之间没有其他依赖。
- `crates/` 下的其他 crate 只能依赖 framework 与模块，只能被宿主依赖；任何 crate 都不得依赖宿主。
- `crates/` 下每个 package 的名字都是代号加 `-` 再加目录名，即 `tenon-<目录>`。
- 宿主只做装配与 Tauri 适配；与 Tauri 无关的服务放在 framework 子模块或宿主之外的 crate，便于脱离 Tauri 测试和复用。
- 启动流程用分阶段的类型化构建表达先后顺序，不靠 `Option` 字段加运行时 `unwrap` 维持。
- framework 只放通用内核。产品语义放在上层：配置文件模型、设置合同、外观轴、窗口与托盘等原生设置在 desktop；文件选择令牌在宿主的命令入口解析；通知渠道与免打扰在 notify 模块。
- framework 不含产品身份（identifier、程序名、产品名），需要时由上层传入，例如凭据库服务名、缓存键前缀；可以使用代号 `tenon`，例如环境变量前缀与备份格式名。

### framework 内部分层

framework 的顶层模块自下而上排列如下，每个模块只能引用排在它前面的模块（模块内部的引用不受限）：

| 序 | 模块 | 职责 |
|---|---|---|
| 1 | error | 错误码与错误类型 |
| 2 | id | UUIDv7 标识 |
| 3 | time | 时间戳 |
| 4 | actor | 执行主体与执行上下文 |
| 5 | dict | 字典声明与 `dict_enum!` |
| 6 | i18n | 翻译端口与语言 |
| 7 | secret | 秘密存储 |
| 8 | network | 代理与 TLS 校验策略 |
| 9 | maintenance | 操作准入、维护独占与关闭排空 |
| 10 | bootstrap | 启动步骤与逆序关闭 |
| 11 | instance | 实例标识 |
| 12 | logging | 日志 |
| 13 | db | 数据库连接、查询、事务与迁移执行 |
| 14 | migrations | framework 自己的数据库迁移 |
| 15 | cache | 缓存与锁 |
| 16 | param | 声明式参数 |
| 17 | file | 本机文件存储 |
| 18 | stream | 有序事件流 |
| 19 | job | 持久任务与计划 |
| 20 | exchange | 导入导出 |
| 21 | backup | 备份、恢复与诊断包 |
| 22 | ipc | 命令入口：身份、权限与准入 |
| 23 | module | 模块声明、注册与生命周期 |

- `crate::<模块>` 路径、跨出本模块的 `super::`、`#[macro_export]` 宏的使用都算引用；测试代码同样遵守。
- `lib.rs` 只声明表中的模块；每个模块的根文件以 `//!` 模块说明开头。
- 汇总只在 module 做，例如全部错误码、内置字典；底层模块只定义自己的项。
- 错误码一律三段：`<所属>.<领域>.<名称>`；framework 与宿主的错误码以 `app.` 开头。

## Rust 代码约束

- 生产代码不用 `unwrap`、`expect`、`panic!`、`unreachable!`、`todo!`、`unimplemented!`，由 Clippy 拦截；测试代码可以用 `unwrap`、`expect`、`panic!`。确属不变量、又无法用类型表达的，用 `#[expect(clippy::<lint>, reason = "…")]` 写明理由，不用 `#[allow]`。
- 锁中毒按内部错误返回；析构函数里不 panic。
- 公开接口只暴露有外部消费者的项，其余用 `pub(crate)` 或更窄的可见性；没有消费者的代码删除。
- 迁移 SQL 一经发布不再改动：结构变化只新增迁移，已锁定的快照字节不重写。

## 规模护栏

- 单个函数不超过 300 行，测试代码除外。Rust 由 Clippy 的 `too_many_lines` 检查，TypeScript 由 Biome 的 `noExcessiveLinesPerFunction` 检查。Clippy 也检查测试目标，超长的测试用 `#[expect(clippy::too_many_lines, reason = "…")]` 标明。
- AGENTS.md 总量不超过 30KB，单行不超过 300 字。

## 检查一览

| 检查 | 位置 | 内容 |
|---|---|---|
| check-structure | `scripts/check-structure.mjs` | 前端分层、Rust 依赖方向与 crate 命名、framework 内部分层与模块说明、framework 不含产品身份、全局变量访问点、DOM 查询、品牌拼音的出现形式、AGENTS.md 体量 |
| check-identity | `scripts/check-identity.mjs` | 产品身份与包名、库名、页面标题、凭据库服务名、缓存键前缀默认值一致 |
| check-ipc | `scripts/check-ipc.mjs` | 生成合同的文件集合与逐字节一致、命令准入分类、双语翻译键齐全 |
| check-kit | `scripts/check-kit.mjs` | 十条套件规则：不用原生表格、对话框、下拉与消息框，不导入 kit 内部或底层引擎，确认按钮与对话框标题齐全，不用裸滚动容器与视口断点 |
| check-release | `scripts/check-release.mjs` | `src-tauri/release.json` 是唯一发行来源；三处版本一致；tauri.conf.json 的更新器字段无漂移 |
| check-licenses | `scripts/check-licenses.mjs` | 依赖许可在白名单内或有登记的例外；vendor 目录有许可文件并在 `THIRD_PARTY_NOTICES.md` 声明 |
| Clippy、Biome | `Cargo.toml`、`clippy.toml`、`biome.json` | 函数长度、生产代码不 panic 与常规 lint |

所有检查都接入 `pnpm check`，违规数必须为零。
