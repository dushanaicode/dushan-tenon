# 原生能力

原生策略和状态合同位于 [crates/desktop/src/native](../crates/desktop/src/native)，Tauri 与系统适配位于 [src-tauri/src/native](../src-tauri/src/native)。只有宿主依赖 Tauri，前端通过[类型化命令](ipc.md)访问原生能力，不直接操作系统注册项或插件。

## 窗口、标题栏与关闭

主窗口 label 为 `main`。宿主先按设置创建隐藏窗口，注入首屏快照并同步明暗，页面加载完成后显示；超过十秒会触发显示期限。`window.titlebar` 支持 `native` 与 `hidden`；隐藏时由 shell 绘制窗口控件，macOS 保留其平台标题栏适配。见 [window.rs](../src-tauri/src/window.rs)与 [chrome.rs](../src-tauri/src/native/chrome.rs)。

最小化、最大化、拖动、关闭与窗口状态订阅使用 control 命令，登录页和维护期间仍可操作。宿主校验主窗口，前端通过[窗口外框](../src/shell/window/window-chrome.tsx)与[窗口控件](../src/shell/window/window-controls.tsx)接入。原生事件状态由 [WindowControls](../crates/desktop/src/native/window_controls.rs)统一协调，不能靠查询 DOM 猜测窗口状态。

`window.close_action` 有三种取值：`ask` 询问、`tray` 隐藏到托盘、`exit` 退出。隐藏到托盘必须同时设置 `tray.enabled = true`；配置校验拒绝不一致组合，托盘开关与关闭动作作为一组更新。托盘创建失败时不能把隐藏行为当作成功，实际可用状态由[托盘合同](../crates/desktop/src/native/tray.rs)返回。

关闭还经过编辑状态协调，存在未保存内容时请求前端决策，见 [window_controls.rs](../crates/desktop/src/native/window_controls.rs)与 [edit-sessions.tsx](../src/core/edit-sessions.tsx)。托盘“退出”、窗口退出和系统退出共用 [ExitController](../crates/desktop/src/native/exit.rs)：先关闭准入，再取消流、停止原生事件和任务、排空操作，按顺序释放模块、数据库及日志。回调只发起异步退出，不阻塞系统事件线程。

## 单实例与再次启动

宿主安装单实例插件，再次启动向已有进程传递显示意图和文件接入请求。二次启动显式指定的状态根必须与当前实例匹配；回调只解析可观察的命令行参数，不读取第二个进程的环境变量。已有窗口被显示和聚焦不代表会话已解锁。实现见 [application.rs](../src-tauri/src/application.rs)、[窗口二次启动处理](../src-tauri/src/window.rs)与 [instance.rs](../crates/desktop/src/native/instance.rs)。

