import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, test } from "vitest";
import { createQueryClient } from "@/core/query-client";
import { newId } from "@/lib/id";
import { malformedIds } from "@/lib/id.test-support";
import { mockDemoIpc, setupDemo } from "./demo.test-support";
import DemoJobPage from "./job-page";
import DemoSamplePage from "./sample-detail";

const invalidIds = malformedIds()
  .filter(([label]) => label !== "empty")
  .map(([, id]) => id);

test.each(
  ["samples", "jobs"].flatMap((page) => invalidIds.map((id) => ({ page, id }))),
)(
  "invalid /demo/$page/$id renders 404 without any IPC",
  async ({ page, id }) => {
    const calls = mockDemoIpc();
    const client = createQueryClient();
    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[`/demo/${page}/${id}`]}>
            <Routes>
              <Route path="/demo/samples/:id" element={<DemoSamplePage />} />
              <Route path="/demo/jobs/:id" element={<DemoJobPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    expect(calls).not.toHaveBeenCalled();
    expect(screen.getByText("页面不存在")).toBeTruthy();

    client.clear();
  },
);

test.each([
  ["samples", "demo_sample_get", "demo.sample.not_found"],
  ["jobs", "app_job_mine_get", "app.data.not_found"],
])(
  "valid /demo/%s UUIDv7 reaches IPC even when the record does not exist",
  async (page, command, code) => {
    const id = newId();
    const { calls } = setupDemo(`/demo/${page}/${id}`, (name) =>
      name === command
        ? Promise.reject({ code, params: {}, traceId: "missing-v7" })
        : undefined,
    );
    await screen.findByText(/missing-v7/);
    expect(calls).toHaveBeenCalledWith(command, { input: { id } });
    expect(screen.queryByText("404")).toBeNull();
  },
);
