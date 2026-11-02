# Kit 来源与许可

## 改编源码

| 来源 | 固定版本或提交 | 迁入内容 | 许可 |
| --- | --- | --- | --- |
| [shadcn/ui](https://github.com/shadcn-ui/ui/tree/d2fba50) | `d2fba50`（new-york-v4） | `ui/` 中带来源头的组件；改用语义令牌、统一滚动与基础动效 | MIT，原文见 [ui/LICENSE](ui/LICENSE) |
| [AI Elements](https://github.com/vercel/ai-elements/tree/ca8be600bfd01b3131f9bf6134b51602a71f4374) | `ca8be600bfd01b3131f9bf6134b51602a71f4374` | `conversation.tsx`、`message.tsx` 的滚动/消息/动作组合与部分展示结构，改编为 `templates/conversation-page.tsx` | Apache-2.0，Copyright 2023 Vercel, Inc.；[原文](licenses/ai-elements.LICENSE) |

ConversationPage 使用纯视图类型、受控输入、原文复制、独立读屏状态与即时滚动；未复制 AI SDK、下载、消息分支、附件或 prompt-input 运行时。原始来源未附独立 NOTICE。

## 使用正式依赖的封装

下列包通过依赖使用，没有复制解析器、虚拟化或面板布局实现。精确版本对应当前依赖清单与锁文件。

| 包 | 精确版本 | 许可 | 使用位置 |
| --- | --- | --- | --- |
| radix-ui | 1.6.7 | MIT | UI 状态、焦点与键盘原语 |
| cmdk | 1.1.1 | MIT | Command |
| sonner | 2.0.8 | MIT | Toaster、toast 与静态 CSS |
| @tanstack/react-table / @tanstack/table-core | 9.2.6 / 9.2.6 | MIT | DataTable |
| @tanstack/react-virtual / @tanstack/virtual-core | 3.14.17 / 3.19.2 | MIT | VirtualList、VirtualLog |
| react-resizable-panels | 4.14.2 | MIT，Copyright (c) 2018 Brian Vaughn | ResizableGroup、ResizablePanel、ResizableHandle；[许可原文](licenses/react-resizable-panels.LICENSE) |
| streamdown | 2.7.0 | Apache-2.0，Copyright 2023 Vercel, Inc. | StreamText 与静态 styles.css |
| @streamdown/cjk | 1.0.4 | Apache-2.0，Copyright 2023 Vercel, Inc. | StreamText 的 CJK 插件 |
| use-stick-to-bottom | 1.1.6 | MIT，Copyright (c) 2024 - present StackBlitz | ConversationPage 的滚动 hook；[许可原文](licenses/use-stick-to-bottom.LICENSE) |

StreamText 使用上游 sanitize/harden，禁用原始 HTML、远程图片和导航型外链；Markdown 解析由 Streamdown 负责。其余自写组件遵循项目根目录的 MIT 许可。
