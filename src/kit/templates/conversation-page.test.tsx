import { readFileSync } from "node:fs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { afterEach, expect, test, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import {
  ConversationPage,
  type ConversationPageProps,
  type ConversationStatus,
} from "./conversation-page";

vi.mock("sonner", async (original) => ({
  ...(await original<typeof import("sonner")>()),
  toast: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

const raw = "中文**未完\n\n```ts\nconst value =";
const props: ConversationPageProps = {
  messages: [
    {
      id: "a",
      role: "assistant",
      parts: [
        { id: "r", type: "reasoning", text: "合成推理" },
        { id: "t", type: "text", text: raw },
      ],
    },
  ],
  status: "idle",
  activeMessageId: "a",
  inputValue: "草稿",
  onInputChange: () => {},
  onSubmit: () => {},
  onStop: () => {},
};

test("composer is controlled and protects IME", () => {
  const submit = vi.fn();
  const stop = vi.fn();
  function Harness({ status }: { status: ConversationStatus }) {
    const [value, setValue] = useState("草稿");
    return (
      <ConversationPage
        {...props}
        status={status}
        inputValue={value}
        onInputChange={setValue}
        onSubmit={submit}
        onStop={stop}
      />
    );
  }
  const { rerender } = renderKit(<Harness status="idle" />);
  const input = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "消息",
  });
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  fireEvent.change(input, { target: { value: "中文输入" } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.compositionEnd(input);
  for (const event of [
    { isComposing: true },
    { keyCode: 229 },
    { repeat: true },
    { shiftKey: true },
  ]) {
    fireEvent.keyDown(input, { key: "Enter", ...event });
  }
  const prevented = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
  });
  prevented.preventDefault();
  fireEvent(input, prevented);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(input.value).toBe("中文输入");
  for (const status of ["submitting", "streaming", "cancelling"] as const) {
    rerender(<Harness status={status} />);
    expect(input.readOnly).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "发送" }).disabled,
    ).toBe(true);
    const stopButton = screen.getByRole<HTMLButtonElement>("button", {
      name: "停止生成",
    });
    expect(stopButton.disabled).toBe(false);
    stopButton.focus();
    fireEvent.click(stopButton);
    fireEvent.keyDown(input, { key: "Enter" });
  }
  expect(stop).toHaveBeenCalledTimes(3);
  expect(submit).toHaveBeenCalledTimes(1);
  rerender(<Harness status="failed" />);
  expect(input.value).toBe("中文输入");
  expect(input).toBe(document.activeElement);
  fireEvent.change(input, { target: { value: "  \n " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).toHaveBeenCalledTimes(1);
});

test("announces states without reading every delta", async () => {
  const { container, rerender } = renderKit(
    <ConversationPage {...props} status="submitting" />,
  );
  const status = screen.getByRole("status");
  expect(status.getAttribute("aria-live")).toBe("polite");
  expect(
    container
      .querySelector("[data-slot=conversation-scroll]")
      ?.getAttribute("aria-live"),
  ).toBe("off");
  const mutations = vi.fn();
  const observer = new MutationObserver(mutations);
  observer.observe(status, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  const input = screen.getByRole("textbox");
  input.focus();
  for (let index = 0; index < 3; index += 1) {
    rerender(
      <ConversationPage
        {...props}
        status="streaming"
        messages={[
          {
            id: "a",
            role: "assistant",
            parts: [{ id: "r", type: "reasoning", text: `思考 ${index}` }],
          },
        ]}
      />,
    );
  }
  await act(async () => {});
  expect(mutations).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(input);
  const reasoning = screen.getByRole("button", { name: "推理内容" });
  expect(reasoning.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(reasoning);
  expect(reasoning.getAttribute("aria-expanded")).toBe("true");
  expect(
    document.getElementById(reasoning.getAttribute("aria-controls") ?? "")
      ?.hidden,
  ).toBe(false);
  rerender(<ConversationPage {...props} status="unknown" />);
  expect(status.textContent).toBe("状态未知");
  observer.disconnect();
});

test("scroll follow yields to reading", async () => {
  let resolveCopy: (() => void) | undefined;
  const clipboard = new Promise<void>((resolve) => {
    resolveCopy = resolve;
  });
  const writeText = vi.fn().mockReturnValue(clipboard);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  vi.mocked(toast).mockClear();
  const { container } = renderKit(
    <ConversationPage {...props} status="cancelled" />,
  );
  const scroll = container.querySelector<HTMLElement>(
    "[data-slot=conversation-scroll]",
  );
  if (!scroll) throw new Error("Missing conversation scroll area");
  expect(scroll.dataset.kit).toBe("scroll-area");
  expect(scroll.dataset.region).toBe("content");
  expect(scroll.dataset.axis).toBe("y");
  expect(scroll.firstElementChild?.getAttribute("data-slot")).toBe(
    "scroll-plate",
  );
  scroll.style.overflow = "auto";
  Object.defineProperties(scroll, {
    scrollHeight: { value: 1500, configurable: true },
    clientHeight: { value: 400, configurable: true },
  });
  scroll.scrollTop = 1100;
  fireEvent.wheel(scroll, { deltaY: -100 });
  const bottom = screen.getByRole<HTMLButtonElement>("button", {
    name: "回到底部",
  });
  expect(bottom.disabled).toBe(false);
  scroll.scrollTop = 800;
  fireEvent.scroll(scroll);
  expect(scroll.scrollTop).toBe(800);
  fireEvent.click(bottom);
  await waitFor(() => expect(scroll.scrollTop).toBeGreaterThanOrEqual(1099));
  fireEvent.click(screen.getByRole("button", { name: "复制原文" }));
  expect(writeText).toHaveBeenCalledWith(`合成推理${raw}`);
  expect(toast).not.toHaveBeenCalled();
  if (!resolveCopy) throw new Error("Promise executor must run synchronously");
  await act(resolveCopy);
  expect(toast).toHaveBeenCalledWith("已复制");
  writeText.mockRejectedValueOnce(new Error("private failure"));
  fireEvent.click(screen.getByRole("button", { name: "复制原文" }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith("复制失败"));
});

test("is independent of AI module imports", () => {
  for (const file of [
    "src/kit/ui/stream-text.tsx",
    "src/kit/templates/conversation-page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    expect(source).not.toMatch(
      /(?:modules\/ai|generated\/Ai|@tauri-apps|aiChat)/,
    );
  }
  const source = readFileSync(
    "src/kit/templates/conversation-page.tsx",
    "utf8",
  );
  expect(source).toContain('initial: "instant"');
  expect(source).toContain('resize: "instant"');
  expect(source).not.toMatch(/100vh|h-dvh|scrollIntoView|behavior: "smooth"/);
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
