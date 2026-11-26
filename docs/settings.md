# 配置文件与设置

配置分为设备和应用启动配置、声明式业务参数、秘密三类。启动配置由 desktop 建模，业务参数由模块声明，秘密由专用存储读取；设置页消费这些合同，不持有任意键写文件的能力。

## 状态目录

桌面程序依次使用 `--state-root`、`TENON_STATE_ROOT`、平台应用数据目录选择状态根。显式空路径、父级跳转和目录链接会被拒绝。数据库工具要求显式状态根，不能回退到用户数据目录。路径选择见 [state_root.rs](../crates/desktop/src/state_root.rs)，桌面参数见 [boot.rs](../src-tauri/src/boot.rs)。

状态根承载 `config.toml`、数据库、本机文件、日志和原生状态，详见[数据](data.md)。开发命令固定使用 `Temp/dev-state`。自动化运行应明确指定独立状态目录，并按仓库规则加载 `scripts/environment.mjs`，将临时与缓存目录放在 `Temp/`；不改写用户 home。

## 配置来源与锁定

加载优先级为：内置默认值 → `config.toml` → `TENON__` 环境变量 → 可重复的 `--set`。环境变量用双下划线分隔段和键；命令行用点分隔，例如 `--set ui.theme=dark`。模块开关使用完整三段叶子路径，例如 `--set modules.demo.enabled=false`。

加载器严格拒绝未知字段和非法值；缺少文件时使用默认值，不在读取阶段创建文件。[loader](../crates/desktop/src/config/loader/mod.rs)只接收宿主显式传入的环境和覆盖列表。

设置返回值附带 `source`：`default`、`file`、`environment`、`commandLine`。环境和命令行覆盖的键只读，保存或重置返回 `app.settings.overridden`，即便提交值等于当前值也不能写回覆盖它。[source.rs](../crates/desktop/src/config/source.rs)定义此合同。

设置通过具体更新 DTO 提交，校验本次变更并在同目录原子替换成功后更新内存；保留未改字段及相关注释，见 [persist.rs](../crates/desktop/src/config/persist.rs)。手工编辑启动配置后重启，不能把文件修改当作已更新运行内存。

## 配置项入口

以下表给出基础版配置的主要边界；完整字段由链接中的类型定义，连接细节见[数据](data.md)和[原生能力](native.md)。

