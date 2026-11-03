import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { mockAppIpc } from "@/core/core.test-support";
import { DictSelect } from "@/core/dict/dict-select";
import { DictTag } from "@/core/dict/dict-tag";
import { useDict } from "@/core/dict/use-dict";
import { i18n } from "@/core/i18n";
import type { JobStatus } from "@/lib/generated/JobStatus";

test("同步读取名称、标签、色调与声明顺序，不需要会话或查询上下文", async () => {
  const calls = mockAppIpc();
  const { result } = renderHook(() => useDict("framework.job_status"));
  expect(result.current.name).toBe("任务状态");
  expect(result.current.label("succeeded")).toBe("已成功");
  expect(result.current.tone("succeeded")).toBe("success");
  expect(result.current.label("obsolete")).toBe("obsolete");
  expect(result.current.tone("obsolete")).toBe("neutral");
  expect(result.current.options()).toEqual([
    { value: "queued", label: "排队中", tone: "info" },
    { value: "running", label: "执行中", tone: "info" },
    { value: "succeeded", label: "已成功", tone: "success" },
    { value: "failed", label: "已失败", tone: "danger" },
    { value: "cancelled", label: "已取消", tone: "neutral" },
    { value: "needs_review", label: "需核对", tone: "warning" },
  ]);
  expect(result.current).not.toHaveProperty("isPending");
  await act(() => i18n.changeLanguage("en-US"));
  expect(result.current.name).toBe("Job status");
  expect(result.current.options()).toEqual([
    { value: "queued", label: "Queued", tone: "info" },
    { value: "running", label: "Running", tone: "info" },
    { value: "succeeded", label: "Succeeded", tone: "success" },
    { value: "failed", label: "Failed", tone: "danger" },
    { value: "cancelled", label: "Cancelled", tone: "neutral" },
    { value: "needs_review", label: "Needs review", tone: "warning" },
  ]);
  expect(result.current.label("obsolete")).toBe("obsolete");
  expect(calls).not.toHaveBeenCalled();
});

test("DictTag 同步显示标签色调，未知值保持原值与 neutral，语言实时切换", async () => {
  render(
    <>
      <DictTag code="framework.job_status" value="succeeded" />
      <DictTag code="framework.job_status" value="cancelled" />
      <DictTag code="framework.job_status" value="old" />
    </>,
  );
  expect(screen.getByText("已成功").className).toContain("bg-success-soft");
  expect(screen.getByText("已取消").className).toContain("bg-muted");
  expect(screen.getByText("old").className).toContain("bg-muted");
  await act(() => i18n.changeLanguage("en-US"));
  expect(screen.getByText("Succeeded").className).toContain("bg-success-soft");
  expect(screen.getByText("Cancelled")).toBeTruthy();
});

function DictSelectExample({
  onValueChange,
}: {
  onValueChange: (value: string) => void;
}) {
  const [value, setValue] = useState<JobStatus | "">("");
  return (
    <form aria-label="dictionary">
      <DictSelect
        code="framework.job_status"
        aria-label="status"
        name="status"
        emptyLabel="全部"
        value={value}
        onValueChange={(next: JobStatus | "") => {
          setValue(next);
          onValueChange(next);
        }}
      />
      <DictSelect
        code="framework.job_status"
        aria-label="disabled"
        name="disabled"
        value="succeeded"
        onValueChange={onValueChange}
        disabled
      />
    </form>
  );
}

test("DictSelect 按声明顺序提供全部选项，支持空选项、显式禁用和语言切换", async () => {
  const onValueChange = vi.fn();
  render(<DictSelectExample onValueChange={onValueChange} />);
  const form = screen.getByRole<HTMLFormElement>("form", {
    name: "dictionary",
  });
  expect(new FormData(form).get("status")).toBe("");
  expect(new FormData(form).has("disabled")).toBe(false);
  const select = screen.getByRole<HTMLButtonElement>("combobox", {
    name: "status",
  });
  expect(select.disabled).toBe(false);
  expect(select.dataset.slot).toBe("select-trigger");
  expect(
    screen.getByRole<HTMLButtonElement>("combobox", { name: "disabled" })
      .disabled,
  ).toBe(true);
  fireEvent.pointerDown(select, {
    button: 0,
    pointerType: "mouse",
    ctrlKey: false,
  });
  const list = within(await screen.findByRole("listbox"));
  expect(
    list.getAllByRole("option").map((option) => option.textContent),
  ).toEqual([
    "全部",
    "排队中",
    "执行中",
    "已成功",
    "已失败",
    "已取消",
    "需核对",
  ]);
  await act(() => i18n.changeLanguage("en-US"));
  expect(
    list.getAllByRole("option").map((option) => option.textContent),
  ).toEqual([
    "全部",
    "Queued",
    "Running",
    "Succeeded",
    "Failed",
    "Cancelled",
    "Needs review",
  ]);
  for (const [label, value] of [
    ["Queued", "queued"],
    ["Running", "running"],
    ["Succeeded", "succeeded"],
    ["Failed", "failed"],
    ["Cancelled", "cancelled"],
    ["Needs review", "needs_review"],
    ["全部", ""],
  ]) {
    fireEvent.click(await screen.findByRole("option", { name: label }));
    expect(onValueChange).toHaveBeenLastCalledWith(value);
    expect(new FormData(form).get("status")).toBe(value);
    expect(select.textContent).toBe(label);
    fireEvent.pointerDown(select, {
      button: 0,
      pointerType: "mouse",
      ctrlKey: false,
    });
  }
});
