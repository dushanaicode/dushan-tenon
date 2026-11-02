import { checkIdentity } from "./check-identity.mjs";
import { checkStructure } from "./check-structure.mjs";
import { run, runBin, task } from "./common.mjs";

await task("check", async (env) => {
  await run("Rust 格式", "cargo", ["fmt", "--all", "--check"], env);
  await run(
    "Rust Clippy",
    "cargo",
    [
      "clippy",
      "--workspace",
      "--all-targets",
      "--locked",
      "--",
      "-D",
      "warnings",
    ],
    env,
  );
  await runBin("TypeScript 类型", "typescript", "tsc", ["--noEmit"], env);
  await checkStructure(env);
  await checkIdentity();
  await runBin("Biome", "@biomejs/biome", "biome", ["check", "."], env);
});
