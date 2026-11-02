import { afterEach, expect, test, vi } from "vitest";
import { isId, newId } from "./id";
import { malformedIds } from "./id.test-support";

const uuidV7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.useRealTimers();
});

test("newId returns a lowercase, hyphenated UUIDv7 with the RFC variant", () => {
  expect(newId()).toMatch(uuidV7);
});

test("isId accepts newId output", () => {
  expect(isId(newId())).toBe(true);
});

test.each([
  ...malformedIds(),
  ["job-1", "job-1"],
  ["trailing newline", `${newId()}\n`],
] as const)("isId rejects %s", (_name, value) => {
  expect(isId(value)).toBe(false);
});

test("malformedIds changes the intended UUID groups when the second group starts with 7", () => {
  const base = "01999000-7000-7123-8123-123456789abc";
  const ids = new Map(malformedIds(base));
  expect(isId(base)).toBe(true);
  for (const [label, id] of ids) {
    expect(isId(id), label).toBe(false);
  }
  expect(ids.get("v4")).toBe("01999000-7000-4123-8123-123456789abc");
  expect(ids.get("invalid variant")).toBe(
    "01999000-7000-7123-0123-123456789abc",
  );
});

test("malformedIds rejects every sample from 500 newId outputs", () => {
  for (let index = 0; index < 500; index += 1) {
    for (const [label, id] of malformedIds(newId())) {
      expect(isId(id), label).toBe(false);
    }
  }
});

test("newId encodes the millisecond timestamp in the first 48 bits", () => {
  vi.useFakeTimers();
  const timestamp = Date.UTC(2026, 9, 20, 12, 34, 56, 789);
  vi.setSystemTime(timestamp);
  expect(newId().replaceAll("-", "").slice(0, 12)).toBe(
    timestamp.toString(16).padStart(12, "0"),
  );
});

test("newId sorts a later millisecond after an earlier one", () => {
  vi.useFakeTimers();
  const timestamp = Date.UTC(2026, 9, 20);
  vi.setSystemTime(timestamp);
  const earlier = newId();
  vi.setSystemTime(timestamp + 1);
  const later = newId();
  expect(later > earlier).toBe(true);
});

test("newId generates 1000 distinct IDs within one millisecond", () => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 20));
  expect(new Set(Array.from({ length: 1000 }, () => newId())).size).toBe(1000);
});
