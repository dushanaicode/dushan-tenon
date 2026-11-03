export type NavBadge =
  | { kind: "count"; value: number }
  | { kind: "new"; labelKey: string };
