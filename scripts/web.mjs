import { runBin, task } from "./common.mjs";

const command = process.argv[2];
await task(command === "dev" ? "dev" : "build", async (env) => {
  if (!["dev", "build"].includes(command)) {
    throw new Error("用法: node scripts/web.mjs <dev|build>");
  }
  await runBin(
    `Vite ${command}`,
    "vite",
    "vite",
    [...(command === "build" ? ["build"] : []), "--configLoader", "native"],
    env,
  );
});
