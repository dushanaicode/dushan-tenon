// 自写薄封装；react-resizable-panels 4.14.2 / MIT，来源与许可见 ../SOURCES.md。
import { useEffect, useRef } from "react";
import {
  Group,
  type GroupProps,
  type Layout,
  Panel,
  type PanelProps,
  Separator,
  type SeparatorProps,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";

export type ResizableGroupProps = Omit<GroupProps, "onLayoutChange"> & {
  onUserLayoutChange: (requestedLayout: Layout) => void;
};
export type ResizablePanelProps = PanelProps;
export type ResizableHandleProps = SeparatorProps;
export type {
  GroupImperativeHandle as ResizableGroupHandle,
  Layout as ResizableLayout,
} from "react-resizable-panels";

export function ResizableGroup({
  onLayoutChanged,
  onUserLayoutChange,
  className,
  onKeyDownCapture,
  onBlurCapture,
  onPointerDownCapture,
  ...props
}: ResizableGroupProps) {
  const keyboard = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queued = useRef<{
    layout: Layout;
    commit: (layout: Layout) => void;
  } | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  function flush() {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const completion = queued.current;
    queued.current = null;
    if (completion) completion.commit(completion.layout);
  }
  return (
    <Group
      {...props}
      className={cn("flex h-full w-full min-w-0", className)}
      onPointerDownCapture={(event) => {
        keyboard.current = false;
        flush();
        onPointerDownCapture?.(event);
      }}
      onKeyDownCapture={(event) => {
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "Enter",
          ].includes(event.key)
        )
          keyboard.current = true;
        onKeyDownCapture?.(event);
      }}
      onBlurCapture={(event) => {
        flush();
        keyboard.current = false;
        onBlurCapture?.(event);
      }}
      onLayoutChanged={(layout, meta) => {
        onLayoutChanged?.(layout, meta);
        if (!meta.isUserInteraction) return;
        if (!meta.requestedLayout)
          throw new Error("A user resize must provide requestedLayout");
        // Capture the sizing frame of this gesture before a window resize can
        // replace the consumer's percentage-to-pixel conversion.
        queued.current = {
          layout: meta.requestedLayout,
          commit: onUserLayoutChange,
        };
        if (keyboard.current) {
          if (timer.current !== null) clearTimeout(timer.current);
          timer.current = setTimeout(flush, 300);
        } else flush();
      }}
    />
  );
}

export function ResizablePanel(props: ResizablePanelProps) {
  return <Panel {...props} />;
}

export function ResizableHandle({ className, ...props }: ResizableHandleProps) {
  return (
    <Separator
      {...props}
      className={cn(
        "relative z-10 w-px shrink-0 cursor-col-resize bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "after:absolute after:inset-y-0 after:-inset-x-1 after:content-[''] hover:bg-ring data-[separator=active]:bg-ring",
        className,
      )}
    />
  );
}
