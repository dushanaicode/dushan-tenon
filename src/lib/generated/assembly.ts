// 自动生成，勿手改。运行 pnpm generate 更新。
export const MODULE_CATALOG = [
  {
    core: true,
    dependencies: [],
    id: "account",
    requiredCapabilities: [],
    version: "0.1.0",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "notify",
    requiredCapabilities: ["job"],
    version: "0.1.0",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "files",
    requiredCapabilities: ["file"],
    version: "0.1.0",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "devtools",
    requiredCapabilities: ["job"],
    version: "0.1.0",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "ai",
    requiredCapabilities: [],
    version: "0.1.0",
  },
  {
    core: false,
    dependencies: ["account", "ai"],
    id: "demo",
    requiredCapabilities: ["job", "exchange", "file"],
    version: "0.1.0",
  },
] as const;
