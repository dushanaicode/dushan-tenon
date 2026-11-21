# 第三方依赖声明

本文件说明项目的依赖许可政策和已登记例外，供使用者、维护者和二进制分发者查阅。它不替代依赖包自己的版权、许可正文与 NOTICE 声明；发行清单由锁定依赖和本地安装的包生成。

## 依赖许可政策

许可检查覆盖 Windows 的 Rust 运行时、构建期依赖，以及 pnpm 生产依赖。Rust 来源限于 crates.io 和本仓库许可检查认可的本地依赖。

宽松许可白名单为：MIT、MIT-0、Apache-2.0、Apache-2.0 WITH LLVM-exception、BSD-2-Clause、BSD-3-Clause、ISC、Zlib、Unicode-3.0、Unicode-DFS-2016、CC0-1.0、0BSD、BSL-1.0、Unlicense、CDLA-Permissive-2.0。

`OR` 表达式至少一个分支须获准，`AND` 表达式所有分支都须获准；`WITH` 只批准白名单中的完整组合。白名单外的许可须由维护者登记包名、原始许可表达式、理由和适用范围。例外不自动扩展到其他包或其他许可表达式，退出依赖图的例外必须移除。

## 当前例外

以下条目与 `scripts/check-licenses.mjs` 的 `LICENSE_EXCEPTIONS` 一一对应，均为 Rust 依赖。

| 包名 | 许可 | 范围 | 理由 |
| --- | --- | --- | --- |
| option-ext | MPL-2.0 | Windows 运行时依赖 | tauri → dirs → dirs-sys → option-ext，用于运行时定位系统目录；发行时保留许可并提供同版本源码链接 |
| cssparser | MPL-2.0 | 构建期 HTML/CSS 处理 | tauri-build → tauri-utils → dom_query → cssparser，用于构建时解析 CSS |
| cssparser-macros | MPL-2.0 | 构建期过程宏 | tauri-build → tauri-utils → dom_query → cssparser → cssparser-macros，用于生成 CSS 解析代码 |
| dtoa-short | MPL-2.0 | 构建期数字格式化 | tauri-build → tauri-utils → dom_query → cssparser → dtoa-short，用于构建时输出 CSS 数值 |
| selectors | MPL-2.0 | 构建期 HTML/CSS 处理 | tauri-build → tauri-utils → dom_query → selectors，用于构建时匹配 CSS 选择器 |

## 分发二进制时生成完整清单

在仓库根目录加载隔离环境，使用与安装依赖时相同的 pnpm 存储。依赖已在本地缓存时，可保持 Cargo 离线：

```powershell
$isolated = node scripts/environment.mjs | ConvertFrom-Json
foreach ($item in $isolated.PSObject.Properties) { Set-Item -Path "env:$($item.Name)" -Value $item.Value }
$env:CARGO_NET_OFFLINE = "true"
node scripts/check-licenses.mjs --notices Temp/check/THIRD_PARTY_LICENSES.md
```

清单包含 Windows x86_64-pc-windows-msvc 的 Rust 运行时依赖和 pnpm 生产依赖，排除构建、开发和过程宏依赖。生成器保留包内许可正文、合并相同正文，并列出 MPL-2.0 包的同版本源码链接。

分发前检查清单中的“缺许可正文”表并补齐所列内容，将清单和本文件随二进制一同提供，保留适用的版权与 NOTICE 声明。若修改 MPL-2.0 文件，还须提供对应的修改源码及获取方式。

## JetBrains Mono 验证码字体

`crates/module-account/assets/fonts/JetBrainsMono-Bold.ttf` 来自
[JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono)，用于生成账号验证码。
字体与同目录的 [OFL.txt](crates/module-account/assets/fonts/OFL.txt) 均按原始字节保留。
字体采用 **SIL Open Font License 1.1（OFL-1.1）**，不随项目重新许可为 MIT。
分发字体或包含字体的应用时，须随附原版权声明和 OFL 许可全文；修改或再分发字体须遵守
OFL 的保留字体名称、不得单独售卖及衍生字体继续采用 OFL 等要求，具体以原许可为准。

## vendor/calamine

