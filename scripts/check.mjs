import { checkAssembly } from "./check-assembly.mjs";
import { checkIdentity } from "./check-identity.mjs";
import { checkIpc } from "./check-ipc.mjs";
import { checkKit } from "./check-kit.mjs";
import { checkLicenses } from "./check-licenses.mjs";
import { checkRelease } from "./check-release.mjs";
import { checkShowcase } from "./check-showcase.mjs";
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
      "--all-features",
      "--locked",
      "--",
      "-D",
      "warnings",
    ],
    env,
  );
  await runBin("TypeScript 类型", "typescript", "tsc", ["--noEmit"], env);
  await checkStructure(env);
  await checkIpc(env);
  await checkKit(env);
  await checkAssembly(env);
  await checkShowcase(env);
  await checkIdentity();
  await checkRelease();
  await checkLicenses();
  await runBin("Biome", "@biomejs/biome", "biome", ["check", "."], env);
});
