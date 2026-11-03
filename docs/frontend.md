# 前端合同与扩展

前端按文件路径确定层级，静态导入、类型导入、重导出和动态导入均受依赖方向检查。动态导入必须使用字符串字面量。规则正文见[架构](architecture.md)，检查入口为 [check-structure.mjs](../scripts/check-structure.mjs)。

## 分层边界

| 层 | 职责 | 可导入的项目层 |
|---|---|---|
| lib | 纯工具、IPC 传输、生成合同 | 无 |
| kit | 组件、页面模板、令牌、响应式原语 | lib |
| core | 共享状态、合同与业务无关的设施 | lib、kit |
| shell | Console 布局、导航、命令、窗口及工作台 | lib、kit、core |
| modules | 单个业务模块的页面、查询及清单 | lib、kit、core、本模块 |
| app | 入口及组合根 | 全部 |

模块之间不互相导入。跨层类型放在 [core/contracts](../src/core/contracts)，模块注册表只由组合根读取，经 props 或 context 下发。下层不能为了拿某个类型反向导入 app。`src/main.tsx` 归 app；测试遵守同样分层，辅助代码放在可提供它的最低层。

## kit 组件与模板

[src/kit/index.ts](../src/kit/index.ts)是公共导出目录，图标使用 [icons.ts](../src/kit/icons.ts)中的语义 ID。现有组件覆盖表单、选择器、弹层、反馈、导航、表格、虚拟列表、文本流与窗口控件等；组件 API、受控状态和组合方式以对应源码类型为准，不能在模块内复制一套同用途基础组件。

页面模板放在 [templates](../src/kit/templates)，包括列表、详情、表单容器、主从、仪表盘、向导、状态和对话页面。模板提供布局与插槽，数据加载、命令调用和业务决策留给调用方。普通模块页优先复用模板和 kit，再通过 core 接入状态。

复合交互复用已有 Radix、表格、虚拟化和可调整面板适配。滚动区域使用 [ScrollArea](../src/kit/ui/scroll-area.tsx)，页面标题经 [PageHeader](../src/kit/ui/page-header.tsx)与[标题焦点注册](../src/kit/page-title-focus.tsx)协作；shell、app、modules 不通过 DOM 查询驱动焦点或状态。

