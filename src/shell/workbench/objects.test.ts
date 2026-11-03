import { expect, test } from "vitest";
import { testManifest } from "@/core/module-directory.test-support";

const manifests = [testManifest()];

import type { ObjectRef } from "@/core/contracts/workbench";
import {
  accessibleContribution,
  closeObject,
  objectContributions,
  objectFromPath,
  objectKey,
  openObject,
  retainObjects,
} from "./objects";

const first: ObjectRef = {
  kind: "job",
  id: "01999000-1234-7000-8000-123456789abc",
};
const second: ObjectRef = {
  ...first,
  id: "01999000-1234-7000-8000-123456789abd",
};
const third: ObjectRef = {
  ...first,
  id: "01999000-1234-7000-8000-123456789abe",
};

test("open_deduplicates_and_close_uses_right_then_left_neighbor", () => {
  const state = { objects: [first, second, third], activeObject: second };
  expect(openObject(state, second)).toEqual(state);
  expect(closeObject(state, second)).toEqual({
    objects: [first, third],
    activeObject: third,
  });
  expect(closeObject(state, first)).toEqual({
    objects: [second, third],
    activeObject: second,
  });
  expect(
    closeObject({ objects: [first, third], activeObject: third }, third),
  ).toEqual({
    objects: [first],
    activeObject: first,
  });
  expect(closeObject({ objects: [first], activeObject: first }, first)).toEqual(
    {
      objects: [],
      activeObject: null,
    },
  );
});

test("restore_filters_permissions_without_titles", () => {
  const contributions = objectContributions(manifests);
  const auth = {
    authenticated: true,
    developerMode: true,
    mode: "none" as const,
    permissions: ["devtools.job.read"],
  };
  expect(
    accessibleContribution(contributions, first, new Set(["devtools"]), auth)
      ?.kind,
  ).toBe("job");
  for (const forbidden of [
    { ...auth, developerMode: false },
    { ...auth, permissions: [] },
    { ...auth, authenticated: false },
  ]) {
    expect(
      accessibleContribution(
        contributions,
        first,
        new Set(["devtools"]),
        forbidden,
      ),
    ).toBeUndefined();
  }
  expect(
    accessibleContribution(contributions, first, new Set(["account"]), auth),
  ).toBeUndefined();
  expect(
    retainObjects(
      { objects: [first, second], activeObject: first },
      new Set([objectKey(second)]),
    ),
  ).toEqual({
    objects: [second],
    activeObject: second,
  });
  expect(Object.keys(first)).toEqual(["kind", "id"]);
});

test("route_references_are_exact_and_kinds_are_unique", () => {
  const contributions = objectContributions(manifests);
  expect(objectFromPath(contributions, `/devtools/jobs/${first.id}`)).toEqual(
    first,
  );
  for (const path of [
    "/devtools/jobs",
    "/settings",
    "/devtools/jobs/job-1",
    `/devtools/jobs/${first.id}/extra`,
    `/DEVTOOLS/jobs/${first.id}`,
  ]) {
    expect(objectFromPath(contributions, path)).toBeNull();
  }
  const devtools = manifests.find(({ id }) => id === "devtools");
  if (!devtools) throw new Error("Devtools manifest required");
  expect(() => objectContributions([devtools, devtools])).toThrow("Duplicate");
});
