import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { App } from "@/app/app";

test("显示 Dushan Tenon 标题", () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { name: "Dushan Tenon（渡山榫卯）" }),
  ).toBeTruthy();
});
