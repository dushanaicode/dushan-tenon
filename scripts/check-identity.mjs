import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = "src-tauri/tauri.conf.json";
const cargoPath = "src-tauri/Cargo.toml";
const sources = [configPath, cargoPath, "package.json", "index.html"];

// files uses repository-relative POSIX paths; scanning never imports or
// executes inspected files.
export function scanIdentity(files) {
  const violations = [];
  function report(rule, path, index, message) {
    violations.push({
      rule,
      path,
      line:
        index === null ? 1 : files.get(path).slice(0, index).split("\n").length,
      message,
    });
  }
  function capture(
    rule,
    path,
    pattern,
    label,
    text = files.get(path),
    offset = 0,
  ) {
    const match = text?.match(pattern);
    if (!match) {
      report(rule, path, null, `无法解析 ${label}`);
      return null;
    }
    return { value: match[1], index: offset + match.index, label };
  }
  function json(path, rule) {
    if (!files.has(path)) {
      report(rule, path, null, "无法解析 JSON：缺少受检文件");
      return null;
    }
    try {
      return JSON.parse(files.get(path));
    } catch (error) {
      report(rule, path, null, `无法解析 JSON：${error.message}`);
      return null;
    }
  }
  function jsonString(path, rule, object, key) {
    const index = files.get(path)?.search(new RegExp(`"${key}"\\s*:`));
    if (typeof object?.[key] !== "string") {
      report(
        rule,
        path,
        index >= 0 ? index : null,
        `无法解析 ${key}（须为字符串）`,
      );
      return null;
    }
    return { value: object[key], index, label: key };
  }
  function toml(header, key) {
    const escaped = header.replaceAll("[", "\\[").replaceAll("]", "\\]");
    const section = files
      .get(cargoPath)
      ?.match(
        new RegExp(
          `^[ \\t]*${escaped}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^[ \\t]*\\[|(?![\\s\\S]))`,
          "m",
        ),
      );
    if (!section) {
      report("I2", cargoPath, null, `无法解析 ${header} ${key}`);
      return null;
    }
    return capture(
      "I2",
      cargoPath,
      new RegExp(
        `^[ \\t]*${key}[ \\t]*=[ \\t]*"([^"\\r\\n]*)"[ \\t]*(?:#.*)?\\r?$`,
        "m",
      ),
      `${header} ${key}`,
      section[1],
      section.index + section[0].length - section[1].length,
    );
  }
  function equal(rule, path, entry, expected, source) {
    if (entry !== null && expected !== undefined && entry.value !== expected) {
      report(
        rule,
        path,
        entry.index,
        `${entry.label} = ${JSON.stringify(entry.value)}，须与 ${source} 一致（${JSON.stringify(expected)}）`,
      );
    }
  }

  const config = json(configPath, "I1");
  const slug = jsonString(configPath, "I1", config, "mainBinaryName");
  const product = jsonString(configPath, "I1", config, "productName");
  const identifier = jsonString(configPath, "I1", config, "identifier");
  for (const [entry, pattern, message] of [
    [
      slug,
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "mainBinaryName 必须为小写字母数字组成的连字符 slug",
    ],
    [
      identifier,
      /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/,
      "identifier 必须为至少两段、每段以小写字母开头的反向域名",
    ],
    [product, /\S/, "productName 必须非空"],
  ]) {
    if (entry !== null && !pattern.test(entry.value))
      report("I1", configPath, entry.index, message);
  }

  const slugSource = `${configPath} mainBinaryName`;
  for (const [header, key, expected, source] of [
    ["[package]", "name", slug?.value, slugSource],
    ["[package]", "default-run", slug?.value, slugSource],
    [
      "[lib]",
      "name",
      slug && `${slug.value.replaceAll("-", "_")}_lib`,
      `${slugSource} 派生的库名`,
    ],
  ]) {
    equal("I2", cargoPath, toml(header, key), expected ?? undefined, source);
  }
  const npm = json("package.json", "I2");
  equal(
    "I2",
    "package.json",
    jsonString("package.json", "I2", npm, "name"),
    slug?.value,
    slugSource,
  );

  equal(
    "I5",
    "index.html",
    capture("I5", "index.html", /<title>([^<]*)<\/title>/, "<title>"),
    product?.value,
    `${configPath} productName`,
  );

  return violations.sort((a, b) => {
    for (const key of ["rule", "path", "line", "message"]) {
      if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
    }
    return 0;
  });
}

export async function readIdentityFiles(root = repositoryRoot) {
  const files = new Map();
  await Promise.all(
    sources.map(async (path) => {
      try {
        files.set(path, await readFile(join(root, path), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }),
  );
  return files;
}

export async function checkIdentity() {
  console.log("\n[身份一致性]");
  const violations = scanIdentity(await readIdentityFiles());
  for (const { rule, path, line, message } of violations) {
    console.error(`${rule} ${path}:${line} ${message}`);
  }
  if (violations.length > 0) {
    throw new Error(`身份检查失败：${violations.length} 项违规`);
  }
  console.log("I1、I2、I5 身份检查通过");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await checkIdentity();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
