// 自动生成，勿手改。运行 pnpm generate 更新。
export const PERMISSION_KEYS = [
  "account.security.manage",
  "files.file.read",
  "files.file.write",
  "devtools.job.read",
  "devtools.job.write",
  "demo.sample.read",
  "demo.sample.write",
  "demo.sample.import",
  "demo.sample.export",
  "demo.sample.run",
  "demo.settings.manage",
] as const;
export const MODULE_IDS = [
  "account",
  "notify",
  "files",
  "devtools",
  "demo",
] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type ModuleId = (typeof MODULE_IDS)[number];
