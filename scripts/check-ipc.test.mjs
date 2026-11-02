import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  checkCommandAdmission,
  compareGenerated,
  missingTranslations,
} from "./check-ipc.mjs";

test("admission rejects duplicate, missing, incorrect and mismatched access declarations", () => {
  const entries = [
    ["app_operation_cancel", "control"],
    ["account_auth_status", "normal"],
    ["app_backup_export", "maintenance"],
  ];
  const access = [
    ["app_operation_cancel", "execute_control"],
    ["account_auth_status", "execute_public"],
    ["app_backup_export", "execute"],
  ];
  assert.doesNotThrow(() => checkCommandAdmission(entries, access));
  assert.throws(
    () =>
      checkCommandAdmission(
        [...entries, entries[0]],
        [...access, ["unexpected", "execute"]],
      ),
    /重复/,
  );
  assert.throws(() => checkCommandAdmission(entries, access.slice(1)), /集合/);
  assert.throws(
    () =>
      checkCommandAdmission(
        [["account_auth_status", "maintenance"]],
        [["account_auth_status", "execute_public"]],
      ),
    /未经许可/,
  );
  assert.throws(
    () =>
      checkCommandAdmission(
        [["app_operation_cancel", "control"]],
        [["app_operation_cancel", "execute"]],
      ),
    /冲突/,
  );
  assert.throws(
    () =>
      checkCommandAdmission(
        [["app_settings_get", "normal"]],
        [["different", "execute"]],
      ),
    /冲突/,
  );
});

test("translation checking lists every missing and blank bilingual key once", () => {
  const keys = ["errors.a", "permissions.b", "modules.names.c", "errors.a"];
  assert.deepEqual(
    missingTranslations({ "errors.a": "ok", "permissions.b": " " }, keys),
    ["modules.names.c", "permissions.b"],
  );
  assert.deepEqual(missingTranslations({}, keys), [
    "errors.a",
    "modules.names.c",
    "permissions.b",
  ]);
});

test("contract comparison rejects additions, removals and byte drift", async () => {
  const directory = await mkdtemp(join(process.env.TEMP, "ipc-drift-"));
  const expected = join(directory, "expected");
  await mkdir(expected);
  await writeFile(join(expected, "value.ts"), "export const value = 1;\n");
  for (const [name, files, error] of [
    ["same", [["value.ts", "export const value = 1;\n"]], null],
    ["missing", [], /清单/],
    [
      "extra",
      [
        ["value.ts", "export const value = 1;\n"],
        ["stale.ts", "stale"],
      ],
      /清单/,
    ],
    ["bytes", [["value.ts", "export const value = 1;\r\n"]], /value.ts/],
  ]) {
    const actual = join(directory, name);
    await mkdir(actual);
    for (const [file, content] of files)
      await writeFile(join(actual, file), content);
    if (error) await assert.rejects(compareGenerated(expected, actual), error);
    else await compareGenerated(expected, actual);
  }
});
