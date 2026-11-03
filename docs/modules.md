# 模块与装配

Dushan Tenon 的模块由宿主显式装配。后端声明决定模块能力与数据合同，前端清单贡献界面；二者通过生成合同对应，目录是否存在不代表模块已启用。

## 五个模块

| 模块 | 职责 | 模块依赖 | 所需内核能力 | 可禁用 |
|---|---|---|---|---|
| account | 唯一所有者、免登录或登录、会话与应用锁 | 无 | 无 | 否 |
| notify | 站内通知、桌面投递、任务完成通知 | account | job | 是 |
| files | 本机文件列表、预览、保存副本与回收入口 | account | file | 是 |
| devtools | 任务检查、取消、重试、人工处置及计划检查 | account | job | 是 |
| demo | 样板数据、附件、导入导出、测算与演示中心 | account | job、exchange、file | 是 |

权威声明是各模块的 `DECLARATION`：
[account](../crates/module-account/src/lib.rs)、[notify](../crates/module-notify/src/lib.rs)、[files](../crates/module-files/src/lib.rs)、[devtools](../crates/module-devtools/src/lib.rs)、[demo](../crates/module-demo/src/lib.rs)。
demo 的业务用例还要求开发者模式；启用模块本身不解除此限制。

account 即使在免登录模式也提供所有者身份。免登录不是以系统身份执行界面命令。其他模块只依赖 framework 与 account，不互相导入；原生适配留在宿主。[分层规则](architecture.md)定义编译依赖方向。

## 后端声明与扩展合同

[ModuleDeclaration](../crates/framework/src/module/mod.rs)集中声明下列内容：

