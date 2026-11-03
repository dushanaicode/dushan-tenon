import type { ModuleManifest } from "@/core/contracts/module";
import { accountManifest } from "@/modules/account/manifest";
import { demoManifest } from "@/modules/demo/manifest";
import { devtoolsManifest } from "@/modules/devtools/manifest";
import { filesManifest } from "@/modules/files/manifest";
import { notifyManifest } from "@/modules/notify/manifest";

export const manifests: readonly ModuleManifest[] = [
  accountManifest,
  notifyManifest,
  filesManifest,
  devtoolsManifest,
  demoManifest,
];
