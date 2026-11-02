import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

it("渲染卡片全部部件与语义令牌", () => {
  const { container } = render(
    <Card>
      <CardHeader>
        <CardTitle>任务详情</CardTitle>
        <CardDescription>检查任务状态</CardDescription>
        <CardAction>操作</CardAction>
      </CardHeader>
      <CardContent>正文</CardContent>
      <CardFooter>页脚</CardFooter>
    </Card>,
  );
  expect(
    Array.from(container.querySelectorAll("[data-slot]")).map((element) =>
      element.getAttribute("data-slot"),
    ),
  ).toEqual([
    "card",
    "card-header",
    "card-title",
    "card-description",
    "card-action",
    "card-content",
    "card-footer",
  ]);
  expect(container.firstElementChild?.classList.contains("shadow-card")).toBe(
    true,
  );
  expect(container.firstElementChild?.getAttribute("data-kit")).toBe("card");
  expect(container.firstElementChild?.classList.contains("py-panel")).toBe(
    true,
  );
  expect(screen.getByText("任务详情").classList.contains("text-body")).toBe(
    true,
  );
  expect(screen.getByText("正文").classList.contains("px-panel")).toBe(true);
});

it.each([
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
  CardContent,
  CardFooter,
])("%s 合并调用方 className", (Component) => {
  const { container } = render(
    <Component className="mt-2 px-2">内容</Component>,
  );
  const element = container.firstElementChild;
  expect(element?.classList.contains("mt-2")).toBe(true);
  expect(element?.classList.contains("px-2")).toBe(true);
  expect(element?.classList.contains("px-panel")).toBe(false);
});
