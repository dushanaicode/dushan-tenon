import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkRelease } from "./check-release.mjs";
import { root, run, runBin, task } from "./common.mjs";
import { hostPackage } from "./product.mjs";

export function bundleConfig() {
  return {
    bundle: {
      targets: ["nsis"],
      useLocalToolsDir: true,
      resources: {
        "../Temp/release/tenon-installed.marker": "tenon-installed.marker",
        "../Temp/release/THIRD_PARTY_LICENSES.md": "THIRD_PARTY_LICENSES.md",
        "../THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
        "../LICENSE": "LICENSE",
      },
    },
  };
}

export function installerName(program, version) {
  return `${program}-${version}-x64-setup.exe`;
}

export function checksumFile(artifacts) {
  return artifacts.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join("");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await task("release", async (env) => {
    await checkRelease();
    if (process.platform !== "win32" || process.arch !== "x64")
      throw new Error("安装包仅支持在 Windows x64 环境构建");
    const { version } = JSON.parse(
      await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
    );
    const directory = join(root, "Temp/release");
    const notices = join(directory, "THIRD_PARTY_LICENSES.md");
    await run(
      "第三方许可清单",
      process.execPath,
      ["scripts/check-licenses.mjs", "--notices", notices],
      env,
    );
    await writeFile(join(directory, "tenon-installed.marker"), "installed\n");
    const config = join(directory, "tauri.bundle.json");
    await writeFile(config, `${JSON.stringify(bundleConfig(), null, 2)}\n`);
    const target = join(directory, "target");
    await runBin(
      "Windows NSIS 安装包",
      "@tauri-apps/cli",
      "tauri",
      ["build", "--bundles", "nsis", "--config", config],
      { ...env, CARGO_TARGET_DIR: target },
    );
    const nsis = join(target, "release/bundle/nsis");
    const installers = (await readdir(nsis)).filter((name) =>
      name.endsWith(`_${version}_x64-setup.exe`),
    );
    if (installers.length !== 1)
      throw new Error(`预期一个当前版本的 x64 安装包，请核对 ${nsis}`);
    const out = join(directory, "out");
    await mkdir(out, { recursive: true });
    const name = installerName(hostPackage, version);
    await copyFile(join(nsis, installers[0]), join(out, name));
    await copyFile(notices, join(out, "THIRD_PARTY_LICENSES.md"));
    const artifacts = [];
    for (const name of [
      installerName(hostPackage, version),
      "THIRD_PARTY_LICENSES.md",
    ]) {
      const data = await readFile(join(out, name));
      artifacts.push({
        name,
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
    const sums = checksumFile(artifacts);
    await writeFile(join(out, "SHA256SUMS.txt"), sums);
    artifacts.push({
      name: "SHA256SUMS.txt",
      bytes: Buffer.byteLength(sums),
      sha256: createHash("sha256").update(sums).digest("hex"),
    });
    for (const { name, bytes, sha256 } of artifacts)
      console.log(`${join(out, name)}\n  ${bytes} bytes\n  SHA-256 ${sha256}`);
  });
}
