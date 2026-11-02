import { type HTMLAttributes, type Ref, useCallback } from "react";
import { cn } from "@/lib/utils";

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  region?: "content" | "auxiliary";
  axis?: "y" | "x" | "both";
  ref?: Ref<HTMLDivElement>;
  plateClassName?: string;
}

function watchScrolling(element: HTMLDivElement) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    element.setAttribute("data-scrolling", "");
    clearTimeout(timer);
    timer = setTimeout(() => element.removeAttribute("data-scrolling"), 800);
  };
  element.addEventListener("scroll", update, { passive: true });
  return () => {
    element.removeEventListener("scroll", update);
    clearTimeout(timer);
    element.removeAttribute("data-scrolling");
  };
}

function watchEdges(element: HTMLDivElement, axis: ScrollAreaProps["axis"]) {
  const update = () => {
    const start: string[] = [];
    const end: string[] = [];
    if (axis !== "y" && element.scrollWidth > element.clientWidth) {
      if (element.scrollLeft > 0) start.push("x");
      if (element.scrollLeft + element.clientWidth < element.scrollWidth - 1)
        end.push("x");
    }
    if (axis !== "x" && element.scrollHeight > element.clientHeight) {
      if (element.scrollTop > 0) start.push("y");
      if (element.scrollTop + element.clientHeight < element.scrollHeight - 1)
        end.push("y");
    }
    element.dataset.scrollStart = start.join(" ");
    element.dataset.scrollEnd = end.join(" ");
  };
  const resize = new ResizeObserver(update);
  const observe = () => {
    resize.disconnect();
    resize.observe(element);
    for (const child of element.children) resize.observe(child);
    update();
  };
  const mutation = new MutationObserver(observe);
  mutation.observe(element, {
    childList: true,
    subtree: false,
  });
  element.addEventListener("scroll", update, { passive: true });
  observe();
  return () => {
    element.removeEventListener("scroll", update);
    resize.disconnect();
    mutation.disconnect();
    delete element.dataset.scrollStart;
    delete element.dataset.scrollEnd;
  };
}

export function ScrollArea({
  region = "auxiliary",
  axis = "y",
  ref,
  plateClassName,
  children,
  ...props
}: ScrollAreaProps) {
  const attach = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const releaseRef = typeof ref === "function" ? ref(element) : undefined;
      if (ref && typeof ref !== "function") ref.current = element;
      const cleanup =
        region === "content"
          ? watchScrolling(element)
          : watchEdges(element, axis);
      return () => {
        cleanup();
        if (releaseRef) releaseRef();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref, region, axis],
  );
  return (
    <div
      {...props}
      ref={attach}
      data-kit="scroll-area"
      data-region={region}
      data-axis={axis}
    >
      {region === "content" ? (
        <div
          data-slot="scroll-plate"
          className={cn("@container/content", plateClassName)}
        >
          {children}
        </div>
      ) : (
        children
      )}
    </div>
  );
}
