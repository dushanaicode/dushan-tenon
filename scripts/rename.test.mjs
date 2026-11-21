import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { parseIdentity, renameRepository, renamer } from "./rename.mjs";

const from = {
  product: "Old Board",
  binary: "old-board",
  identifier: "com.old.board",
};
const to = {
  product: "Example Notes",
  binary: "example-notes",
  identifier: "com.example.notes",
};

test("rename replaces identity and every case of the code name", () => {
  const replace = renamer(from, to);
  for (const [before, after] of [
    ["Old Board（旧名）", "Example Notes（旧名）"],
    ["com.old.board", "com.example.notes"],
    ["old-board-cli.rs", "example-notes-cli.rs"],
    ["old_board_lib::contract", "example_notes_lib::contract"],
    ["board_framework::error", "notes_framework::error"],
    ["board-module-account", "notes-module-account"],
    ["BOARD_STATE_ROOT BOARD__LOGGING", "NOTES_STATE_ROOT NOTES__LOGGING"],
    ["window.__BOARD_APPEARANCE__", "window.__NOTES_APPEARANCE__"],
    ["board:files-changed", "notes:files-changed"],
    ["copy.board-backup.zip", "copy.notes-backup.zip"],
    ["BoardTest-unit X-Board-ProductId", "NotesTest-unit X-Notes-ProductId"],
    ["Board diagnostics v1", "Notes diagnostics v1"],
    ["bOaRd__LoGgInG__LeVeL", "nOtEs__LoGgInG__LeVeL"],
    ["无关的文字", "无关的文字"],
  ]) {
    assert.equal(replace(before), after);
  }
});

test("rename keeps the letter case of the code name when lengths differ", () => {
  const replace = renamer(from, {
    product: "Big Notebook",
    binary: "big-notebook",
    identifier: "com.example.notebook",
  });
  assert.equal(replace("Board BOARD bOaRd"), "Notebook NOTEBOOK nOtEbook");
});

test("rename never replaces a name it has just written", () => {
  const replace = renamer(from, {
    product: "Board Notes",
    binary: "board-notes",
    identifier: "com.example.notes",
  });
  assert.equal(replace("Old Board, board"), "Board Notes, notes");
});

test("rename accepts a valid identity and rejects invalid arguments", () => {
  const valid = [
    "--name",
    "Example Notes",
    "--binary",
    "example-notes",
    "--identifier",
    "com.example.notes",
  ];
  assert.deepEqual(parseIdentity(valid), to);
  for (const [args, message] of [
    [valid.slice(0, 4), /缺少 --identifier/],
    [[...valid, "extra"], /用法/],
    [[...valid, "--force"], /用法/],
    [["--name", 'Bad "Name"', ...valid.slice(2)], /产品名/],
    [["--name", " Notes", ...valid.slice(2)], /产品名/],
    [
      [...valid.slice(0, 2), "--binary", "Example-Notes", ...valid.slice(4)],
      /程序名/,
    ],
    [[...valid.slice(0, 2), "--binary", "1notes", ...valid.slice(4)], /程序名/],
    [[...valid.slice(0, 4), "--identifier", "notes"], /identifier/],
    [
      [...valid.slice(0, 4), "--identifier", "com.example.my-notes"],
      /identifier/,
    ],
  ]) {
    assert.throws(() => parseIdentity(args), message);
  }
});

function git(directory, ...args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

async function fixture(t) {
  const temporary = resolve(process.env.TEMP, "rename-test");
  await mkdir(temporary, { recursive: true });
  const parent = await realpath(temporary);
  const directory = await realpath(await mkdtemp(join(parent, "repo-")));
  assert.equal(dirname(directory), parent);
  t.after(() => rm(directory, { recursive: true }));
  const files = {
    "src-tauri/tauri.conf.json": `${JSON.stringify({
      productName: from.product,
      mainBinaryName: from.binary,
      identifier: from.identifier,
    })}\n`,
    "src-tauri/src/bin/old-board-cli.rs":
      "// Old Board 数据库工具\nuse board_framework::db;\n",
    "README.md": "无关的文字\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content);
  }
  const binary = Buffer.concat([
    Buffer.from([0, 1, 2]),
    Buffer.from(from.binary),
  ]);
  await writeFile(join(directory, "icon.bin"), binary);
  git(directory, "init", "-q");
  git(directory, "config", "core.autocrlf", "false");
  git(directory, "add", "-A");
  git(
    directory,
    "-c",
    "user.name=rename-test",
    "-c",
    "user.email=rename-test@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  return { directory, binary };
}

test("rename rewrites tracked text files and moves renamed paths", async (t) => {
  const { directory, binary } = await fixture(t);
  const result = await renameRepository(directory, to);
  assert.deepEqual(result.from, from);
  assert.deepEqual(result.edited.sort(), [
    "src-tauri/src/bin/old-board-cli.rs",
    "src-tauri/tauri.conf.json",
  ]);
  assert.deepEqual(result.moved, [
    [
      "src-tauri/src/bin/old-board-cli.rs",
      "src-tauri/src/bin/example-notes-cli.rs",
    ],
  ]);
  assert.deepEqual(
    JSON.parse(
      await readFile(join(directory, "src-tauri/tauri.conf.json"), "utf8"),
    ),
    {
      productName: to.product,
      mainBinaryName: to.binary,
      identifier: to.identifier,
    },
  );
  assert.equal(
    await readFile(
      join(directory, "src-tauri/src/bin/example-notes-cli.rs"),
      "utf8",
    ),
    "// Example Notes 数据库工具\nuse notes_framework::db;\n",
  );
  await assert.rejects(
    access(join(directory, "src-tauri/src/bin/old-board-cli.rs")),
  );
  assert.deepEqual(await readFile(join(directory, "icon.bin")), binary);
  assert.equal(
    await readFile(join(directory, "README.md"), "utf8"),
    "无关的文字\n",
  );
});

test("rename refuses a working tree with uncommitted changes", async (t) => {
  const { directory } = await fixture(t);
  await writeFile(join(directory, "draft.txt"), "Old Board\n");
  await assert.rejects(renameRepository(directory, to), /未提交/);
  assert.match(
    await readFile(join(directory, "src-tauri/tauri.conf.json"), "utf8"),
    /Old Board/,
  );
});
