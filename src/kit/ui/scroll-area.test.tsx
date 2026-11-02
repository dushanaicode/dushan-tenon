import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, Profiler } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScrollArea } from "./scroll-area";

const NativeMutationObserver = globalThis.MutationObserver;

let resizeUpdate: () => void;
let mutationUpdate: () => void;
const resizeObserve = vi.fn();
const resizeDisconnect = vi.fn();
const mutationObserve = vi.fn();
const mutationDisconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(update: () => void) {
        resizeUpdate = update;
      }
      observe = resizeObserve;
      disconnect = resizeDisconnect;
    },
  );
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(update: () => void) {
        mutationUpdate = update;
      }
      observe = mutationObserve;
      disconnect = mutationDisconnect;
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function dimensions(element: HTMLDivElement | null) {
  if (!element) return;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: 100 },
    clientWidth: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 500 },
    scrollWidth: { configurable: true, value: 300 },
  });
}

for (const region of ["content", "auxiliary"] as const) {
  it.each(["y", "x", "both"] as const)(
    `${region}/%s preserves DOM attributes and places children in the right element`,
    (axis) => {
      const onScroll = vi.fn();
      render(
        <ScrollArea
          region={region}
          axis={axis}
          id="scroll"
          aria-label="scroll region"
          tabIndex={0}
          data-example="forwarded"
          className="outer"
          plateClassName="inner"
          onScroll={onScroll}
        >
          <span>child</span>
        </ScrollArea>,
      );
      const element = screen.getByLabelText("scroll region");
      const child = screen.getByText("child");
      expect(element.dataset.kit).toBe("scroll-area");
      expect(element.dataset.region).toBe(region);
      expect(element.dataset.axis).toBe(axis);
      expect(element.id).toBe("scroll");
      expect(element.tabIndex).toBe(0);
      expect(element.dataset.example).toBe("forwarded");
      expect(element.className).toBe("outer");
      expect(element.hasAttribute("plateClassName")).toBe(false);
      if (region === "content") {
        expect(child.parentElement).toBe(element.firstElementChild);
        expect(child.parentElement?.dataset.slot).toBe("scroll-plate");
        expect(child.parentElement?.className).toBe("@container/content inner");
      } else {
        expect(child.parentElement).toBe(element);
        expect(element.querySelector('[data-slot="scroll-plate"]')).toBeNull();
      }
      fireEvent.scroll(element);
      expect(onScroll).toHaveBeenCalledOnce();
    },
  );
}

it("defaults to auxiliary/y and exposes the actual scroll element through an object ref", () => {
  const ref = createRef<HTMLDivElement>();
  const { unmount } = render(<ScrollArea ref={ref} aria-label="scroll" />);
  const element = screen.getByLabelText("scroll");
  expect(ref.current).toBe(element);
  expect(element.dataset.region).toBe("auxiliary");
  expect(element.dataset.axis).toBe("y");
  unmount();
  expect(ref.current).toBeNull();
});

it("supports React 19 callback ref cleanup on the content scroll element", () => {
  const release = vi.fn();
  const ref = vi.fn(() => release);
  const { unmount } = render(
    <ScrollArea region="content" ref={ref} aria-label="scroll" />,
  );
  expect(ref).toHaveBeenCalledExactlyOnceWith(screen.getByLabelText("scroll"));
  unmount();
  expect(release).toHaveBeenCalledOnce();
  expect(ref).toHaveBeenCalledOnce();
});

it("sets scrolling directly with a passive listener and clears it 800ms after the last event without rendering", () => {
  vi.useFakeTimers();
  const listen = vi.spyOn(HTMLDivElement.prototype, "addEventListener");
  const onRender = vi.fn();
  render(
    <Profiler id="scroll" onRender={onRender}>
      <ScrollArea region="content" aria-label="scroll" />
    </Profiler>,
  );
  const element = screen.getByLabelText("scroll");
  expect(listen).toHaveBeenCalledWith("scroll", expect.any(Function), {
    passive: true,
  });
  expect(element.hasAttribute("data-scrolling")).toBe(false);
  fireEvent.scroll(element);
  expect(element.hasAttribute("data-scrolling")).toBe(true);
  act(() => vi.advanceTimersByTime(799));
  expect(element.hasAttribute("data-scrolling")).toBe(true);
  fireEvent.scroll(element);
  act(() => vi.advanceTimersByTime(799));
  expect(element.hasAttribute("data-scrolling")).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(element.hasAttribute("data-scrolling")).toBe(false);
  expect(onRender).toHaveBeenCalledOnce();
});

