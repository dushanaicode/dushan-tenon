import type { Titlebar } from "@/lib/generated/Titlebar";

export function dragRegion(titlebar: Titlebar) {
  return titlebar === "hidden" ? { "data-window-drag": "" } : {};
}

/** Mac's WKWebView needs a native drag request; CSS remains the hit-test source. */
export function isWindowDragGesture(event: MouseEvent): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.buttons !== 1 ||
    !(event.target instanceof Element)
  )
    return false;

  const target = event.target;
  const style = getComputedStyle(target);
  if (target.closest("[data-window-drag]"))
    return style.getPropertyValue("--window-drag-allowed").trim() === "1";

  // The Cocoa traffic-light strip is shell padding, outside its HTML header.
  if (target.matches('[data-shell="root"]')) {
    const top = target.getBoundingClientRect().top;
    return (
      event.clientY >= top &&
      event.clientY < top + Number.parseFloat(style.paddingTop)
    );
  }
  return false;
}
