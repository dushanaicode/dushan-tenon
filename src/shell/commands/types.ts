import type { LucideIcon } from "lucide-react";

export type CommandGroupId =
  | "pages"
  | "actions"
  | "appearance"
  | "language"
  | "account";

export type ShellCommand = {
  id: string;
  label: string;
  group: CommandGroupId;
  keywords: string[];
  Icon?: LucideIcon;
  shortcut?: string;
  disabledReason?: string;
  run: () => void | Promise<void>;
};
