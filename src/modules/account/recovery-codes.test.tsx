import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import "@/core/core.test-support";
import { codes } from "./account.test-support";
import { RecoveryCodes } from "./recovery-codes";

test("剪贴板失败时保留恢复码并提示手动保存，只有用户确认才继续", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("denied"),
  );
  const onSaved = vi.fn();
  render(<RecoveryCodes codes={codes} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "复制恢复码" }));
  expect((await screen.findByRole("status")).textContent).toBe(
    "复制失败，请手动保存恢复码。",
  );
  for (const code of codes) expect(screen.getByText(code)).toBeTruthy();
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "我已保存" }));
  expect(onSaved).toHaveBeenCalledTimes(1);
});