标准主题只提供浅色、深色与跟随系统，语义颜色及基础动效由共享样式提供。基础动效遵循系统减动设置，强制色彩使用系统颜色。业务组件消费语义令牌，不自行持有明暗状态；详见[外观合同](settings.md#标准主题与明暗)。

## core 共享设施

| 设施 | 合同与入口 |
|---|---|
| 认证与查询 | [auth.ts](../src/core/auth.ts)读取服务端状态；[query-client.ts](../src/core/query-client.ts)遇认证或权限错误使认证查询失效，不伪造本地登录成功 |
| 模块与可见性 | [module-directory.tsx](../src/core/module-directory.tsx)接收清单；[enabled-modules.ts](../src/core/enabled-modules.ts)读取后端启用表；[visibility.ts](../src/core/visibility.ts)统一判定可见、禁止与不存在 |
| 外观与应用设置 | [app-settings.ts](../src/core/app-settings.ts)管理设置查询；[appearance-bridge.ts](../src/core/appearance-bridge.ts)封装宿主注入全局的访问 |
| 错误与翻译 | [ipc-error.tsx](../src/core/ipc-error.tsx)及 [use-ipc-toast.ts](../src/core/use-ipc-toast.ts)展示稳定错误码和追踪 ID；翻译资源由使用方装配 |
| 设置 | [settings](../src/core/settings)提供参数表单、来源锁定、草稿和保存提示；分节合同见[配置与设置](settings.md) |
| 字典 | [dict](../src/core/dict)提供字典选择与显示，存储稳定值，标签随语言翻译 |
| 任务与交换 | [jobs](../src/core/jobs)提供任务链接与进度，[exchange](../src/core/exchange)提供导入导出交互；订阅和持久任务分别管理 |
| 文件与编辑 | [file-ingress](../src/core/file-ingress)处理待接入文件；[edit-sessions.tsx](../src/core/edit-sessions.tsx)与页面会话协调未保存编辑和关闭 |

`Visibility` 可约束开发者模式、权限、任一权限和认证模式；无活动认证或权限不足返回禁止，开发入口被关闭返回不存在。后端鉴权仍是最终边界。

生成 DTO 和命令来自 [lib/generated](../src/lib/generated)，调用方式见[IPC](ipc.md)。通用流用 [subscribeStream](../src/lib/ipc/stream.ts)，窗口事件使用 [window-events.ts](../src/core/window-events.ts)。跨组件状态通过 props、context 或现有查询缓存传递；自定义 DOM 事件走类型化通道并使用 `tenon:` 前缀。

## Console 外壳

当前外壳为 [ConsoleLayout](../src/shell/layouts/console.tsx)，由 [Shell](../src/shell/shell.tsx)接收导航树、品牌与标题栏插槽、模块清单、可见性上下文及设置目录。外壳不自行发现模块或导入业务注册表。

响应式按外壳容器宽度划分，断点来自 [responsive.ts](../src/kit/responsive.ts)：

| 档位 | 宽度 | 导航行为 |
|---|---|---|
| compact | 小于 720 px | 主导航放入抽屉 |
| medium | 720 至小于 1100 px | 紧凑导航，可临时展开 |
| expanded | 至少 1100 px | 可调整侧栏，保存折叠与宽度 |

容器通过 ref 和 ResizeObserver 测量，见 [use-shell-tier.tsx](../src/shell/use-shell-tier.tsx)。主辅区域按可用内容宽度调整，辅助面板空间不足时改为抽屉，不挤出不可用正文。布局边界与请求值归一化见 [workbench/layout.ts](../src/shell/workbench/layout.ts)。

导航树支持父组与叶子，命令面板合并导航、设置与模块动作，使用稳定命令 ID。应用内快捷键由 [commands](../src/shell/commands)和[绑定处理](../src/shell/shortcuts-bindings.ts)管理；只显示主窗口的系统全局快捷键见[原生能力](native.md#全局快捷键与窗口状态)。

工作台对象以带类型的对象引用恢复，不序列化组件。模块贡献解析器、对象视图和辅助面板，外壳负责标签、激活和布局；不可访问或已删除对象通过不可用回调处理。合同在 [workbench.ts](../src/core/contracts/workbench.ts)与 [ModuleManifest](../src/core/contracts/module.ts)，持久化与显示在 [workbench](../src/shell/workbench)。焦点由 ref 注册和[焦点设施](../src/shell/shell-focus.tsx)协调，路由切换后请求页面标题焦点。

## 模块页面与演示中心

业务页面和查询放在自己的模块目录，清单贡献路由、导航、设置、标题栏小组件、文件目标及工作台能力，见[模块](modules.md#前端清单)。懒加载组件、可见性和对象合同由 core 提供，业务实现不写进 shell。

demo 的演示中心由 [manifest.ts](../src/modules/demo/manifest.ts)贡献开发页，要求启用 demo 并打开开发者模式；业务样板及测算页还受权限和后端模式校验。它展示组件、页面模板、标准明暗、布局行为和真实样板数据用法。

页面和规则目录位于 [pages.json](../src/modules/demo/showcase/pages.json)与 [rules.json](../src/modules/demo/showcase/rules.json)，分类目录在 [catalog](../src/modules/demo/showcase/catalog)，运行示例在 [examples](../src/modules/demo/showcase/examples)。演示页使用同一套 kit 和 core，不另建演示专用基础组件。

增加组件演示时，同时登记分类、示例与相关页面；需要真实数据交互时复用模块用例和生成命令。裁剪 demo 时连同清单、演示目录和专属翻译一起移除，kit 和 core 的公共实现不随之删除。

## app 组合根

待整合完成后补写。
