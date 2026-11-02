import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, run, task } from "./common.mjs";

export function snapshotCrates(directories) {
  return [
    ...new Set(
      directories.flatMap((directory) => {
        const match = /^crates\/([^/]+)\/sql-snapshots$/.exec(
          directory.replaceAll("\\", "/"),
        );
        return match ? [`tenon-${match[1]}`] : [];
      }),
    ),
  ].sort();
}

async function snapshot() {
  await task("db", async (env) => {
    const directories = [];
    for (const crate of await readdir(join(root, "crates"), {
      withFileTypes: true,
    })) {
      if (!crate.isDirectory()) continue;
      for (const entry of await readdir(join(root, "crates", crate.name), {
        withFileTypes: true,
      })) {
        if (entry.isDirectory())
          directories.push(join("crates", crate.name, entry.name));
      }
    }
    for (const crate of snapshotCrates(directories)) {
      await run(
        `生成 ${crate} 迁移快照`,
        "cargo",
        [
          "test",
          "--locked",
          "-p",
          crate,
          "--lib",
          "generate_sql_snapshots",
          "--",
          "--ignored",
        ],
        env,
      );
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length === 3 && process.argv[2] === "snapshot") {
    await snapshot();
  } else {
    console.error("用法: pnpm db snapshot");
    process.exitCode = 1;
  }
}
