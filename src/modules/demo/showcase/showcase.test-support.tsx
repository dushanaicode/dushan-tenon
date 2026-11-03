import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { EditSessionsProvider } from "@/core/edit-sessions";
import { FileIngressProvider } from "@/core/file-ingress";
import { ModuleDirectoryProvider } from "@/core/module-directory";
import { setupDemo } from "../demo.test-support";
import { demoManifest } from "../manifest";

export function setupShowcase(path: string, element: ReactNode) {
  const setup = setupDemo("/demo/samples");
  setup.unmount();
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <EditSessionsProvider>
            <FileIngressProvider>{element}</FileIngressProvider>
          </EditSessionsProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={setup.client}>
      <ModuleDirectoryProvider manifests={[demoManifest]}>
        <RouterProvider router={router} />
      </ModuleDirectoryProvider>
    </QueryClientProvider>,
  );
  return { ...setup, ...view, router };
}
