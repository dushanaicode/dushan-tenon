import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["body"] }],
      h: [{ h: ["control", "row"] }],
      "min-h": [{ "min-h": ["control", "row"] }],
      size: [{ size: ["control"] }],
      p: [{ p: ["panel"] }],
      px: [{ px: ["panel"] }],
      py: [{ py: ["panel"] }],
      gap: [{ gap: ["stack"] }],
      shadow: [{ shadow: ["card", "popover"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
