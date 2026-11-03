// 自动生成，勿手改。运行 pnpm generate 更新。
export const MODULE_CATALOG = [
  {
    core: true,
    dependencies: [],
    id: "account",
    requiredCapabilities: [],
    version: "0.1.0-alpha.1",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "notify",
    requiredCapabilities: ["job"],
    version: "0.1.0-alpha.1",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "files",
    requiredCapabilities: ["file"],
    version: "0.1.0-alpha.1",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "devtools",
    requiredCapabilities: ["job"],
    version: "0.1.0-alpha.1",
  },
  {
    core: false,
    dependencies: ["account"],
    id: "demo",
    requiredCapabilities: ["job", "exchange", "file"],
    version: "0.1.0-alpha.1",
  },
] as const;
export const PRESET_CATALOG = [
  {
    enabledModules: ["account", "notify", "files", "devtools", "demo"],
    name: "full",
  },
  { enabledModules: ["account"], name: "minimal" },
  { enabledModules: ["account", "notify"], name: "tool" },
] as const;
export type PresetName = (typeof PRESET_CATALOG)[number]["name"];
