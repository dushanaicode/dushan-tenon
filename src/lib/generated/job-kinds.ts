// 自动生成，勿手改。运行 pnpm generate 更新。
export const JOB_KINDS = [
  "demo.measure",
  "demo.sample_import",
  "demo.sample_export",
] as const;
export type JobKind = (typeof JOB_KINDS)[number];