| 配置段或键 | 合同与实现 |
|---|---|
| `auth.mode` | `none` 或 `login`；唯一所有者与应用锁。认证策略包括会话时长、验证码及失败锁定阈值，见 [module.rs](../crates/desktop/src/config/module.rs) |
| `modules` | 各模块的 `enabled` 开关；启动校验依赖，见[模块](modules.md) |
| `ui.language` | `zh-CN` 或 `en-US` |
| `ui.theme` | 颜色模式：`light`、`dark`、`system`，见 [appearance.rs](../crates/desktop/src/config/appearance.rs) |
| `ui.theme_style` | 视觉主题：`standard`、`ink`、`cyber`，见[主题与外观](#主题与外观) |
| `ui.accent`、`ui.density`、`ui.motion` | 强调色（只用于标准主题）、密度（`comfortable` 或 `compact`）、动效开关 |
| `ui.developer_mode` | 开发入口及演示业务的可用条件；变更要求活动身份 |
| `logging.level`、`logging.retention_days` | 日志等级与保留策略，见 [logging](../crates/framework/src/logging/mod.rs) |
| `notify.desktop` | 桌面通知总开关；通知偏好另属模块参数 |
| `window.restore_state`、`window.titlebar`、`window.close_action` | 窗口状态恢复、系统标题栏、关闭行为，见 [native.rs](../crates/desktop/src/config/native.rs) |
| `tray.enabled`、`autostart.enabled`、`shortcuts.show_main` | 托盘、自启意图、显示主窗口的全局快捷键；系统实际状态另行返回 |
| `network.proxy_mode`、`network.proxy_endpoint`、`network.proxy_auth` | 显式 HTTP 代理配置；凭据不写此文件 |
| `updater.check_on_start` | 启动更新检查；未配置发行源时不可启用 |
| `database` | SQLite 或远端 MySQL/PostgreSQL；远端密码只配置秘密键，见 [database loader](../crates/desktop/src/config/loader/database.rs) |
| `cache` | 本地缓存或 Redis，见 [cache loader](../crates/desktop/src/config/loader/cache.rs) |
| `jobs.max_concurrency`、`jobs.lease_seconds` | 任务执行器并发与租期，见 [JobsConfig](../crates/framework/src/job/config.rs) |

新状态可用 `pnpm preset` 创建配置，见[预设](modules.md#预设与运行时禁用)。外观部分的默认值为：

```toml
[ui]
language = "zh-CN"
theme = "system"
theme_style = "standard"
accent = "neutral"
density = "comfortable"
motion = true
developer_mode = false
```

## 声明式参数与秘密

[ParamDeclaration](../crates/framework/src/param/mod.rs)声明键、分组、排序、类型、默认值、读写权限与生效时机。支持文本、整数、布尔、枚举选择和秘密；类型边界在注册和写入时校验。参数来源仅有默认值与数据库，不沿用启动配置覆盖链。

普通值由 [ParamStore](../crates/framework/src/param/store.rs)持久化，返回行版本供并发更新检查。生效时机由使用方遵守：`NextRead` 表示下一次读取，`NextJob` 表示任务开始时读取一次。当前 `demo.batch_size` 在[测算处理器](../crates/module-demo/src/jobs.rs)开始执行时读取，排队中的任务可能读到新值，已经运行的任务不随设置变化调整批次。`account.idle_lock_minutes` 控制空闲锁定，通知参数见 [notify 声明](../crates/module-notify/src/lib.rs)。

`app_setting_list` 按模块启用和读权限过滤；查看禁用模块参数还要求开发者模式。`app_setting_set`、`app_setting_reset` 检查写权限和版本，不能借知道键名越权。[ParamForm](../src/core/settings/param-form.tsx)根据声明生成控件，并使用[设置草稿](../src/core/settings/drafts.tsx)保存未提交编辑。

秘密参数的值与默认值在列表中始终为空，只返回是否设置等元数据；值进入系统凭据库，数据库只保留状态。通用 [SecretStore](../crates/framework/src/secret/mod.rs)先读取由秘密键派生的 `TENON_SECRET__` 环境变量，再读凭据库；存在的空值或读取错误不会回退。命名空间绑定规范化状态根，移动状态目录后不会自动获得原凭据。

数据库与 Redis 的密码键、代理凭据也经此秘密存储读取。秘密环境覆盖与普通配置来源是两套机制；不要把密码写进 `config.toml`、导出或日志。代理设置只返回凭据来源和是否设置，更新使用保留、清除或替换动作，见[代理](native.md#http-代理)。

## 设置页分节装配

分节合同位于 [settings.ts](../src/core/contracts/settings.ts)：稳定 ID、路径、翻译键、顺序、模块归属与可见性，以及组件或参数分组两种内容。当前[分节构建器](../src/app/settings/sections.ts)合并[内置分节](../src/app/settings/builtin-sections.ts)、模块清单的设置贡献与未被认领的参数组。

模块可用 `paramGroups` 认领本模块的参数组并提供专用界面；未知组、跨模块认领和重复认领均报错。未认领组自动使用参数表单。分节按顺序和 ID 排序，禁用模块或关闭开发者模式得到不可见结果，缺少权限得到禁止结果；直接访问路径也应用同一判定。

扩展设置时优先在模块声明参数；需要专用交互再在模块清单贡献分节。跨分节草稿与保存提示复用 core 设施，不把业务参数写成新的设备配置项。前端组合根说明见[前端](frontend.md#app-组合根)。

## 主题与外观

外观有五项设置，都在“设置 → 外观”里立即保存并生效，不进草稿：

- **主题**（`ui.theme_style`）：标准、水墨、赛博。水墨与赛博带背景图和缓慢的氛围场景；标准没有背景。
- **颜色模式**（`ui.theme`）：浅色、深色、跟随系统；每个主题都有浅色和深色两套颜色。
- **强调色**（`ui.accent`）：中性（默认）、天蓝、紫罗兰、翠绿、琥珀、玫瑰，只改标准主题的主色；其他主题用自带配色。
- **密度**（`ui.density`）：宽松或紧凑；紧凑只收紧控件高度、行高与间距。
- **动效**（`ui.motion`）：关闭后界面完全静止，氛围场景也停止。系统开启“减少动态效果”时同样静止，与此开关无关。

宿主在页面加载前注入设置快照；宿主注入脚本与首屏脚本 [appearance.js](../public/appearance.js) 把五项写到 `<html>`：`.dark` 类与 `data-theme-style`、`data-accent`、`data-density`、`data-motion`。前端经 [appearance-bridge.ts](../src/core/appearance-bridge.ts) 读取和更新，其他前端代码不直接访问 `__TENON_*__` 全局。原生标题栏与窗口底色按主题和明暗同步（[chrome.rs](../crates/desktop/src/native/chrome.rs) 的底色表与主题 CSS 的 `--background` 一致，窗口显示前不闪色），见 [window.rs](../src-tauri/src/window.rs)与宿主的 [chrome.rs](../src-tauri/src/native/chrome.rs)。

主题的实现在视觉子系统 `src/visual/`，合同与新增主题的步骤见[前端](frontend.md#视觉子系统与主题)。强制色彩模式下不显示背景，只用系统颜色。样式入口见 [styles.css](../src/app/styles.css)。
