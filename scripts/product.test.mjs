import assert from "node:assert/strict";
import test from "node:test";
import { productFromCargo } from "./product.mjs";

test("product derives package, CLI and qualified feature from package table", () => {
  assert.deepEqual(
    productFromCargo(
      '[dependencies]\nname="wrong"\n[package]\nname = "example-host"\nversion="1"\n[lib]\nname="other"\n',
    ),
    {
      hostPackage: "example-host",
      hostCli: "example-host-cli",
      hostDbCliFeature: "example-host/db-cli",
    },
  );
  assert.equal(
    productFromCargo('[package]\r\nname="host"\r\n').hostPackage,
    "host",
  );
});

test("product refuses absent package name and names in other tables", () => {
  for (const source of [
    '[lib]\nname="other"',
    '[package]\nversion="1"\n[lib]\nname="other"',
    '[package]\nname=""',
  ]) {
    assert.throws(() => productFromCargo(source), /\[package\] name/);
  }
});
