import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { send, setupExchange } from "./exchange.test-support";
import { ExportButton } from "./export-button";

test("format selection reaches the host picker and submitted export job", async () => {
  const { state, calls } = setupExchange();
  const submit = vi.fn().mockResolvedValue({ jobId: "job" }),
    complete = vi.fn();
  render(
    <ExportButton
      suggestedName="rows"
      onSubmit={submit}
      onComplete={complete}
    />,
  );
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("option", { name: /JSON/ }));
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  await waitFor(() =>
    expect(submit).toHaveBeenCalledWith("json", "file-token"),
  );
  expect(calls).toHaveBeenCalledWith("app_file_pick", {
    input: { purpose: "export", format: "json", suggestedName: "rows.json" },
  });
  expect(screen.getByRole("button", { name: "导出" })).toHaveProperty(
    "disabled",
    true,
  );
  state.detail.status = "succeeded";
  state.detail.result = { rows: 3, fileName: "rows.json" };
  await send(state, { type: "succeeded", data: null });
  expect(await screen.findByText("已导出 3 行：rows.json")).toBeTruthy();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "导出" })).toHaveProperty(
    "disabled",
    false,
  );
});

test("dismissing the native picker submits nothing", async () => {
  const { state, calls } = setupExchange();
  state.selection = null;
  const submit = vi.fn();
  render(
    <ExportButton
      suggestedName="rows"
      onSubmit={submit}
      onComplete={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("app_file_pick", expect.anything()),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "导出" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(submit).not.toHaveBeenCalled();
});

test("export submission errors remain visible and allow another attempt", async () => {
  setupExchange();
  render(
    <ExportButton
      suggestedName="rows"
      onSubmit={vi.fn().mockRejectedValue({
        code: "app.exchange.file_token_invalid",
        params: {},
        traceId: "export-error",
      })}
      onComplete={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  expect(await screen.findByText("文件选择已失效，请重新选择。")).toBeTruthy();
  expect(screen.getByRole("button", { name: "导出" })).toHaveProperty(
    "disabled",
    false,
  );
});
