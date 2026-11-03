# 命令与 IPC

应用命令只有一份权威清单：[src-tauri/src/commands/list.rs](../src-tauri/src/commands/list.rs)。每项同时声明准入类别、入口、权限、输入、输出和可选事件类型；Tauri 注册、前端函数、权限映射和窗口 ACL 均由它派生。

## 准入与身份是两个维度

| 准入类别 | 合同 | 当前用途 |
|---|---|---|
| normal | 持有共享许可；维护独占或关闭时拒绝进入 | 查询、业务变更、任务提交与监视 |
| maintenance | 先鉴权，排空普通操作并取得独占，再次鉴权后执行 | 完整备份导出、恢复提交、更新安装 |
| control | 不解析身份、不访问数据库；维护期间仍可用，关闭后拒绝 | 窗口控制及长操作取消 |

实现见 [OperationGate](../crates/framework/src/maintenance.rs)与[统一入口](../crates/framework/src/ipc.rs)。维护命令不因等待独占而永久复用旧身份。`app.operation.busy` 表示正在维护，`app.lifecycle.closing` 表示已关闭准入；前端应按操作状态呈现，不把它们当作认证失败。

普通及维护命令从以下三种身份入口中选择：

| 入口 | 身份要求 | 用法 |
|---|---|---|
| execute | 活动身份；逐个核验清单中的全部权限 | 业务读写、本人任务、原生设置 |
| execute_session | 有效会话身份，允许应用锁定状态 | 解锁、退出登录、会话活动、文件选择接入 |
| execute_public | 身份可为空 | 认证状态、登录、初始化、恢复与公共界面设置 |

会话入口不意味着可以绕过用例自己的状态校验，公共入口也不意味着所有字段任意可写。例如 `app_settings_update` 对开发者模式变更另行要求活动身份。控制命令使用独立的 `execute_control`，保护来自窗口 ACL 和参数、窗口或令牌校验。

当前身份由 [account](../crates/module-account/src/auth.rs)解析。免登录模式仍解析为唯一所有者；用户标识、权限集合和系统身份不接受前端传入。后台工作经可信的执行上下文与权限查询端口运行。统一入口先检查准入与所属模块，再解析身份，禁用模块不能借公共或会话入口执行。

## 权限与窗口 ACL

模块权限来自 [ModuleDeclaration](../crates/framework/src/module/mod.rs)，命令所需权限来自唯一清单。例如 `demo_sample_import` 同时要求写入与导入权限；多个权限是全部满足关系。前端的路由或按钮可见性不能代替后端检查。

Tauri 的 [main capability](../src-tauri/capabilities/main.json)只向 `main` 窗口授予生成的应用命令权限。每个应用命令的允许项由 [build.rs](../src-tauri/build.rs)生成；新增命令需同时进入生成链。备份、恢复、更新和窗口控制还在用例中检查主窗口或所有者。不要给新窗口复制全套 ACL 来绕开这些边界。

文件路径通过原生选择或接入队列转换成一次性令牌，绑定主体、用途和期限。业务命令消费令牌，不接受前端直接指定任意磁盘路径，见[数据](data.md#本机文件)。

## 流、任务与取消

[StreamEvent](../crates/framework/src/stream.rs)使用以下协议：先发送 `started` 交付流 ID，随后发送带递增序号的 `delta` 或进度，最后以 `succeeded`、`failed`、`cancelled`、`unknown` 之一结束。终态至多一次；传输失败会注销流并触发取消。

流属于执行主体与窗口 scope。`app_stream_cancel` 只能取消同一主体和 scope 的流，未知流 ID 幂等；窗口刷新或销毁、应用退出会取消相应流。前端使用 [subscribeStream](../src/lib/ipc/stream.ts)管理回调，卸载时调用其 `dispose`；即使 `started` 尚未到达，也会在取得 ID 后请求取消。

必须区分三种取消：

- `app_stream_cancel` 取消传输订阅；停止任务监视不等于取消数据库里的任务。
- `app_job_mine_cancel` 取消本人持久任务；开发工具有自己的授权取消命令。任务提交只返回任务 ID，随后读取快照或监视变化，见[任务](data.md#任务与计划)。
- `app_operation_cancel` 是 control 命令，用操作 ID 取消备份预检、导出或更新下载等可取消操作，维护期间可用。提交边界之后不能靠取消撤销恢复或安装。

`app_stream_cancel` 本身属于 normal，维护期间可能被拒绝；不能用它替代操作取消入口。窗口状态订阅 `app_window_watch` 则直接传输 `WindowEvent`，不使用通用流封套；其释放由窗口生命周期处理。具体适配见 [stream.rs](../src-tauri/src/stream.rs)及[窗口事件客户端](../src/core/window-events.ts)。

## 错误与翻译

IPC 错误只含 `code`、字符串参数表 `params`、`traceId`，定义见 [IpcError](../src/lib/generated/IpcError.ts)。错误码统一三段；内核和宿主使用 `app` 前缀，业务模块用自己的模块前缀。内部错误清空公开参数，原因链仅留在后端日志。

前端的[调用封装](../src/lib/ipc/invoke.ts)只转发公开字段；无法识别的失败转换为 `app.ipc.unexpected`，不把原始异常内容显示给用户。[IpcErrorMessage](../src/core/ipc-error.tsx)通过错误码翻译并显示追踪 ID。后端及任务消息使用稳定消息键和参数，由[宿主翻译适配](../src-tauri/src/i18n.rs)处理；错误码、字典值或消息键都不能用本地化文本替代。

## 使用与扩展

前端调用 [commands.ts](../src/lib/generated/commands.ts)导出的类型化函数，例如 `appSettingsGet`；不要手写另一份命令名称、输入或返回类型表。

新增命令时：

1. 在所属模块实现用例，在宿主写薄适配；明确选择身份入口和准入类别。
2. 在唯一清单中登记输入、输出、权限与事件；新权限和错误码同时加入模块声明，补齐翻译。
3. 运行生成命令，使用生成函数接入前端；验证禁用模块、身份、权限、窗口边界及相应取消行为。

## 生成合同

```powershell
pnpm.cmd generate
```

[scripts/generate.mjs](../scripts/generate.mjs)驱动 [ipc_contract.rs](../src-tauri/examples/ipc_contract.rs)，将 Rust DTO、命令函数与各种键目录写入 [src/lib/generated](../src/lib/generated)，并刷新主窗口 capability。类别表位于 [admission-commands.ts](../src/lib/generated/admission-commands.ts)，模块与预设目录位于 [assembly.ts](../src/lib/generated/assembly.ts)。发行配置的公开投影也由生成流程维护。

运行 `pnpm check` 时，[check-ipc.mjs](../scripts/check-ipc.mjs)检查命令及生成合同。派生项目修改声明后应重新生成，不能仅编辑 TypeScript 或 ACL 让检查表面一致。
