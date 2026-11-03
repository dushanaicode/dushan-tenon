# 数据、任务与恢复

数据库和缓存后端可配置，本机附件始终由当前状态目录管理。远端数据库不把本机文件、凭据或原生状态变成可跨设备共享的数据。操作通过身份、权限和[命令准入](ipc.md)保护。

## 数据库与迁移

支持 SQLite、MySQL、PostgreSQL 三种后端；默认 SQLite，文件位于状态根的 `data/app.db`。远端连接显式指定主机、端口、库名、用户名；密码来自秘密键，TLS 默认 `verify_full`，自定义 CA 相对路径基于状态根。SQLite 拒绝远端专用字段。合同见 [DatabaseConfig](../crates/framework/src/db/config.rs)、[配置加载](../crates/desktop/src/config/loader/database.rs)与[连接实现](../crates/framework/src/db/connect.rs)。

迁移声明包含模块、版本、名称及三种方言 SQL，执行历史记录在 `fw_schema_migration`。状态报告包含已应用、待应用、未知、校验和不符、失败五组；中断留下的运行记录也归入需人工核对的失败组。未知迁移、内容变化和失败记录均阻止升级，不能修改历史 SQL 后自动重跑。详见 [migrate](../crates/framework/src/db/migrate/mod.rs)。

启动时 SQLite 在待升级前创建数据库快照，成功后按 `database.backup_keep` 保留最近快照，默认五份；位置为状态根的 `backups`。这只是数据库升级保护，不是包含配置与附件的完整备份。远端数据库启动只检查，发现待迁移时要求显式升级；MySQL 使用命名锁，PostgreSQL 使用会话 advisory lock 互斥迁移。

数据库工具入口见 [scripts/db.mjs](../scripts/db.mjs)与[CLI](../src-tauri/src/bin/dushan-tenon-cli.rs)：

```powershell
pnpm.cmd db status --state-root Temp/dev-state
pnpm.cmd db upgrade --state-root Temp/dev-state
pnpm.cmd db export-sql --dialect postgres
```

远端 `upgrade` 必须加 `--confirm-backup`，表示操作者已经自行备份；它不会替你备份服务器。`export-sql` 只读迁移声明，不连接数据库。`pnpm db snapshot` 用于维护 SQL 快照，已发布的迁移字节不重写。

禁用模块仍保留其迁移。物理移除模块后，已有数据库中的该模块记录会成为未知迁移；派生产品必须单独处理现有数据和归档适配，不能删除迁移历史绕过检查。

## 缓存与锁

[Cache](../crates/framework/src/cache/mod.rs)提供带 TTL 的字节及 JSON 缓存、租期锁和连通性探测。默认进程内本地缓存，也可使用 Redis；配置的 Redis 连接失败会报错，不回退本地。后端和秘密配置见 [cache loader](../crates/desktop/src/config/loader/cache.rs)。

缓存键以配置前缀和命名空间隔离。锁使用持有令牌并显式释放；本地锁不参与缓存容量淘汰，析构不做异步 I/O。调用方不能把缓存当作持久数据或把租期锁当作无限期所有权。数据库事务及迁移锁仍有各自的合同。

## 本机文件

[FileStore](../crates/framework/src/file/store.rs)管理状态根下的 `files`，业务表只保存文件 ID。文件用途由模块声明扩展名白名单；写入检查用途、大小、扩展名及内容特征，计算 SHA-256，登记数据库记录。默认大小上限为 20 MiB，支持类型见 [file/mod.rs](../crates/framework/src/file/mod.rs)。

文件选择入口 `app_file_pick` 返回一次性令牌、显示名称与格式，真实路径只在宿主内存中保存。令牌绑定主体、用途，十分钟后过期，消费时核验；任务交接另有数量预算和提交回滚。拖入或系统打开的文件先进入接入队列，需认领后才能交给业务，不能仅凭外部路径立即读写。实现见 [picked_files.rs](../crates/desktop/src/picked_files.rs)和[接入适配](../src-tauri/src/file_ingress.rs)。

预览返回受限的图片数据或文本；文本翻页通过 fingerprint 检查文件是否变化。保存副本另选目标。文件管理入口提供删除及回收报告，业务附件由其模块维护引用与删除事务；不要直接移动或清理存储树。demo 的[附件用例](../crates/module-demo/src/attachments.rs)展示了这种配合。

## 任务与计划

[JobQueue](../crates/framework/src/job/mod.rs)是数据库持久队列，不依赖前端订阅存活。任务有类型、提交者、重试策略、尝试次数、租期、进度、结果与行版本；处理器运行前通过权限查询端口重新检查权限。状态包括 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`needs_review`。

执行器按全局并发和处理器并发领取任务、续租和协作取消。租期过期后，只有可安全重试且仍有尝试次数的任务重新排队，其余进入人工复核；不能承诺外部副作用恰好执行一次。`local_only` 任务绑定实例，适用于持有本机文件交接的工作。详见 [runner.rs](../crates/framework/src/job/runner.rs)与 [store.rs](../crates/framework/src/job/store.rs)。

普通用户通过 `app_job_mine_get`、`app_job_mine_watch`、`app_job_mine_cancel` 访问本人提交的任务；devtools 的管理入口有独立读写权限。监视流只是观察，关闭页面不会自动取消持久任务。任务完成钩子在完成事务内运行，提交后的外部投递由提交后动作承担。

