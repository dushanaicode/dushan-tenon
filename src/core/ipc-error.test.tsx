import { render, renderHook, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { toast } from "@/kit";
import { i18n } from "./i18n";
import "./core.test-support";
import { IpcErrorMessage } from "./ipc-error";
import { useIpcErrorToast } from "./use-ipc-toast";

it("renders a translated public error and trace ID without arbitrary error fields", () => {
  const error = {
    code: "app.data.version_conflict",
    params: {},
    traceId: "visible-trace",
    source: "private-source-sentinel",
  };
  render(<IpcErrorMessage error={error} />);
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain(i18n.t(`errors.${error.code}`));
  expect(alert.textContent).toContain("visible-trace");
  expect(alert.textContent).not.toContain(error.source);
});
it("uses the same translated error and trace ID in toasts", () => {
  const show = vi.spyOn(toast, "error").mockImplementation(() => "test-toast");
  const { result } = renderHook(useIpcErrorToast);
  const error = {
    code: "app.data.version_conflict",
    params: {},
    traceId: "toast-trace",
  };
  result.current(error);
  expect(show).toHaveBeenCalledWith(i18n.t(`errors.${error.code}`), {
    description: i18n.t("error.traceId", { traceId: error.traceId }),
  });
});
