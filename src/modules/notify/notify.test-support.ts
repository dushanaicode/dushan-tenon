import type { ParamEntry } from "@/lib/generated/ParamEntry";

export const notifyParams: ParamEntry[] = (
  [
    {
      key: "notify.job_succeeded",
      kind: { type: "boolean" },
      value: "true",
      order: 10,
    },
    {
      key: "notify.job_failed",
      kind: { type: "boolean" },
      value: "true",
      order: 20,
    },
    {
      key: "notify.job_needs_review",
      kind: { type: "boolean" },
      value: "true",
      order: 30,
    },
    {
      key: "notify.desktop_when_focused",
      kind: { type: "boolean" },
      value: "true",
      order: 40,
    },
    {
      key: "notify.quiet_enabled",
      kind: { type: "boolean" },
      value: "false",
      order: 50,
    },
    {
      key: "notify.quiet_start_hour",
      kind: { type: "integer", min: 0, max: 23 },
      value: "22",
      order: 60,
    },
    {
      key: "notify.quiet_end_hour",
      kind: { type: "integer", min: 0, max: 23 },
      value: "8",
      order: 70,
    },
    {
      key: "notify.in_app_toast",
      kind: { type: "boolean" },
      value: "true",
      order: 80,
    },
    {
      key: "notify.toast_seconds",
      kind: { type: "integer", min: 0, max: 60 },
      value: "6",
      order: 90,
    },
    {
      key: "notify.toast_position",
      kind: {
        type: "choice",
        values: [
          "bottom-right",
          "bottom-left",
          "bottom-center",
          "top-right",
          "top-left",
          "top-center",
        ],
      },
      value: "bottom-right",
      order: 100,
    },
    {
      key: "notify.retention_days",
      kind: { type: "integer", min: 0, max: 365 },
      value: "0",
      order: 110,
    },
  ] satisfies Pick<ParamEntry, "key" | "kind" | "value" | "order">[]
).map((entry) => ({
  ...entry,
  moduleId: "notify",
  default: entry.value,
  isDefault: true,
  secretSet: false,
  rowVersion: null,
  updatedAt: null,
  group: "notify.preferences",
  readPermission: null,
  writePermission: null,
  effect: "nextRead",
  source: "default",
}));
