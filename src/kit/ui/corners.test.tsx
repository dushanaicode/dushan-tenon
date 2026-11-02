import { render as renderView, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, expect, test } from "vitest";
import {
  DataTable,
  FilterBar,
  FormField,
  FormSection,
  Input,
  Progress,
  SettingGroup,
  SettingRow,
} from "@/kit";
import { createKitTestI18n, withKitI18n } from "../kit.test-support";

test.each([false, true])(
  "setting rows carry the shared edge geometry through folding: %s",
  (collapsible) => {
    const { container } = render(
      <SettingGroup title="偏好" collapsible={collapsible}>
        <SettingRow label="名称">
          {(control) => <Input {...control} />}
        </SettingRow>
        <p>说明</p>
      </SettingGroup>,
    );
    const group = screen.getByRole("group", { name: "偏好" });
    expect(group.classList.contains("kit-edge-stack")).toBe(true);
    const rows = container.querySelector('[data-part="setting-rows"]');
    expect(rows?.classList.contains("kit-edge-stack")).toBe(true);
    if (collapsible) {
      for (const slot of ["collapsible", "collapsible-content"]) {
        expect(
          container
            .querySelector(`[data-slot="${slot}"]`)
            ?.classList.contains("kit-edge-stack"),
        ).toBe(true);
      }
    }
    expect(group.className).not.toMatch(/overflow-(?:hidden|clip)/);
  },
);

test("form legend stays in the padded content flow and keeps its name", () => {
  render(
    <FormSection title="片段资料" description="提交触发校验">
      <Input aria-label="内容" />
    </FormSection>,
  );
  const group = screen.getByRole("group", { name: "片段资料" });
  const legend = screen.getByText("片段资料");
  expect(group.classList.contains("p-panel")).toBe(true);
  expect(legend.classList.contains("float-left")).toBe(true);
  expect(legend.classList.contains("w-full")).toBe(true);
  expect(group.getAttribute("aria-describedby")).toBe(
    screen.getByText("提交触发校验").id,
  );
});

test("filter labels and controls have padding inside the frame", () => {
  render(
    <FilterBar label="筛选" onSubmit={() => {}}>
      <FormField label="记录名称">
        {(control) => <Input {...control} />}
      </FormField>
    </FilterBar>,
  );
  expect(screen.getByRole("search").classList.contains("p-panel")).toBe(true);
  expect(screen.getByRole("textbox", { name: "记录名称" })).toBeTruthy();
});

test("table frame keeps decoration outside a separate rounded scroll region", () => {
  const { container } = render(
    <DataTable
      caption="记录"
      columns={[{ id: "name", header: "名称", cell: (row: string) => row }]}
      rows={["甲"]}
      getRowId={(row) => row}
    />,
  );
  const frame = container.querySelector('[data-slot="table-container"]');
  const scroll = screen.getByRole("region", { name: "记录" });
  expect(scroll.parentElement).toBe(frame);
  expect(scroll.getAttribute("tabindex")).toBe("0");
  expect(scroll.getAttribute("data-region")).toBe("auxiliary");
  expect(scroll.getAttribute("data-axis")).toBe("x");
  expect(scroll.classList.contains("rounded-[inherit]")).toBe(true);
  expect(frame?.className).not.toMatch(/overflow-(?:hidden|clip|x-auto)/);
  expect(
    scroll.querySelector("table")?.classList.contains("border-separate"),
  ).toBe(true);
});

test("progress clips its fill without creating another scroll container", () => {
  render(<Progress value={60} />);
  const progress = screen.getByRole("progressbar");
  expect(progress.classList.contains("overflow-clip")).toBe(true);
  expect(progress.classList.contains("overflow-hidden")).toBe(false);
});

const i18n = createKitTestI18n();
function render(ui: ReactNode) {
  return renderView(ui, {
    wrapper: ({ children }) => withKitI18n(children, i18n),
  });
}

beforeEach(() => {
  void i18n.changeLanguage("zh-CN");
});
