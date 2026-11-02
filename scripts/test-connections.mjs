import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { root } from "./common.mjs";

export async function readConnections(env) {
  let resources = {};
  try {
    resources = JSON.parse(
      await readFile(join(root, "Temp/test-resources/connection.json"), "utf8"),
    );
    if (
      resources === null ||
      typeof resources !== "object" ||
      Array.isArray(resources) ||
      Object.values(resources).some((value) => typeof value !== "string")
    ) {
      throw new Error();
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      // JSON 解析诊断可能含口令，不带回原始内容或错误链。
      throw new Error("无法读取测试资源配置；connection.json 必须是字符串映射");
    }
  }
  return { ...resources, ...env };
}

export function requireConnection(connections, name) {
  const value = connections[name];
  if (!value) {
    throw new Error(
      `缺少 ${name}；请先运行 pnpm resources start，或显式设置测试连接环境变量。`,
    );
  }
  return value;
}