`vendor/calamine` 来自 calamine **0.37.0** 的 crates.io 发布包，采用 **MIT** 许可。
上游：[tafia/calamine](https://github.com/tafia/calamine)，发布包记录 commit
`f2c5948242fdfe390e292313a1f87f9db19b9633`，发布包 SHA-256 为
`c9ca341b94bc4b29e08970b1a03914fad2dfe177e2ecb67fcd6de9046004aafb`。

源码补丁移除了按不可信共享字符串 `uniqueCount` 预分配内存的提示；独立 manifest
去除示例、基准及开发依赖，并禁止发布、独立于 workspace。补丁、来源和逐字节对照办法见
[PATCHES.md](vendor/calamine/PATCHES.md)。2026-11-20 从 0.36.1 升级到 0.37.0（改用 zip 9），源码补丁原样重新应用。
原始 [LICENSE-MIT.md](vendor/calamine/LICENSE-MIT.md) 逐字节保留，正文如下：

The MIT License (MIT)

Copyright (c) 2016 Johann Tuffe

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:


The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.


THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## tauri-plugin-window-state

vendor/tauri-plugin-window-state is adapted from tauri-plugin-window-state 2.5.0, from the [Tauri plugins workspace](https://github.com/tauri-apps/plugins-workspace/tree/a2364a5f216324439feedeb25b2db74e7b1eba90/plugins/window-state).

This project elects the MIT license from the upstream MIT OR Apache-2.0 offer. Copyright notices, SPDX identifiers, and both license texts are retained in LICENSE_MIT and LICENSE_APACHE-2.0. The upstream crate SHA-256 is 5d6815cab7b212f9cfe16a9d79d8d22f9e14159e4a9460f7dec1467167a008e3.

This is a substantial adaptation: explicit state-file paths, strict main-window geometry storage, corruption protection, monitor/DPI handling, atomic writes, and explicit shutdown flushing. Sources, comparison records, and all changes are documented in vendor/tauri-plugin-window-state/PATCHES.md. No guest commands or JavaScript permissions are enabled.

## vendor/tauri-plugin-updater

`vendor/tauri-plugin-updater` 来自 Tauri plugins-workspace，保留既有安全补丁。
选择 MIT，保留上游 `LICENSE_MIT`、`LICENSE_APACHE-2.0`、`LICENSE.spdx` 与版权正文；来源提交、发布包 SHA-256、补丁和验证边界见其 `PATCHES.md`。

### Rust 标准库改编片段（rust-lang/rust）— LICENSE-MIT

`escape_nsis_current_exe_arg` 的源码注释记录了对 [`rust-lang/rust` commit
`1c047506f94cd2d05228eb992b0a6bbed1942349` 的 `library/std/src/sys/args/windows.rs`（第 174 行 `append_arg`）](https://github.com/rust-lang/rust/blob/1c047506f94cd2d05228eb992b0a6bbed1942349/library/std/src/sys/args/windows.rs#L174) 的改编。
该文件无逐文件许可头；该 commit 的仓库根 [`COPYRIGHT`](https://github.com/rust-lang/rust/blob/1c047506f94cd2d05228eb992b0a6bbed1942349/COPYRIGHT)
写明 `Apache-2.0 OR MIT` 双重许可，版权归 The Rust Project Contributors。本项目选择 **MIT**。
核对于 2026-10-20；下附该 commit 的 [`LICENSE-MIT`](https://github.com/rust-lang/rust/blob/1c047506f94cd2d05228eb992b0a6bbed1942349/LICENSE-MIT) 全文。

```text
Copyright (c) The Rust Project Contributors

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## 发布包缺少许可文件的依赖

以下许可正文补充对应发布包中缺少的许可文件，与生成的第三方许可清单一同分发。

### react-remove-scroll-bar 2.3.8 — LICENSE（theKashey/react-remove-scroll-bar）

许可：MIT。来源仓库：[theKashey/react-remove-scroll-bar](https://github.com/theKashey/react-remove-scroll-bar)。

```text
MIT License

Copyright (c) 2025 Anton Korzunov <thekashey@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### alloc-stdlib 0.3.0 — LICENSE（dropbox/rust-alloc-no-stdlib）

许可：BSD-3-Clause。来源仓库：[dropbox/rust-alloc-no-stdlib](https://github.com/dropbox/rust-alloc-no-stdlib)。

```text
Copyright (c) 2016 Dropbox, Inc.
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ts-rs 12.0.1 — LICENSE（Aleph-Alpha/ts-rs）

许可：MIT。来源仓库：[Aleph-Alpha/ts-rs](https://github.com/Aleph-Alpha/ts-rs)。

```text
MIT License

Copyright (c) 2020 Aleph Alpha GmbH

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### webview2-com 0.39.1 / webview2-com-sys 0.39.1 — LICENSE（wravery/webview2-rs）

许可：MIT。来源仓库：[wravery/webview2-rs](https://github.com/wravery/webview2-rs)。

```text
MIT License

Copyright (c) 2021 Bill Avery

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
