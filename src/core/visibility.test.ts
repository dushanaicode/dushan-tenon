import { expect, test } from "vitest";
import type { Visibility } from "@/core/contracts/module";
import { evaluateVisibility, type VisibilityAuth } from "./visibility";

const auth: VisibilityAuth = {
  authenticated: true,
  developerMode: false,
  mode: "login",
  permissions: ["files.file.read", "files.file.write"],
};

test.each<[Visibility, Partial<VisibilityAuth>, string]>([
  [{}, {}, "visible"],
  [{}, { authenticated: false }, "forbidden"],
  [{ developerOnly: true }, {}, "notFound"],
  [{ developerOnly: true, permission: "ai.service.manage" }, {}, "notFound"],
  [{ developerOnly: true }, { authenticated: false }, "forbidden"],
  [{ developerOnly: true }, { developerMode: true }, "visible"],
  [
    { developerOnly: true, permission: "ai.service.manage" },
    { developerMode: true },
    "forbidden",
  ],
  [
    { developerOnly: true, anyPermissions: ["ai.service.manage"] },
    { developerMode: true },
    "forbidden",
  ],
  [
    { developerOnly: true, authMode: "none" },
    { developerMode: true },
    "forbidden",
  ],
  [{ authMode: "none" }, {}, "forbidden"],
  [{ authMode: "login" }, {}, "visible"],
  [{ permission: "ai.service.manage" }, {}, "forbidden"],
  [{ anyPermissions: [] }, {}, "visible"],
  [{ anyPermissions: ["ai.service.manage", "files.file.read"] }, {}, "visible"],
  [{ anyPermissions: ["ai.service.manage"] }, {}, "forbidden"],
  [
    { permission: "ai.service.manage", anyPermissions: ["files.file.read"] },
    {},
    "forbidden",
  ],
  [
    { permission: "files.file.read", anyPermissions: ["ai.service.manage"] },
    {},
    "forbidden",
  ],
  [
    {
      permission: "files.file.read",
      anyPermissions: ["files.file.write"],
      authMode: "login",
    },
    {},
    "visible",
  ],
])(
  "visibility combines all declared conditions: %j %j",
  (rule, patch, result) => {
    expect(evaluateVisibility(rule, { ...auth, ...patch })).toBe(result);
  },
);
