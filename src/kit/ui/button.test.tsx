import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { MemoryRouter, NavLink } from "react-router";
import { expect, it, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { Button, ButtonFace } from "./button";
import { Icon } from "./icon";
import { Spinner } from "./spinner";

it("ref、提交与禁用忙碌状态保持原生按钮行为", () => {
  const ref = createRef<HTMLButtonElement>();
  const submit = vi.fn((event) => event.preventDefault());
  const click = vi.fn();
  const i18n = createKitTestI18n();
  const view = (disabled: boolean) =>
    withKitI18n(
      <form onSubmit={submit}>
        <Button
          ref={ref}
          type="submit"
          disabled={disabled}
          aria-busy={disabled}
          onClick={click}
        >
          {disabled && <Spinner aria-hidden="true" />}
          保存
        </Button>
      </form>,
      i18n,
    );
  const { rerender } = render(view(false));
  const button = screen.getByRole("button", { name: "保存" });
  expect(ref.current).toBe(button);
  expect(button.dataset).toMatchObject({
    kit: "button",
    variant: "default",
    size: "default",
  });
  act(() => button.focus());
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  rerender(view(true));
  expect(button).toHaveProperty("disabled", true);
  expect(button.getAttribute("type")).toBe("submit");
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(
    button.querySelector('[data-part="face"] > [data-slot="spinner"]'),
  ).not.toBeNull();
  fireEvent.click(button);
  expect(submit).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
});

it("asChild 路由链接保留独立 face、overlay、ref 与活动状态", () => {
  const ref = createRef<HTMLAnchorElement>();
  const click = vi.fn((event) => event.preventDefault());
  const key = vi.fn();
  render(
    <MemoryRouter initialEntries={["/target"]}>
      <Button asChild variant="ghost" overlay={<span>2</span>}>
        <NavLink ref={ref} to="/target" onClick={click} onKeyDown={key}>
          <ButtonFace>
            <Icon iconId="home" />
            目标
          </ButtonFace>
        </NavLink>
      </Button>
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "目标 2" });
  expect(ref.current).toBe(link);
  expect(link.getAttribute("href")).toBe("/target");
  expect(link.getAttribute("aria-current")).toBe("page");
  expect(link.dataset).toMatchObject({
    kit: "button",
    variant: "ghost",
    size: "default",
  });
  expect(
    Array.from(link.children, (child) => [
      child.tagName,
      child.getAttribute("data-part"),
    ]),
  ).toEqual([
    ["SPAN", "face"],
    ["SPAN", "overlay"],
  ]);
  expect(link.querySelector("button")).toBeNull();
  expect(
    link.querySelector('[data-part="face"] [data-part="overlay"]'),
  ).toBeNull();
  fireEvent.click(link.firstElementChild as Element);
  fireEvent.keyDown(link, { key: "Enter" });
  expect(click).toHaveBeenCalledOnce();
  expect(key).toHaveBeenCalledOnce();
});
