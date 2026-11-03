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
  [{ developerOnly: true, permission: "devtools.job.write" }, {}, "notFound"],
  [{ developerOnly: true }, { authenticated: false }, "forbidden"],
  [{ developerOnly: true }, { developerMode: true }, "visible"],
  [
    { developerOnly: true, permission: "devtools.job.write" },
    { developerMode: true },
    "forbidden",
  ],
  [
    { developerOnly: true, anyPermissions: ["devtools.job.write"] },
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
  [{ permission: "devtools.job.write" }, {}, "forbidden"],
  [{ anyPermissions: [] }, {}, "visible"],
  [
    { anyPermissions: ["devtools.job.write", "files.file.read"] },
    {},
    "visible",
  ],
  [{ anyPermissions: ["devtools.job.write"] }, {}, "forbidden"],
  [
    { permission: "devtools.job.write", anyPermissions: ["files.file.read"] },
    {},
    "forbidden",
  ],
  [
    { permission: "files.file.read", anyPermissions: ["devtools.job.write"] },
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
