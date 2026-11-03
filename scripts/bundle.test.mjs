import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { bundleConfig, checksumFile, installerName } from "./bundle.mjs";

test("NSIS overlay maps all resources beside the executable and uses local tools", () => {
  assert.deepEqual(bundleConfig(), {
    bundle: {
      targets: ["nsis"],
      useLocalToolsDir: true,
      resources: {
        "../Temp/release/tenon-installed.marker": "tenon-installed.marker",
        "../Temp/release/THIRD_PARTY_LICENSES.md": "THIRD_PARTY_LICENSES.md",
        "../THIRD_PARTY_NOTICES.md": "THIRD_PARTY_NOTICES.md",
        "../LICENSE": "LICENSE",
      },
    },
  });
});

test("installer name preserves prerelease version and reads the supplied program", () => {
  assert.equal(
    installerName("fixture-app", "0.1.0-alpha.1"),
    "fixture-app-0.1.0-alpha.1-x64-setup.exe",
  );
});

test("SHA256SUMS uses lowercase SHA-256, two spaces, basenames and a final newline", () => {
  const name = installerName("fixture-app", "0.1.0-alpha.1");
  const sha256 = createHash("sha256").update("fixture installer").digest("hex");
  const licenseHash = createHash("sha256")
    .update("fixture license")
    .digest("hex");
  const result = checksumFile([
    { name, sha256 },
    { name: "THIRD_PARTY_LICENSES.md", sha256: licenseHash },
  ]);
  assert.equal(
    result,
    `${sha256}  ${name}\n${licenseHash}  THIRD_PARTY_LICENSES.md\n`,
  );
  assert.match(result, /^(?:[0-9a-f]{64} {2}[^/\\\r\n]+\n){2}$/);
});
