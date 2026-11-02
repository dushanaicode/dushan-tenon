import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VirtualList } from "./virtual-list";
import { VirtualLog } from "./virtual-log";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.slot === "virtual-list"
        ? 320
        : this.hasAttribute("data-virtual-index")
          ? 36
          : 0;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    () => 640,
  );
});
afterEach(() => vi.restoreAllMocks());

it.each(["auxiliary", "content"] as const)(
  "%s: 100000 rows mount a bounded range and preserve a focused offscreen row",
  async (region) => {
    const items = Array.from({ length: 100000 }, (_, index) => index);
    const view = render(
      <VirtualList
        region={region}
        label="Records"
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">Record {item}</button>}
      />,
    );
    const list = screen.getByRole("region", { name: "Records" });
    expect(list.dataset.kit).toBe("scroll-area");
    expect(list.dataset.region).toBe(region);
    expect(
      view.container.querySelectorAll('[data-kit="scroll-area"]'),
    ).toHaveLength(1);
    expect(list.tabIndex).toBe(0);
    expect(within(list).getByRole("list").tagName).toBe("UL");
    const first = await screen.findByRole("button", { name: "Record 0" });
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(30);
    act(() => first.focus());
    list.scrollTop = 360000;
    fireEvent.scroll(list);
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole("listitem")
          .some((row) => Number(row.getAttribute("aria-posinset")) > 9900),
      ).toBe(true),
    );
    expect(document.activeElement).toBe(first);
    expect(first.isConnected).toBe(true);
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(32);
    for (const row of within(list).getAllByRole("listitem"))
      expect(row.getAttribute("aria-setsize")).toBe("100000");
    view.rerender(
      <VirtualList
        region={region}
        label="Records"
        items={[...items].reverse()}
        getKey={(item) => item}
        renderItem={(item) => <button type="button">Record {item}</button>}
      />,
    );
    expect(document.activeElement).toBe(first);
    expect(first.closest("li")?.getAttribute("aria-posinset")).toBe("100000");
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(32);
  },
);

it("measures variable row heights and updates offsets after a resize", async () => {
  const observers: {
    callback: ResizeObserverCallback;
    targets: Set<Element>;
    observer: ResizeObserver;
  }[] = [];
  vi.spyOn(window, "ResizeObserver").mockImplementation(
    class implements ResizeObserver {
      targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        observers.push({ callback, targets: this.targets, observer: this });
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.dataset.slot === "virtual-list") return 320;
      return this.dataset.virtualIndex === "0" ? 72 : 36;
    },
  );
  render(
    <VirtualList
      label="Dynamic rows"
      items={["first", "second", "third"]}
      getKey={(item) => item}
      renderItem={(item) => <span>{item}</span>}
    />,
  );
  const [first, second] = await screen.findAllByRole("listitem");
  await waitFor(() => expect(second.style.transform).toBe("translateY(72px)"));
  const size = [{ blockSize: 108, inlineSize: 640 }];
  const entry: ResizeObserverEntry = {
    target: first,
    borderBoxSize: size,
    contentBoxSize: size,
    devicePixelContentBoxSize: size,
    contentRect: new DOMRect(0, 0, 640, 108),
  };
  act(() => {
    for (const { callback, targets, observer } of observers) {
      if (targets.has(first)) callback([entry], observer);
    }
  });
  await waitFor(() => expect(second.style.transform).toBe("translateY(108px)"));
  expect(screen.getByRole("list", { name: "Dynamic rows" }).style.height).toBe(
    "180px",
  );
});

it.each([undefined, "content"] as const)(
  "logs (%s) render plain text, retain empty lines and never interpret HTML",
  async (region) => {
    render(
      <VirtualLog
        region={region}
        label="Log"
        lines={["<script>not markup</script>", "", "last"]}
      />,
    );
    const list = screen.getByRole("list", { name: "Log" });
    expect(screen.getByRole("region", { name: "Log" }).dataset.region).toBe(
      region ?? "auxiliary",
    );
    expect(
      await within(list).findByText("<script>not markup</script>"),
    ).toBeTruthy();
    expect(list.querySelector("script")).toBeNull();
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getByText("last")).toBeTruthy();
  },
);
