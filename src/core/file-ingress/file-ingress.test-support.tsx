import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { vi } from "vitest";
import type { FileIngressSnapshot } from "@/lib/generated/FileIngressSnapshot";
import type { FilePicked } from "@/lib/generated/FilePicked";
import { mockDeveloperIpc, queryWrapper } from "../core.test-support";
import { ModuleDirectoryProvider } from "../module-directory";
import { testManifest } from "../module-directory.test-support";
import { FileIngressButton, FileIngressProvider, useIncomingFile } from ".";

export const fileManifest = testManifest({
  id: "files",
  basePath: "/files",
  devPages: [
    {
      path: "/files",
      permission: "files.file.read",
      Component: async () => ({ default: () => null }),
    },
  ],
  workbenchObjects: [],
  fileTargets: [
    {
      id: "files.add",
      labelKey: "files.title",
      path: "/files",
      purpose: "store",
      permission: "files.file.write",
      extensions: ["csv", "txt"],
    },
  ],
});
export const incoming: FilePicked = {
  token: "claimed-token",
  fileName: "rows.csv",
  format: "csv",
};

export function setupIngress(
  snapshot: FileIngressSnapshot = {
    pending: [],
    recent: [],
    issue: null,
    skippedDirectories: 0,
  },
  override?: Parameters<typeof mockDeveloperIpc>[0],
) {
  const consumed = vi.fn();
  const calls = mockDeveloperIpc((command, payload) => {
    const result = override?.(command, payload);
    if (result !== undefined) return result;
    if (command === "app_file_ingress_list") return structuredClone(snapshot);
    if (command === "app_file_ingress_claim") {
      const { input } = payload as { input: { id: string } };
      snapshot.pending = snapshot.pending.filter(
        (item) => item.id !== input.id,
      );
      return incoming;
    }
    if (command === "app_file_ingress_dismiss") {
      const { input } = payload as {
        input: { ids: string[]; clearRecent: boolean };
      };
      snapshot.pending = snapshot.pending.filter(
        (item) => !input.ids.includes(item.id),
      );
      if (input.clearRecent) snapshot.recent = [];
      return null;
    }
    if (command === "app_file_recent_open") {
      snapshot.pending.push({
        type: "file",
        id: "reopened",
        name: "rows.csv",
        extension: "csv",
      });
      return null;
    }
  });
  const { client, wrapper } = queryWrapper();
  function Consumer() {
    const incoming = useIncomingFile("files.add");
    const location = useLocation();
    if (incoming) consumed(incoming.file);
    return (
      <>
        <output data-testid="location">{location.pathname}</output>
        <output data-testid="incoming">{incoming?.file.token}</output>
        <button type="button" onClick={() => incoming?.clear()}>
          consume
        </button>
        <FileIngressButton />
      </>
    );
  }
  const tree = (manifests = [fileManifest]) => (
    <ModuleDirectoryProvider manifests={manifests}>
      <MemoryRouter>
        <FileIngressProvider>
          <Consumer />
        </FileIngressProvider>
      </MemoryRouter>
    </ModuleDirectoryProvider>
  );
  const view = render(tree(), { wrapper });
  return { ...view, tree, client, calls, snapshot, consumed };
}
