import assert from "node:assert/strict";
import test from "node:test";
import { databaseArgs, snapshotCrates } from "./db.mjs";
import { hostCli, hostDbCliFeature, hostPackage } from "./product.mjs";

test("database commands route through the derived CLI with explicit state and backup confirmation", () => {
  for (const command of ["status", "upgrade"]) {
    const args = ["--state-root", "Temp/state", "--confirm-backup"];
    assert.deepEqual(databaseArgs(command, args, {}), [
      "run",
      "--locked",
      "--package",
      hostPackage,
      "--bin",
      hostCli,
      "--features",
      hostDbCliFeature,
      "--",
      "db",
      command,
      ...args,
    ]);
    assert.doesNotThrow(() =>
      databaseArgs(command, [], { TENON_STATE_ROOT: "Temp/state" }),
    );
    assert.doesNotThrow(() =>
      databaseArgs(command, ["--state-root=Temp/state"], {}),
    );
    assert.throws(() => databaseArgs(command, [], {}), /state-root/);
  }
  assert.doesNotThrow(() =>
    databaseArgs("export-sql", ["--dialect", "postgres"], {}),
  );
  assert.doesNotThrow(() => databaseArgs("status", ["--help"], {}));
  assert.throws(() => databaseArgs("unknown", [], {}), /未知/);
});

test("snapshot crates derive from direct crate snapshot directories", () => {
  assert.deepEqual(
    snapshotCrates([
      "crates/module-sample/sql-snapshots",
      "crates/framework/sql-snapshots",
      "crates/desktop/src",
    ]),
    ["tenon-framework", "tenon-module-sample"],
  );
});

test("snapshot crates support Windows paths and remove duplicates", () => {
  assert.deepEqual(
    snapshotCrates([
      "crates\\framework\\sql-snapshots",
      "crates/framework/sql-snapshots",
    ]),
    ["tenon-framework"],
  );
});

test("snapshot crates exclude other roots and nested snapshot directories", () => {
  assert.deepEqual(
    snapshotCrates([
      "sql-snapshots",
      "other/framework/sql-snapshots",
      "crates/framework/src/sql-snapshots",
      "crates/framework/sql-snapshots/sqlite",
    ]),
    [],
  );
  assert.deepEqual(snapshotCrates([]), []);
});
