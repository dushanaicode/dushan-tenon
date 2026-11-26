import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  bundleConfig,
  checksumFile,
  installerName,
  updateManifest,
} from "./bundle.mjs";

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

const release = {
  channel: "stable",
  downloadHosts: ["github.com", "release-assets.githubusercontent.com"],
  endpoints: [
    "https://github.com/fixture/app/releases/latest/download/latest.json",
  ],
  productId: "com.example.fixture",
  pubkey: "unused",
  target: "windows-x86_64-nsis",
};

test("update manifest points at the tagged GitHub asset under the release target", () => {
  assert.deepEqual(
    updateManifest({
      release,
      version: "0.1.0",
      name: "fixture-app-0.1.0-x64-setup.exe",
      signature: "c2lnbmF0dXJl\n",
      date: new Date("2026-11-26T00:00:00Z"),
    }),
    {
      version: "0.1.0",
      notes: "https://github.com/fixture/app/releases/tag/v0.1.0",
      pub_date: "2026-11-26T00:00:00.000Z",
      platforms: {
        "windows-x86_64-nsis": {
          signature: "c2lnbmF0dXJl",
          url: "https://github.com/fixture/app/releases/download/v0.1.0/fixture-app-0.1.0-x64-setup.exe",
        },
      },
    },
  );
});

test("update manifest refuses other endpoints and unlisted download hosts", () => {
  const input = {
    version: "0.1.0",
    name: "fixture-app-0.1.0-x64-setup.exe",
    signature: "c2lnbmF0dXJl",
    date: new Date(),
  };
  assert.throws(
    () =>
      updateManifest({
        ...input,
        release: {
          ...release,
          endpoints: ["https://updates.example.test/latest.json"],
        },
      }),
    /GitHub Releases/,
  );
  assert.throws(
    () =>
      updateManifest({
        ...input,
        release: {
          ...release,
          downloadHosts: ["release-assets.githubusercontent.com"],
        },
      }),
    /downloadHosts/,
  );
});
