import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ICONS, type IconId } from "../icons";
import registrySource from "../icons.ts?raw";
import { Icon } from "./icon";

test("显式图标映射使用固定尺寸、线宽与可访问语义", () => {
  expect(registrySource).not.toMatch(/\bimport\s*(?:\(|\*)/);
  expect(registrySource).not.toContain("lucide-react/");
  expect(registrySource).not.toContain("phosphor");

  render(
    <>
      {Object.keys(ICONS).map((id) => (
        <Icon key={id} iconId={id as IconId} aria-label={id} />
      ))}
      <Icon iconId="close" data-testid="decoration" />
    </>,
  );
  expect(screen.getAllByRole("img")).toHaveLength(Object.keys(ICONS).length);
  for (const icon of screen.getAllByRole("img")) {
    expect(icon.getAttribute("fill")).toBe("none");
    expect(icon.getAttribute("width")).toBe("18");
    expect(icon.getAttribute("stroke-width")).toBe("2");
    expect(icon.getAttribute("focusable")).toBe("false");
    expect(icon.classList.contains("kit-icon")).toBe(true);
  }
  const decoration = screen.getByTestId("decoration");
  expect(decoration.getAttribute("aria-hidden")).toBe("true");
  expect(decoration.hasAttribute("role")).toBe(false);
});
