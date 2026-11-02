import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { environment, root } from "./common.mjs";

const isolated = {
  ...(await environment("install")),
  CARGO_HOME: join(root, "Temp/cargo-home"),
  COREPACK_HOME: join(root, "Temp/corepack"),
  npm_config_cache: join(root, "Temp/npm-cache"),
  NODE_COMPILE_CACHE: join(root, "Temp/node-compile-cache"),
  PNPM_CONFIG_STORE_DIR: join(root, "Temp/pnpm-store"),
  PNPM_CONFIG_CACHE_DIR: join(root, "Temp/pnpm-cache"),
  PNPM_CONFIG_STATE_DIR: join(root, "Temp/pnpm-state"),
  PNPM_CONFIG_VIRTUAL_STORE_DIR: join(root, "Temp/pnpm-virtual-store"),
};

await Promise.all(
  [...new Set(Object.values(isolated))].map((path) =>
    mkdir(path, { recursive: true }),
  ),
);

// 仅输出隔离模式需要设置的路径，不输出调用者的其他环境变量。
console.log(JSON.stringify(isolated));
