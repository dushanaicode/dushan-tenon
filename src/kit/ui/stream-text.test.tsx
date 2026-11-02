import { cjk } from "@streamdown/cjk";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { defaultRehypePlugins, type StreamdownProps } from "streamdown";
import { afterEach, expect, test, vi } from "vitest";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";
import { StreamText } from "./stream-text";

const rendered = vi.hoisted(() => vi.fn());
vi.mock("streamdown", async (original) => {
  const module = await original<typeof import("streamdown")>();
  return {
    ...module,
    Streamdown: (props: StreamdownProps) => {
      rendered(props);
      return <module.Streamdown {...props} />;
    },
  };
});
vi.mock("sonner", async (original) => ({
  ...(await original<typeof import("sonner")>()),
  toast: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

test("StreamText preserves interrupted markdown and CJK", () => {
  const text =
    "中文**粗体**，标点。\n\n| 名称 | Value |\n| --- | --- |\n| 流式 | 1 |\n\n```ts\nconst value =";
  const { container, rerender } = renderKit(
    <StreamText text={text} isAnimating />,
  );
  expect(container.querySelector("strong")?.textContent).toBe("粗体");
  expect(screen.getByRole("table").textContent).toContain("流式");
  expect(container.querySelector("pre code")?.textContent).toContain(
    "const value =",
  );
  for (const element of [
    screen.getByRole("table"),
    container.querySelector("pre"),
  ]) {
    expect(element?.parentElement?.getAttribute("data-region")).toBe(
      "auxiliary",
    );
    expect(element?.parentElement?.getAttribute("data-axis")).toBe("both");
  }
  const markup = () =>
    [...container.querySelectorAll("p,pre,table")].map(
      (element) => element.innerHTML,
    );
  const before = markup();
  rerender(<StreamText text={text} isAnimating={false} />);
  expect(markup()).toEqual(before);
  expect(rendered.mock.lastCall?.[0]).toMatchObject({
    mode: "streaming",
    children: text,
    isAnimating: false,
  });
});

test("StreamText blocks unsafe content and remote requests", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const clipboard = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: clipboard } });
  vi.mocked(toast).mockClear();
  const { container } = renderKit(
    <StreamText
      isAnimating={false}
      text={[
        '<script>alert("private")</script>',
        '<img src="https://tracking.invalid/pixel" srcset="https://tracking.invalid/pixel2 2x">',
        '<iframe src="https://tracking.invalid/frame"></iframe>',
        '<audio src="https://tracking.invalid/audio"></audio>',
        "[good](https://example.com/path?q=1) [http](http://example.com/path)",
        "[relative](/local) [protocol-relative](//example.com/path) [credentials](https://user:pass@example.com)",
        "[script](javascript:alert%281%29) [data](data:text/html,test) [file](file:///C:/secret) [blob](blob:https://example.com/1) [asset](asset://secret)",
        "![remote](https://tracking.invalid/image) ![inline](data:image/png;base64,AAAA) ![local](file:///image)",
      ].join("\n\n")}
    />,
  );
  expect(
    container.querySelector(
      "script,img,iframe,audio,video,object,embed,style,link,svg,a[href],[src],[srcset]",
    ),
  ).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  const copy = screen.getAllByRole("button", { name: /^复制链接:/ });
  expect(copy).toHaveLength(2);
  fireEvent.click(copy[0]);
  expect(clipboard).toHaveBeenCalledExactlyOnceWith(
    "https://example.com/path?q=1",
  );
  await waitFor(() => expect(toast).toHaveBeenCalledWith("已复制"));
  expect(container.textContent).toContain("图片已阻止");
  clipboard.mockRejectedValueOnce(new Error("private clipboard failure"));
  fireEvent.click(copy[1]);
  await waitFor(() => expect(toast).toHaveBeenCalledWith("复制失败"));
  expect(container.textContent).not.toContain("private clipboard failure");
});

test("StreamText keeps streaming and security plugins independent of running state", () => {
  const { container, rerender } = renderKit(
    <StreamText text="还在生成" isAnimating />,
  );
  for (const isAnimating of [true, false]) {
    rerender(<StreamText text="还在生成" isAnimating={isAnimating} />);
    expect(rendered.mock.lastCall?.[0]).toMatchObject({
      isAnimating,
      animated: false,
      mode: "streaming",
      skipHtml: true,
      controls: false,
      plugins: { cjk },
      rehypePlugins: [
        defaultRehypePlugins.sanitize,
        defaultRehypePlugins.harden,
      ],
      remarkRehypeOptions: { allowDangerousHtml: false },
    });
    expect(container.querySelector("[data-sd-animate],style")).toBeNull();
  }
});

function renderKit(ui: ReactNode) {
  const i18n = createKitTestI18n();
  return {
    ...render(ui, { wrapper: ({ children }) => withKitI18n(children, i18n) }),
    i18n,
  };
}
