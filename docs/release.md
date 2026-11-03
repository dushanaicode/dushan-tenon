# 构建 Windows 安装包

在 Windows x64 上安装 [README](../README.md#环境要求) 所列工具和项目依赖，先运行 `pnpm check` 与相关定向测试，再运行：

```powershell
$isolated = node scripts/environment.mjs | ConvertFrom-Json
foreach ($item in $isolated.PSObject.Properties) { Set-Item -Path "env:$($item.Name)" -Value $item.Value }
pnpm.cmd bundle
```

自动化代理须先在 `Temp/temp-registry.json` 将 `release` 登记为 `retain`（保存发布产物），用途与保留原因填写清楚。首次构建需要联网下载 NSIS 工具链；`useLocalToolsDir` 将其缓存在 `Temp/release/target/.tauri/`。

`pnpm bundle` 依次核对 workspace、npm 与 Tauri 的版本和发行配置，检查依赖许可并生成清单，写入安装标记与临时合并配置，然后构建当前用户安装的 NSIS 包。许可违规会中止流程。安装语言按系统语言选择简体中文或英文，不显示语言选择器；WebView2 使用 Tauri 默认安装方式。

安装目录中包含应用可执行文件、`tenon-installed.marker`、`THIRD_PARTY_LICENSES.md`、`THIRD_PARTY_NOTICES.md` 和 `LICENSE`。标记内容为一行 `installed`，宿主通过 exe 同级的该文件识别安装范围，自启还会结合开发模式和显式数据根判断是否可用。

打包专用合并配置位于 `Temp/release/tauri.bundle.json`，cargo 目标目录为 `Temp/release/target/`，避免把安装标记遗留到普通 `pnpm build` 使用的 `Temp/cargo-target/` 中。

最终产物在 `Temp/release/out/`：

- `dushan-tenon-<版本>-x64-setup.exe`
- `THIRD_PARTY_LICENSES.md`
- `SHA256SUMS.txt`（安装包与许可清单的 SHA-256，采用 `sha256sum` 格式）

脚本会打印产物路径、字节数和 SHA-256。安装包未进行代码签名，Windows SmartScreen 可能显示未识别应用提示；发布时应说明并提供校验和。若 NSIS 不接受预发布版本号，应停止并报告，不自行改号。

更新器尚未配置：`src-tauri/release.json` 保持 `null`，本次不生成更新器签名产物。标签、私有 Release 和安装验收由维护者另行执行。
