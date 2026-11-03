import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { behaviorExamples } from "./pages/appearance-behavior-page";
import { appearanceExamples } from "./pages/appearance-page";

test("appearance and behavior source panels load their current real examples", async () => {
  for (const example of [...appearanceExamples, ...behaviorExamples])
    expect((await example.load?.())?.default).toBe(
      readFileSync(example.file, "utf8"),
    );
});