| 项 | 合同 |
|---|---|
| 身份、版本、依赖、内核能力 | 模块 ID 唯一；依赖必须注册且无环；启用模块的依赖必须启用；所需能力必须可用 |
| 权限 | 声明本模块拥有的权限键；命令和任务引用已声明权限 |
| 迁移、错误码 | 迁移按模块和版本归属；错误码为三段，模块错误使用模块前缀 |
| 参数 | 声明类型、默认值、分组、排序、读写权限和生效时机，见[配置与设置](settings.md) |
| 任务与计划 | 任务类型必须各有一个处理器；计划引用已声明的任务类型，见[数据](data.md) |
| 字典 | 声明稳定值及语义色；显示标签通过翻译获得，不能把标签作为持久值 |
| 文件用途 | 声明用途代码与允许的扩展名；业务保存文件 ID，见[本机文件](data.md#本机文件) |
| 消息键 | 声明后端输出的业务消息键；生成器另行收集字典、参数和文件用途的派生文案键 |

[ModuleRegistry](../crates/framework/src/module/mod.rs)校验全部编译模块，按依赖拓扑启动启用模块，并按相反顺序关闭已成功启动的模块。启动失败时回收已经启动的模块。
运行前通过 [ModuleExtensions](../crates/framework/src/module/extensions.rs)收集并冻结任务处理器、任务完成钩子及身份扩展。活动身份解析、命令权限检查、后台权限查询三个槽各须恰好一个启用的提供者；缺失或重复都会启动失败。当前由 account 提供。任务完成钩子可以为空，按模块拓扑和模块内顺序执行。

宿主的两个装配入口位于 [src-tauri/src/modules.rs](../src-tauri/src/modules.rs)：声明数组供合同生成及数据库工具读取，运行注册表供应用启动使用。含原生文件选择交接的任务处理器由宿主补入，再与模块处理器一起校验。不能只删注册数组而留下启动时的直接服务引用。

## 前端清单

[ModuleManifest](../src/core/contracts/module.ts)定义路由、导航、开发页、设置分节、标题栏小组件、命令面板动作、工作台对象与辅助面板、文件接入目标。实现放在各模块的清单，例如 [demo 清单](../src/modules/demo/manifest.ts)。页面组件通过字面量路径懒加载。

清单只描述贡献，不授予后端权限。前端同时结合模块启用、认证模式、权限及开发者模式判定可见性，后端仍独立鉴权。模块注册表由组合根读取，经 [ModuleDirectoryProvider](../src/core/module-directory.tsx)或 props 下发给消费者；shell、core 和其他模块不反向导入注册表。详见[前端](frontend.md)。

## 预设与运行时禁用

预设是新状态目录的 `config.toml` 种子，不改变编译依赖或物理文件：

| 预设 | 启用模块 | 认证模式 | 标题栏 |
|---|---|---|---|
| minimal | account | none | native |
| tool | account、notify | none | native |
| full | 五个模块全部启用 | login | hidden |

三者默认均使用标准主题的系统明暗、关闭即退出、禁用托盘和自启。配置见 [presets](../presets)，生成目录见 [assembly.ts](../src/lib/generated/assembly.ts)。

```powershell
pnpm.cmd preset tool
pnpm.cmd dev
```

`pnpm preset` 默认写入 `Temp/dev-state/config.toml`；目标已存在时拒绝覆盖。用 `pnpm.cmd preset minimal --state-root Temp/custom-state` 可创建另一状态目录的配置，再用桌面程序的 `--state-root` 启动它。`pnpm dev` 固定使用默认开发状态目录。命令解析见 [scripts/preset.mjs](../scripts/preset.mjs)。

已有配置通过模块开关调整，例如：

```toml
[modules.demo]
enabled = false
```

开关在启动时读取；未指定的已编译模块默认启用。未知模块、禁用 account、启用模块依赖被禁用均会拒绝启动。界面通过 `app_modules_list` 读取生效结果，见 [enabled-modules.ts](../src/core/enabled-modules.ts)。禁用模块的命令返回 `app.module.disabled`。

禁用不会删除表、迁移、权限或其他声明；所有编译模块的迁移仍参与校验和升级。只冻结启用模块的运行实现。要减小发布体积，需要物理裁剪。

## 物理裁剪一个模块

以可选模块 demo 为例，下游应在自己的派生仓库中完成以下同步修改：

1. 先备份现有状态；核查归档与数据库是否含该模块的迁移。移除声明后，这些记录会成为未知迁移，不能将含它们的原状态目录直接当作可启动状态；数据保留或迁移须单独处理，见[迁移合同](data.md#数据库与迁移)。
2. 移除 [modules.rs](../src-tauri/src/modules.rs)中的声明和运行注册、[boot.rs](../src-tauri/src/boot.rs)中的构造与启动装配、[state.rs](../src-tauri/src/state.rs)中的服务持有及其他直接消费者；同时处理 [exchange.rs](../src-tauri/src/exchange.rs)中的宿主任务处理器。
3. 从唯一命令清单 [list.rs](../src-tauri/src/commands/list.rs)移除该模块命令，删除对应命令适配及 [contract.rs](../src-tauri/src/contract.rs)中的类型导出。删除后端模块目录，并更新 [Cargo.toml](../Cargo.toml)和[宿主 Cargo.toml](../src-tauri/Cargo.toml)中的成员与依赖。
4. 从前端唯一注册表 [src/app/module-registry.ts](../src/app/module-registry.ts)移除该模块清单的导入与数组项，再删除前端模块目录；清除其翻译、专属测试及显式引用。不让 shell 或其他模块接管被裁模块的业务逻辑。
5. 从全部[预设](../presets)删掉该模块配置，避免未知模块启动错误。运行 `pnpm generate` 重建命令、权限、参数、字典、错误码、装配目录和窗口 ACL；生成物不手改，见[命令](ipc.md#生成合同)。
6. 用新的独立状态目录验证启动、剩余模块和预设，运行相关定向测试与 `pnpm check`。逐项搜索被移除模块的 crate、服务类型、命令及清单引用，确认没有残留消费者。

account 是当前身份提供者，不能照此直接删除；替换它需要同时实现三个必需身份槽及现有消费者的身份合同。
