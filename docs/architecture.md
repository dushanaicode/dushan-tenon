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
  module-<id>/      tenon-module-<id>：业务模块
src-tauri/          宿主 dushan-tenon：只做装配和 Tauri 适配
src/
  lib/              纯工具、IPC 封装、Rust 生成的合同（generated/）
  kit/              UI 套件：组件、页面模板、基础令牌
  core/             共享基础设施：契约类型、外观桥、认证状态、i18n、IPC 错误、模块启用、可见性、设置原语、任务/字典/导入导出
  visual/           视觉子系统：特效引擎与主题，可整体裁剪
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
| modules/<id> | lib、kit、core、本模块；demo 另可导入 ai |
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
- 模块只依赖 framework 与声明过的模块：都可以依赖 account；demo 另依赖 ai。
- `crates/` 下的其他 crate 只能依赖 framework 与模块，只能被宿主依赖；任何 crate 都不得依赖宿主。
- `crates/` 下每个 package 的名字都是代号加 `-` 再加目录名，即 `tenon-<目录>`。
- 宿主只做装配与 Tauri 适配；与 Tauri 无关的服务放在 framework 子模块或宿主之外的 crate，便于脱离 Tauri 测试和复用。
- 启动流程用分阶段的类型化构建表达先后顺序，不靠 `Option` 字段加运行时 `unwrap` 维持。

## 规模护栏

- 单个函数不超过 300 行，测试代码除外。Rust 由 Clippy 的 `too_many_lines` 检查，TypeScript 由 Biome 的 `noExcessiveLinesPerFunction` 检查。
- AGENTS.md 总量不超过 30KB，单行不超过 300 字。

## 检查一览

| 检查 | 位置 | 内容 |
|---|---|---|
| check-structure | `scripts/check-structure.mjs` | 前端分层、Rust 依赖方向与 crate 命名、全局变量访问点、DOM 查询、品牌拼音的出现形式、AGENTS.md 体量 |
| check-identity | `scripts/check-identity.mjs` | 产品身份与包名、库名、页面标题一致 |
| Clippy、Biome | `clippy.toml`、`biome.json` | 函数长度与常规 lint |

所有检查都接入 `pnpm check`，违规数必须为零。
