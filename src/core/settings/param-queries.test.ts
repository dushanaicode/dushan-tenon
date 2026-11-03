import { expect, test } from "vitest";
import { paramEntries } from "@/core/core.test-support";
import { sortParams } from "./param-queries";

test("parameter ordering uses ASCII group, order and key", () => {
  const rows = [
    { group: "a.z", order: 0, key: "a.a" },
    { group: "a-z", order: 1, key: "a.z" },
    { group: "a-z", order: 1, key: "a-z" },
    { group: "a-z", order: 0, key: "a.zz" },
  ].map((item) => ({ ...paramEntries[0], ...item }));
  expect(sortParams(rows).map((row) => row.key)).toEqual([
    "a.zz",
    "a-z",
    "a.z",
    "a.a",
  ]);
  expect(rows[0].group).toBe("a.z");
});
