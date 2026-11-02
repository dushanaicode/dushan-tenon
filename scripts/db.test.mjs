import assert from "node:assert/strict";
import test from "node:test";
import { snapshotCrates } from "./db.mjs";

test("snapshot crates derive from direct crate snapshot directories", () => {
  assert.deepEqual(
    snapshotCrates([
      "crates/module-demo/sql-snapshots",
      "crates/framework/sql-snapshots",
      "crates/desktop/src",
    ]),
    ["tenon-framework", "tenon-module-demo"],
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
