import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./common.mjs";

export function productFromCargo(cargo) {
  const section = cargo.match(
    /^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m,
  );
  const name = section?.[1].match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
  if (!name) throw new Error("无法解析 src-tauri/Cargo.toml 的 [package] name");
  return {
    hostPackage: name,
    hostCli: `${name}-cli`,
    hostDbCliFeature: `${name}/db-cli`,
  };
}

export const { hostPackage, hostCli, hostDbCliFeature } = productFromCargo(
  await readFile(join(root, "src-tauri/Cargo.toml"), "utf8"),
);