it.each([
  ["y", "y"],
  ["x", "x"],
  ["both", "x y"],
] as const)(
  "auxiliary/%s updates only the allowed, overflowing edges",
  (axis, edges) => {
    render(<ScrollArea axis={axis} ref={dimensions} aria-label="scroll" />);
    const element = screen.getByLabelText("scroll");
    expect(element.dataset.scrollStart).toBe("");
    expect(element.dataset.scrollEnd).toBe(edges);
    element.scrollTop = 200;
    element.scrollLeft = 100;
    fireEvent.scroll(element);
    expect(element.dataset.scrollStart).toBe(edges);
    expect(element.dataset.scrollEnd).toBe(edges);
    expect(element.hasAttribute("data-scrolling")).toBe(false);
    element.scrollTop = 399.5;
    element.scrollLeft = 199.5;
    fireEvent.scroll(element);
    expect(element.dataset.scrollStart).toBe(edges);
    expect(element.dataset.scrollEnd).toBe("");
    Object.defineProperties(element, {
      clientHeight: { value: 500 },
      clientWidth: { value: 300 },
    });
    act(() => resizeUpdate());
    expect(element.dataset.scrollStart).toBe("");
    expect(element.dataset.scrollEnd).toBe("");
  },
);

it("observes the viewport and direct children, rebinding only for direct childList mutations", () => {
  render(
    <ScrollArea ref={dimensions} aria-label="scroll">
      <span>first</span>
    </ScrollArea>,
  );
  const element = screen.getByLabelText("scroll");
  expect(resizeObserve).toHaveBeenCalledWith(element);
  expect(resizeObserve).toHaveBeenCalledWith(screen.getByText("first"));
  const child = document.createElement("span");
  element.append(child);
  Object.defineProperty(element, "scrollHeight", { value: 100 });
  act(() => mutationUpdate());
  expect(resizeObserve).toHaveBeenCalledWith(child);
  expect(element.dataset.scrollEnd).toBe("");
  expect(mutationObserve).toHaveBeenCalledWith(element, {
    childList: true,
    subtree: false,
  });
});

it("ignores deep mutations and scrolling, tracks direct additions/removals, and updates edges on resize", async () => {
  vi.stubGlobal("MutationObserver", NativeMutationObserver);
  render(
    <ScrollArea ref={dimensions} aria-label="scroll">
      <div>
        <span>nested</span>
      </div>
    </ScrollArea>,
  );
  const element = screen.getByLabelText("scroll");
  const child = element.firstElementChild as HTMLElement;
  resizeObserve.mockClear();
  resizeDisconnect.mockClear();
  child.append(document.createElement("span"));
  screen.getByText("nested").textContent = "changed";
  child.className = "layout-change";
  child.hidden = true;
  child.dataset.state = "closed";
  fireEvent.scroll(element);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(resizeObserve).not.toHaveBeenCalled();
  expect(resizeDisconnect).not.toHaveBeenCalled();

  Object.defineProperty(element, "scrollHeight", { value: 100 });
  act(() => resizeUpdate());
  expect(element.dataset.scrollEnd).toBe("");
  expect(resizeObserve).not.toHaveBeenCalled();

  const added = document.createElement("div");
  element.append(added);
  await waitFor(() => expect(resizeObserve).toHaveBeenCalledWith(added));
  expect(resizeDisconnect).toHaveBeenCalledOnce();
  resizeObserve.mockClear();
  resizeDisconnect.mockClear();
  added.remove();
  await waitFor(() => expect(resizeDisconnect).toHaveBeenCalledOnce());
  expect(resizeObserve.mock.calls.map(([target]) => target)).toEqual([
    element,
    child,
  ]);
});

it("cleans content timers and listeners on unmount", () => {
  vi.useFakeTimers();
  const { unmount } = render(
    <ScrollArea region="content" aria-label="scroll" />,
  );
  const element = screen.getByLabelText("scroll");
  const remove = vi.spyOn(element, "removeEventListener");
  fireEvent.scroll(element);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  fireEvent.scroll(element);
  expect(element.hasAttribute("data-scrolling")).toBe(false);
});

it("cleans auxiliary observers, attributes and listeners on unmount", () => {
  const ref = vi.fn(dimensions);
  const { unmount } = render(<ScrollArea ref={ref} aria-label="scroll" />);
  const element = screen.getByLabelText("scroll");
  const remove = vi.spyOn(element, "removeEventListener");
  resizeDisconnect.mockClear();
  unmount();
  expect(resizeDisconnect).toHaveBeenCalledOnce();
  expect(mutationDisconnect).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  expect(ref).toHaveBeenLastCalledWith(null);
  fireEvent.scroll(element);
  expect(element.hasAttribute("data-scroll-start")).toBe(false);
  expect(element.hasAttribute("data-scroll-end")).toBe(false);
});

it("replaces observers and listeners when the axis or region changes", () => {
  const { rerender } = render(
    <ScrollArea ref={dimensions} aria-label="scroll" />,
  );
  const element = screen.getByLabelText("scroll");
  rerender(<ScrollArea axis="x" ref={dimensions} aria-label="scroll" />);
  expect(element.dataset.scrollEnd).toBe("x");
  rerender(
    <ScrollArea region="content" ref={dimensions} aria-label="scroll" />,
  );
  expect(element.hasAttribute("data-scroll-end")).toBe(false);
  fireEvent.scroll(element);
  expect(element.hasAttribute("data-scrolling")).toBe(true);
  rerender(<ScrollArea ref={dimensions} aria-label="scroll" />);
  expect(element.hasAttribute("data-scrolling")).toBe(false);
  expect(element.dataset.scrollEnd).toBe("y");
});
