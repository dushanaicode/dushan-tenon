import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import "@/core/core.test-support";
import { DisplayNameForm } from "./display-name-form";

test.each(["当前名字", ""])("显示名预填实际资料 %j", (initialName) => {
  render(
    <DisplayNameForm
      initialName={initialName}
      pending={false}
      onSave={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("显示名")).toHaveProperty("value", initialName);
});

test.each([" 前缀", "后缀\u00a0", "控制\u0001字符", "😀".repeat(129)])(
  "显示名拒绝边界空白、控制字符及超过 Unicode 字符数上限的输入（用例 %#）",
  (name) => {
    const onSave = vi.fn();
    render(<DisplayNameForm initialName="" pending={false} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("显示名"), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByLabelText("显示名").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(onSave).not.toHaveBeenCalled();
  },
);

test.each(["", "😀".repeat(128)])(
  "显示名允许清空与 128 个 Unicode 字符（用例 %#）",
  (name) => {
    const onSave = vi.fn();
    render(
      <DisplayNameForm initialName="原名字" pending={false} onSave={onSave} />,
    );
    fireEvent.change(screen.getByLabelText("显示名"), {
      target: { value: name },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSave).toHaveBeenCalledWith(name);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
