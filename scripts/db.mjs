import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { root, run, task } from "./common.mjs";
import { hostCli, hostDbCliFeature, hostPackage } from "./product.mjs";

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

export function databaseArgs(command, args, env) {
  if (!["status", "upgrade", "export-sql"].includes(command)) {
    throw new Error(`未知数据库子命令: ${command}`);
  }
  if (
    command !== "export-sql" &&
    !args.includes("--help") &&
    !args.includes("-h") &&
    !args.some(
      (arg) => arg === "--state-root" || arg.startsWith("--state-root="),
    ) &&
    env.TENON_STATE_ROOT === undefined
  ) {
    throw new Error("数据库命令需要 --state-root <PATH> 或 TENON_STATE_ROOT");
  }
  return [
    "run",
    "--locked",
    "--package",
    hostPackage,
    "--bin",
    hostCli,
    "--features",
    hostDbCliFeature,
    "--",
    "db",
    command,
    ...args,
  ];
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv.length === 3 && process.argv[2] === "snapshot") {
    await snapshot();
  } else if (
    process.argv.length === 2 ||
    ["--help", "-h"].includes(process.argv[2])
  ) {
    console.log(
      "用法: pnpm db <status|upgrade|export-sql|snapshot> [参数]\nstatus/upgrade 需要 --state-root 或 TENON_STATE_ROOT；远端 upgrade 需要 --confirm-backup。",
    );
  } else {
    await task("db", async (env) => {
      await run(
        "数据库命令",
        "cargo",
        databaseArgs(process.argv[2], process.argv.slice(3), env),
        env,
      );
    });
  }
}
