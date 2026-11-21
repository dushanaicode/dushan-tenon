import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { root, run, runBin, task } from "./common.mjs";

const usage = `用法: pnpm rename --name <产品名> --binary <程序名> --identifier <identifier>
示例: pnpm rename --name "Example Notes" --binary example-notes --identifier com.example.notes`;

const rules = {
  name: [
    /^[\p{L}\p{N}](?:[\p{L}\p{N} .-]*[\p{L}\p{N}])?$/u,
    "产品名只能包含字母、数字、空格、点和连字符，首尾必须是字母或数字",
  ],
  binary: [
    /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/,
    "程序名必须以小写字母开头，由小写字母、数字和单个连字符组成",
  ],
  identifier: [
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*\.[a-z][a-z0-9]*$/,
    "identifier 必须是至少两段的小写反向域名，最后一段（代号）只能包含小写字母和数字",
  ],
};

export function parseIdentity(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        name: { type: "string" },
        binary: { type: "string" },
        identifier: { type: "string" },
      },
    }));
  } catch (error) {
    throw new Error(`${error.message}\n${usage}`);
  }
  for (const [key, [pattern, message]] of Object.entries(rules)) {
    if (values[key] === undefined) throw new Error(`缺少 --${key}\n${usage}`);
    if (!pattern.test(values[key])) {
      throw new Error(`${message}：${values[key]}\n${usage}`);
    }
  }
  return {
    product: values.name,
    binary: values.binary,
    identifier: values.identifier,
  };
}

const codeOf = ({ identifier }) => identifier.split(".").at(-1);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 新代号沿用旧代号在原文里的大小写：全小写、全大写，其余按字母位置对应（Tenon → Notes，tEnOn → nOtEs）。
function sameCase(sample, word) {
  if (sample === sample.toLowerCase()) return word;
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  return [...word]
    .map((letter, index) =>
      index < sample.length && sample[index] !== sample[index].toLowerCase()
        ? letter.toUpperCase()
        : letter,
    )
    .join("");
}

// 身份为 { product, binary, identifier }。一次扫描完成替换，换上的新名字不会再被替换。
// 身份原文优先匹配，其次是不分大小写的代号。
export function renamer(from, to) {
  const newCode = codeOf(to);
  const pairs = new Map([
    [from.product, to.product],
    [from.identifier, to.identifier],
    [from.binary, to.binary],
    [from.binary.replaceAll("-", "_"), to.binary.replaceAll("-", "_")],
  ]);
  const pattern = new RegExp(
    [
      ...[...pairs.keys()]
        .sort((a, b) => b.length - a.length)
        .map(escapeRegExp),
      `(?i:${escapeRegExp(codeOf(from))})`,
    ].join("|"),
    "g",
  );
  return (text) =>
    text.replace(
      pattern,
      (match) => pairs.get(match) ?? sameCase(match, newCode),
    );
}

function git(directory, args) {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
  });
}

// 只处理 Git 跟踪的文件；含 NUL 字节的文件按二进制处理，只改路径不改内容。
export async function renameRepository(directory, to) {
  if (git(directory, ["status", "--porcelain"]) !== "") {
    throw new Error(
      "工作区有未提交的改动。请先提交，再改名；改错了可以用 git 退回。",
    );
  }
  const config = JSON.parse(
    await readFile(join(directory, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const from = {
    product: config.productName,
    binary: config.mainBinaryName,
    identifier: config.identifier,
  };
  const replace = renamer(from, to);
  const edited = [];
  const moved = [];
  const paths = git(directory, ["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const path of paths) {
    const content = await readFile(join(directory, path));
    if (!content.subarray(0, 8192).includes(0)) {
      const text = content.toString("utf8");
      const next = replace(text);
      if (next !== text) {
        await writeFile(join(directory, path), next);
        edited.push(path);
      }
    }
    const target = replace(path);
    if (target !== path) {
      await mkdir(dirname(join(directory, target)), { recursive: true });
      await rename(join(directory, path), join(directory, target));
      moved.push([path, target]);
    }
  }
  return { from, edited, moved };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await task("rename", async (env) => {
    const to = parseIdentity(process.argv.slice(2));
    const { from, edited, moved } = await renameRepository(root, to);
    console.log(
      `${from.product} → ${to.product}；程序名 ${from.binary} → ${to.binary}；identifier ${from.identifier} → ${to.identifier}；代号 ${codeOf(from)} → ${codeOf(to)}`,
    );
    console.log(
      `改了 ${edited.length} 个文件的内容，改名 ${moved.length} 个文件`,
    );
    for (const [path, target] of moved) console.log(`  ${path} → ${target}`);
    // 包名换了以后 Cargo.lock 的顺序和代码换行都会变，不重排 pnpm check 过不了。
    await run("更新 Cargo.lock", "cargo", ["update", "--workspace"], env);
    await run("Rust 格式", "cargo", ["fmt", "--all"], env);
    await runBin(
      "Biome",
      "@biomejs/biome",
      "biome",
      ["check", "--write", "."],
      env,
    );
    console.log(
      "\n改名完成。中文名、版权、仓库地址、标志和图标不由脚本修改，请按 docs/derive.md 手工处理，然后运行 pnpm check。",
    );
  });
}
