import { act, fireEvent, render, screen } from "@testing-library/react";
import type { GroupProps } from "react-resizable-panels";
import { afterEach, expect, it, vi } from "vitest";
import { ResizableGroup } from "./resizable";

let complete: GroupProps["onLayoutChanged"];
vi.mock("react-resizable-panels", () => ({
  Group: ({ onLayoutChanged, ...props }: GroupProps) => {
    complete = onLayoutChanged;
    return <div {...props} />;
  },
  Panel: () => null,
  Separator: () => null,
}));

afterEach(() => vi.useRealTimers());

it("a pending keyboard gesture keeps its original sizing frame across a responsive rerender", () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const view = render(
    <ResizableGroup onUserLayoutChange={(layout) => save(layout.primary * 10)}>
      <button type="button">separator</button>
    </ResizableGroup>,
  );
  fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowRight" });
  act(() =>
    complete?.(
      { primary: 25, content: 75 },
      {
        isUserInteraction: true,
        requestedLayout: { primary: 25, content: 75 },
      },
    ),
  );
  view.rerender(
    <ResizableGroup onUserLayoutChange={(layout) => save(layout.primary * 5)}>
      <button type="button">separator</button>
    </ResizableGroup>,
  );
  act(() => vi.advanceTimersByTime(300));
  expect(save).toHaveBeenCalledExactlyOnceWith(250);
});

it("only user completion persists requested proportions", () => {
  const save = vi.fn();
  const restored = vi.fn();
  render(
    <ResizableGroup
      onUserLayoutChange={save}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) restored(layout);
      }}
    />,
  );
  act(() =>
    complete?.(
      { primary: 40, content: 60 },
      {
        isUserInteraction: false,
        requestedLayout: { primary: 28, content: 72 },
      },
    ),
  );
  expect(save).not.toHaveBeenCalled();
  expect(restored).toHaveBeenCalledExactlyOnceWith({
    primary: 40,
    content: 60,
  });
  act(() =>
    complete?.(
      { primary: 40, content: 60 },
      {
        isUserInteraction: true,
        requestedLayout: { primary: 28, content: 72 },
      },
    ),
  );
  expect(save).toHaveBeenCalledExactlyOnceWith({ primary: 28, content: 72 });
  expect(restored).toHaveBeenCalledTimes(1);
  act(() =>
    complete?.(
      { primary: 28, content: 72 },
      {
        isUserInteraction: false,
        requestedLayout: { primary: 28, content: 72 },
      },
    ),
  );
  expect(save).toHaveBeenCalledTimes(1);
  expect(restored).toHaveBeenCalledTimes(2);
  expect(restored).toHaveBeenLastCalledWith({ primary: 28, content: 72 });
});

it("repeated keyboard changes save after 300ms or blur; unmount cancels an unfinished gesture", () => {
  vi.useFakeTimers();
  const save = vi.fn();
  const view = render(
    <ResizableGroup onUserLayoutChange={save}>
      <button type="button">separator</button>
    </ResizableGroup>,
  );
  const target = screen.getByRole("button");
  const press = (primary: number) => {
    fireEvent.keyDown(target, { key: "ArrowRight" });
    act(() =>
      complete?.(
        { primary, content: 100 - primary },
        {
          isUserInteraction: true,
          requestedLayout: { primary, content: 100 - primary },
        },
      ),
    );
  };
  press(25);
  act(() => vi.advanceTimersByTime(200));
  press(27);
  act(() => vi.advanceTimersByTime(299));
  expect(save).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(save).toHaveBeenCalledExactlyOnceWith({ primary: 27, content: 73 });
  press(29);
  fireEvent.blur(target);
  expect(save).toHaveBeenCalledTimes(2);
  press(30);
  view.unmount();
  act(() => vi.advanceTimersByTime(300));
  expect(save).toHaveBeenCalledTimes(2);
});
