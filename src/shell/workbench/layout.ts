import type { AuxiliaryLayout } from "@/lib/generated/AuxiliaryLayout";
import type { WorkbenchLayout } from "@/lib/generated/WorkbenchLayout";
import {
  AUXILIARY_LAYOUT_LIMITS,
  CONSOLE_LAYOUT_LIMITS,
} from "@/lib/generated/workbench";

export const CONTENT_MIN_WIDTH = 400;
export const SEPARATOR_WIDTH = 1;

export function auxiliaryLayout(
  requested: AuxiliaryLayout,
  containerWidth: number,
  available: boolean,
  zen: boolean,
) {
  const minimum =
    CONSOLE_LAYOUT_LIMITS.min +
    CONTENT_MIN_WIDTH +
    AUXILIARY_LAYOUT_LIMITS.min +
    SEPARATOR_WIDTH * 2;
  const asSheet =
    tierForWidth(containerWidth) !== "expanded" || containerWidth < minimum;
  const docked = available && requested.visible && !asSheet && !zen;
  const width = docked
    ? Math.min(
        requested.width,
        containerWidth - minimum + AUXILIARY_LAYOUT_LIMITS.min,
      )
    : 0;
  return {
    asSheet,
    docked,
    width,
    availableWidth: containerWidth - (docked ? width + SEPARATOR_WIDTH : 0),
  };
}

export function panelSizes(
  groupWidth: number,
  primaryWidth: number | null,
  auxiliaryWidth: number | null,
) {
  const separators =
    Number(primaryWidth !== null) + Number(auxiliaryWidth !== null);
  const usable = groupWidth - separators * SEPARATOR_WIDTH;
  const primary = primaryWidth === null ? 0 : (primaryWidth / usable) * 100;
  const auxiliary =
    auxiliaryWidth === null ? 0 : (auxiliaryWidth / usable) * 100;
  return {
    ...(primaryWidth === null ? {} : { primary }),
    content: 100 - primary - auxiliary,
    ...(auxiliaryWidth === null ? {} : { auxiliary }),
  };
}

export function requestedAuxiliaryLayout(
  width: number,
  previous: AuxiliaryLayout,
) {
  const rounded = Math.round(width);
  return {
    width:
      rounded === 0
        ? previous.width
        : Math.min(
            AUXILIARY_LAYOUT_LIMITS.max,
            Math.max(AUXILIARY_LAYOUT_LIMITS.min, rounded),
          ),
    visible: rounded !== 0,
  };
}

export function consoleLayout(
  requested: WorkbenchLayout,
  availableWidth: number,
) {
  return {
    primaryWidth: requested.primaryCollapsed
      ? CONSOLE_LAYOUT_LIMITS.collapsed
      : Math.min(
          requested.primaryWidth,
          Math.max(
            CONSOLE_LAYOUT_LIMITS.min,
            availableWidth - CONTENT_MIN_WIDTH - SEPARATOR_WIDTH,
          ),
        ),
  };
}

// Only a user completion reaches this function. Responsive/imperative events never save.
export function requestedConsoleLayout(
  width: number,
  previous: WorkbenchLayout,
): WorkbenchLayout {
  const rounded = Math.round(width);
  const primaryCollapsed = rounded === CONSOLE_LAYOUT_LIMITS.collapsed;
  return {
    ...previous,
    primaryCollapsed,
    primaryWidth: primaryCollapsed
      ? previous.primaryWidth
      : Math.min(
          CONSOLE_LAYOUT_LIMITS.max,
          Math.max(CONSOLE_LAYOUT_LIMITS.min, rounded),
        ),
  };
}

import { tierForWidth } from "@/kit";
