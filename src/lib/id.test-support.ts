// 构造 `isId` 必须拒绝的路由 Id；只在测试里用
import { newId } from "./id";

export function malformedIds(
  base: string = newId(),
): readonly (readonly [label: string, id: string])[] {
  return [
    ["v4", base.replace(/^([0-9a-f]{8}-[0-9a-f]{4})-7/, "$1-4")],
    [
      "invalid variant",
      base.replace(/^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3})-[89ab]/, "$1-0"),
    ],
    ["uppercase v7", base.toUpperCase().replace(/.$/, "A")],
    ["no hyphens", base.replaceAll("-", "")],
    ["plain string", "bad-id"],
    ["empty", ""],
  ];
}
