// 自动生成，勿手改。运行 pnpm generate 更新。
export const DICT_CODES = [
  "framework.exchange_format",
  "framework.job_status",
  "framework.cache_status",
  "notify.channel",
  "notify.delivery_status",
  "demo.sample_stage",
] as const;
export const DICT_MESSAGE_KEYS = [
  "dict.framework.exchange_format",
  "dict.framework.exchange_format.xlsx",
  "dict.framework.exchange_format.csv",
  "dict.framework.exchange_format.json",
  "dict.framework.job_status",
  "dict.framework.job_status.queued",
  "dict.framework.job_status.running",
  "dict.framework.job_status.succeeded",
  "dict.framework.job_status.failed",
  "dict.framework.job_status.cancelled",
  "dict.framework.job_status.needs_review",
  "dict.framework.cache_status",
  "dict.framework.cache_status.connected",
  "dict.framework.cache_status.error",
  "dict.notify.channel",
  "dict.notify.channel.in_app",
  "dict.notify.channel.desktop",
  "dict.notify.delivery_status",
  "dict.notify.delivery_status.delivered",
  "dict.notify.delivery_status.failed",
  "dict.notify.delivery_status.unknown",
  "dict.notify.delivery_status.skipped",
  "dict.demo.sample_stage",
  "dict.demo.sample_stage.draft",
  "dict.demo.sample_stage.ready",
] as const;
export const DICTIONARIES = {
  "demo.sample_stage": [
    { tone: "neutral", value: "draft" },
    { tone: "success", value: "ready" },
  ],
  "framework.cache_status": [
    { tone: "success", value: "connected" },
    { tone: "danger", value: "error" },
  ],
  "framework.exchange_format": [
    { tone: "success", value: "xlsx" },
    { tone: "info", value: "csv" },
    { tone: "neutral", value: "json" },
  ],
  "framework.job_status": [
    { tone: "info", value: "queued" },
    { tone: "info", value: "running" },
    { tone: "success", value: "succeeded" },
    { tone: "danger", value: "failed" },
    { tone: "neutral", value: "cancelled" },
    { tone: "warning", value: "needs_review" },
  ],
  "notify.channel": [
    { tone: "neutral", value: "in_app" },
    { tone: "neutral", value: "desktop" },
  ],
  "notify.delivery_status": [
    { tone: "success", value: "delivered" },
    { tone: "danger", value: "failed" },
    { tone: "warning", value: "unknown" },
    { tone: "neutral", value: "skipped" },
  ],
} as const;
export type DictCode = (typeof DICT_CODES)[number];
