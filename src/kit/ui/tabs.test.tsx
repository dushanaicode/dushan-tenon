import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { expect, it, vi } from "vitest";
import {
  Tabs,
  TabsContent,
  TabsList,
  type TabsProps,
  TabsTrigger,
} from "./tabs";

function Example(props: TabsProps) {
  return (
    <Tabs {...props}>
      <TabsList aria-label={props.orientation ?? "horizontal"} variant="line">
        <TabsTrigger value="one">第一项</TabsTrigger>
        <TabsTrigger value="two">第二项</TabsTrigger>
      </TabsList>
      <TabsContent value="one">第一面板</TabsContent>
      <TabsContent value="two">第二面板</TabsContent>
    </Tabs>
  );
}

it("非受控鼠标激活更新面板，重复激活不重复通知", () => {
  const changed = vi.fn();
  render(
    <StrictMode>
      <Example defaultValue="one" onValueChange={changed} />
    </StrictMode>,
  );
  expect(screen.getByRole("tabpanel").textContent).toBe("第一面板");
  expect(changed).not.toHaveBeenCalled();
  const tab = screen.getByRole("tab", { name: "第二项" });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  expect(changed).toHaveBeenCalledExactlyOnceWith("two");
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("第二面板");
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  expect(changed).toHaveBeenCalledOnce();
});

it.each(["horizontal", "vertical"] as const)(
  "%s 方向键自动激活对应标签",
  async (orientation) => {
    render(<Example orientation={orientation} defaultValue="one" />);
    const list = screen.getByRole("tablist");
    expect(list.getAttribute("aria-orientation")).toBe(orientation);
    const [first, second] = within(list).getAllByRole("tab");
    act(() => first.focus());
    fireEvent.keyDown(first, {
      key: orientation === "vertical" ? "ArrowDown" : "ArrowRight",
    });
    await waitFor(() =>
      expect(second.getAttribute("aria-selected")).toBe("true"),
    );
    expect(document.activeElement).toBe(second);
    expect(screen.getByRole("tabpanel").textContent).toBe("第二面板");
  },
);

it("受控请求等待父层接受，外部值切换不触发回调", () => {
  const changed = vi.fn();
  const { rerender } = render(<Example value="one" onValueChange={changed} />);
  const second = screen.getByRole("tab", { name: "第二项" });
  fireEvent.mouseDown(second, { button: 0, ctrlKey: false });
  expect(changed).toHaveBeenCalledExactlyOnceWith("two");
  expect(second.getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("tabpanel").textContent).toBe("第一面板");
  rerender(<Example value="one" onValueChange={changed} />);
  expect(second.getAttribute("aria-selected")).toBe("false");
  rerender(<Example value="two" onValueChange={changed} />);
  expect(second.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tabpanel").textContent).toBe("第二面板");
  expect(changed).toHaveBeenCalledOnce();
});

it("同级及嵌套 Tabs 的当前值互不影响", () => {
  const view = (value: string) => (
    <>
      <Tabs value={value}>
        <TabsList aria-label="outer">
          <TabsTrigger value="one">一</TabsTrigger>
          <TabsTrigger value="two">二</TabsTrigger>
        </TabsList>
        <TabsList aria-label="outer-line" variant="line">
          <TabsTrigger value="one">一</TabsTrigger>
          <TabsTrigger value="two">二</TabsTrigger>
        </TabsList>
        <Example defaultValue="one" orientation="vertical" />
      </Tabs>
      <Example value="one" />
    </>
  );
  const { rerender } = render(view("one"));
  rerender(view("two"));
  for (const name of ["outer", "outer-line"]) {
    const tabs = within(screen.getByRole("tablist", { name })).getAllByRole(
      "tab",
    );
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "false",
      "true",
    ]);
  }
  for (const name of ["horizontal", "vertical"]) {
    const tabs = within(screen.getByRole("tablist", { name })).getAllByRole(
      "tab",
    );
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
  }
});

it("retains object refs and React 19 callback-ref cleanup", () => {
  const objectRef = createRef<HTMLDivElement>();
  const { rerender, unmount } = render(
    <Example defaultValue="one" ref={objectRef} />,
  );
  const root = screen.getByRole("tablist").parentElement;
  expect(objectRef.current).toBe(root);
  const cleanup = vi.fn();
  const callbackRef = vi.fn(() => cleanup);
  rerender(<Example defaultValue="one" ref={callbackRef} />);
  expect(objectRef.current).toBeNull();
  expect(callbackRef).toHaveBeenCalledExactlyOnceWith(root);
  rerender(<Example defaultValue="one" ref={callbackRef} />);
  expect(callbackRef).toHaveBeenCalledOnce();
  unmount();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(callbackRef).toHaveBeenCalledOnce();
});