[ScheduleDeclaration](../crates/framework/src/job/schedule.rs)声明计划键、任务类型、五字段 cron、初始开关和载荷；运行记录使用 IANA 时区并持久化最近和下一次执行信息。未再声明的历史计划可以检查，不能继续按当前声明运行。当前五模块没有内置计划，开发工具提供计划列表和立即运行入口；它不是任意 cron 编辑器。

新增任务需要模块声明与唯一处理器配对，明确重试安全性、并发、本机归属和权限，再通过宿主冻结装配；新增计划引用已声明任务。详见[模块扩展](modules.md#后端声明与扩展合同)。

## 导入导出预算

[Exchange](../crates/framework/src/exchange/mod.rs)支持 XLSX、CSV、JSON。数据集声明列键、显示翻译、类型、导入必填性、字典与冲突模式；业务模块负责业务校验和事务写入。[demo 数据集](../crates/module-demo/src/exchange.rs)与[宿主任务交接](../src-tauri/src/exchange.rs)展示了完整接入。

| 默认预算 | 上限 |
|---|---|
| 输入文件 | 10 MiB |
| 导入行数 | 10,000 |
| 导出行数 | 100,000 |
| 单元格字符 | 4,096 |
| 报告错误条数 | 200，超过后标记截断 |

这些是数据集可声明的预算，不保证所有数据集都接受相同冲突模式。内核支持报错、跳过或更新插入，当前 demo 只开放报错与跳过；格式、表头、类型和字典值仍需校验。较大操作提交任务并查看报告，不能把返回任务 ID 当作导入成功。前端复用 [exchange](../src/core/exchange)中的选择、进度与结果组件。

## 完整备份

完整手动备份只支持 SQLite 与本地缓存，要求活动所有者和主窗口，取得维护独占并检查任务静止条件。输出后缀为 `.tenon-backup.zip`，包含数据库一致性快照、受管附件、配置白名单投影与清单；每个成员记录大小和 SHA-256。见[宿主守卫](../src-tauri/src/data.rs)、[DataService](../crates/desktop/src/data.rs)及[归档实现](../crates/framework/src/backup/archive.rs)。

配置投影只读取文件来源，涵盖界面、认证模式、模块、任务、日志与通知等白名单；不携带环境或命令行覆盖、设备连接配置及系统凭据。恢复合并保留目标设备配置、认证策略和开发者模式，见 [config/backup.rs](../crates/desktop/src/config/backup.rs)。账号数据仍在数据库里，归档是未加密的敏感数据，应由操作者妥善保存。

| 归档预算 | 上限 |
|---|---|
| 条目数 | 10,000 |
| 清单 | 1 MiB |
| 数据库 | 512 MiB |
| 单个附件 | 20 MiB |
| 总内容 | 2 GiB |

预算来自 [backup/mod.rs](../crates/framework/src/backup/mod.rs)。归档路径、链接、成员、摘要和存储布局均需校验；临时与恢复目录由宿主明确提供，原子切换要求受支持的同卷布局。导出返回字节数和归档摘要。

## 恢复与启动回滚

1. `app_backup_prepare_restore` 消费备份选择令牌，预检产品身份、归档预算、摘要、迁移及配置，产生 `RestorePlan`，此时不覆盖当前数据。
2. 预检结果十分钟内有效，绑定所有者、主窗口、实例、状态根和原配置；过期、目标变化或暂存内容变化都须重新预检。恢复要求 SQLite、本地缓存，并拒绝相关环境或命令行覆盖造成的冲突。
3. `app_backup_restore` 在维护独占下复核静止状态与摘要，写入 `restore-journal.json` 后关闭准入，返回需要重启。恢复提交不是可继续使用当前业务的普通保存操作。
4. 受控重启在打开目标数据库前处理 journal，切换数据库、配置与文件，再验证启动；失败按持久阶段回滚原内容。无法完成回滚时停止启动并保留证据，不创建空库掩盖失败。

编排见 [desktop restore](../crates/desktop/src/restore.rs)、[宿主重启](../src-tauri/src/restore.rs)与[启动构建](../src-tauri/src/boot.rs)。系统凭据不随归档迁移，恢复后需要重新提供秘密。

普通启动另用 `startup-state.json` 记录运行、正常关闭或失败，以识别上次异常退出。原生故障提示可选择重试或退出；重试沿用本次启动参数，不重置数据或保存的设置。涉及备份恢复的致命失败只提示保留证据并退出。见 [startup_recovery](../crates/desktop/src/startup_recovery.rs)与[原生提示](../src-tauri/src/startup_recovery.rs)。

## 诊断包

`app_diagnostics_export` 要求活动所有者、主窗口和一次关于信息刷新后的缓存探测事实，导出本身不探测远端。缺少探测时返回 `app.diagnostics.needs_probe`。

输出后缀为 `.tenon-diagnostics.zip`，只含白名单 `diagnostics.txt` 和带摘要的 `manifest.json`，上限 1 MiB。内容为版本、数据库种类及迁移数量、缓存后端及探测结果、语言、明暗和模块状态；路径及端点脱敏，不包含日志、配置原文、数据库、附件、用户名或秘密。见 [诊断快照](../crates/desktop/src/diagnostics.rs)与[打包器](../crates/framework/src/backup/diagnostics.rs)。