系统文件参数、拖入文件和应用 URI 先进入[文件接入队列](../crates/desktop/src/file_ingress.rs)，再由前端选择匹配的已启用模块目标。不能把再次启动参数直接交给业务读取任意路径，见[数据](data.md#本机文件)。

## 自启与安装标记

`autostart.enabled` 是期望值；API 同时返回系统登记、启动审批与实际生效判断。期望启用不等于系统实际允许，Windows 的禁用审批不能由应用重写。

只有正式安装、未显式指定状态根且非开发运行才进入产品自启范围。Windows 与 Linux 检查可执行文件旁可读的普通文件 `tenon-installed.marker`；macOS 检查实际应用包结构。当前标记检查不解析内容；开发构建旁放一个同名目录不算已安装。范围不支持时不构造或探测系统自启登记。实现见 [autostart_scope.rs](../src-tauri/src/native/autostart_scope.rs)与 [AutostartScope](../crates/desktop/src/native/autostart.rs)。

自启变更包含系统登记、配置落盘和失败补偿；补偿失败会在返回状态中标为退化，不能只把开关画成成功。系统适配分别位于 [Windows](../src-tauri/src/native/autostart_registry.rs)、[macOS](../src-tauri/src/native/autostart_macos.rs)、[Linux](../src-tauri/src/native/autostart_linux.rs)。

## 全局快捷键与窗口状态

`shortcuts.show_main` 只绑定显示主窗口，空字符串表示关闭。解析复用插件及平台保留键规则；首次按下触发显示，按住重复事件不反复执行，且不会解锁账号。变更按注册事务保存，冲突返回 `app.shortcut.conflict`；不支持的平台环境返回实际状态，不能把配置值视为已注册。详见 [shortcuts.rs](../crates/desktop/src/native/shortcuts.rs)及[宿主适配](../src-tauri/src/native/shortcuts.rs)。应用内的命令快捷键由前端单独管理，见[前端](frontend.md)。

`window.restore_state` 控制窗口位置与大小恢复，状态文件为状态根的 `window-state.json`。API 区分首次运行、已恢复、关闭恢复和失败；`app_window_state_reset` 重置保存状态。位置校验、显示器变化与写入通过已有窗口状态适配完成，见 [window_state.rs](../src-tauri/src/native/window_state.rs)。

## 桌面通知

桌面通知的设备总开关为 `notify.desktop`，由宿主端口读取；任务完成、免打扰时段、前台窗口是否弹出及站内 toast 偏好归 notify 参数。站内通知和桌面投递状态分别记录，桌面失败不应被显示为整个任务失败。

模块只依赖 [DesktopNotifier](../crates/module-notify/src/desktop.rs)端口，系统调用由 [notification.rs](../src-tauri/src/notification.rs)执行；失去窗口焦点事实时按抑制策略处理。测试发送结果通过 `notify_test_send` 返回实际投递情况，不承诺操作系统必然展示。参数及完成钩子见 [notify 声明](../crates/module-notify/src/lib.rs)。禁用 notify 会移除其运行期完成钩子，不影响任务核心执行。

## HTTP 代理

配置显式选择 `network.proxy_mode` 为 `direct` 或 `manual`；端点与是否认证分别由 `network.proxy_endpoint`、`network.proxy_auth` 指定。应用 HTTP 客户端不继承通用代理环境变量，精确回环目标直连。

端点只接受无用户凭据、路径、查询和片段的 HTTP/HTTPS 地址；HTTP 代理仅允许精确回环地址。认证信息整体存入秘密键 `network.proxy_credentials`，设置仅返回是否设置与来源。关闭代理只切换模式并保留端点和凭据，显式清除动作才删除凭据。

配置与秘密在同一设置操作中读取或更新，失败执行补偿；补偿失败返回 `app.network.compensation_failed`。手动代理缺少必要凭据会报错，不回退直连。合同见 [network.rs](../crates/framework/src/network.rs)和[代理设置事务](../crates/desktop/src/network.rs)。数据库与 Redis 使用各自连接与 TLS 设置，不经 HTTP 代理。

## 更新器

更新器代码已具备检查、下载、验签与安装流程，但当前 [src-tauri/release.json](../src-tauri/release.json)为 `null`，状态为未配置，不联网；界面不呈现更新操作。此时不能启用 `updater.check_on_start`，直接调用检查也不会开始联网。

发行源与公钥来自编译时唯一发行配置，生产入口不接受界面传入任意 URL、公钥或安装包路径。配置校验绑定产品、渠道、目标、HTTPS 端点及精确下载主机；禁止重定向。清单上限 1 MiB，下载上限 250 MiB，仅接受高于当前版本的候选，必须通过 minisign 及签名版本匹配，禁止降级。

检查时保存代理快照与候选，下载沿用同一快照。候选 ID 绑定主体和窗口，安装只接受已验证候选；安装走维护准入，完成命令日志并关闭全部应用资源后才运行安装器或重启。安装失败保留停止状态，不恢复业务入口。实现见 [Updater](../crates/desktop/src/native/updater.rs)、[宿主 driver](../src-tauri/src/native/updater.rs)与[发行校验](../src-tauri/src/native/updater/release.rs)。

## 使用与派生

前端以 `app_native_settings_get` 获取配置来源和系统观察结果，通过 `app_native_settings_update` 提交具体类别变更；公共界面设置、网络设置和窗口动作各走其专用命令。展示失败或退化时同时保留错误码和追踪 ID。

派生项目扩展原生能力时，先把策略、状态和可测试端口放在 desktop，再在宿主实现系统适配并注册关闭动作；前端只消费类型化合同。需要裁剪时同步移除设置 DTO、命令、宿主装配和对应界面，再重新生成合同，不在内核保留产品专用开关。
