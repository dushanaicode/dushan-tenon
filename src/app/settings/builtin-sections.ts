import type { ModuleSetting } from "@/core/contracts/module";

export const builtinSections: readonly ModuleSetting[] = [
  {
    id: "general",
    labelKey: "settings.sections.general",
    order: 10,
    Component: () =>
      import("./general-section").then((m) => ({ default: m.GeneralSection })),
  },
  {
    id: "appearance",
    labelKey: "settings.sections.appearance",
    order: 20,
    Component: () =>
      import("./appearance-section").then((m) => ({
        default: m.AppearanceSection,
      })),
  },
  {
    id: "network",
    labelKey: "settings.sections.network",
    order: 70,
    Component: () =>
      import("./network-section").then((m) => ({ default: m.NetworkSection })),
  },
  {
    id: "advanced",
    labelKey: "settings.sections.advanced",
    order: 90,
    Component: () =>
      import("./advanced-section").then((m) => ({
        default: m.AdvancedSection,
      })),
  },
  {
    id: "data",
    labelKey: "settings.sections.data",
    order: 85,
    Component: () =>
      import("./data-section").then((m) => ({ default: m.DataSection })),
  },
  {
    id: "about",
    labelKey: "settings.sections.about",
    order: 100,
    Component: () =>
      import("./about-section").then((m) => ({ default: m.AboutSection })),
  },
];
