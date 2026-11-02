import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Input } from "./input";
import { NavGroupLabel } from "./nav-group-label";
import { SettingGroup, SettingRow } from "./setting-group";
import { Switch } from "./switch";

const settingGroupCss = readFileSync("src/kit/ui/setting-group.css", "utf8");

test("SettingRow 复用字段标签、说明、错误和来源关联", () => {
  render(
    <SettingGroup title="偏好" description="本机设置">
      <SettingRow
        label="名称"
        description="最多十字"
        hint="只读来源"
        source="environment"
        error="名称无效"
        required
      >
        {(control) => <Input {...control} />}
      </SettingRow>
    </SettingGroup>,
  );
  const input = screen.getByRole("textbox", { name: "名称" });
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-required")).toBe("true");
  const ids = input.getAttribute("aria-describedby")?.split(" ");
  expect(ids?.map((id) => document.getElementById(id)?.textContent)).toEqual([
    "最多十字只读来源",
    "名称无效",
  ]);
  expect(screen.getByRole("alert").id).toBe(ids?.[1]);
  const row = input.closest('[data-slot="form-field"]');
  const hint = screen.getByText("只读来源");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(settingGroupCss);
  const spacing = sheet.cssRules[0] as CSSStyleRule;
  expect(row?.matches(spacing.selectorText)).toBe(true);
  expect(spacing.style.rowGap).toBe("8px");
  expect(hint.classList.contains("self-start")).toBe(true);
  expect(hint.classList.contains("text-right")).toBe(true);
  expect(hint.closest('[data-part="setting-control"]')).toBeNull();
  expect(
    input.closest('[data-kit="setting-row"]')?.getAttribute("data-source"),
  ).toBe("environment");
  expect(
    screen
      .getByRole("group", { name: "偏好" })
      .getAttribute("aria-describedby"),
  ).toBe(screen.getByText("本机设置").id);
});

test("SettingGroup 折叠使用可聚焦的原生按钮和 kit-collapse", () => {
  render(
    <SettingGroup title="折叠偏好" collapsible defaultOpen={false}>
      <SettingRow label="提醒">
        {(control) => <Switch {...control} />}
      </SettingRow>
    </SettingGroup>,
  );
  const trigger = screen.getByRole("button", { name: "折叠偏好" });
  expect(trigger.tagName).toBe("BUTTON");
  trigger.focus();
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("switch")).toBeNull();
  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(
    screen.getByRole("switch", { name: "提醒" }).closest(".kit-collapse"),
  ).not.toBeNull();
  fireEvent.click(trigger);
  expect(screen.queryByRole("switch")).toBeNull();
});

test("NavGroupLabel 只有非交互段落语义", () => {
  const { container } = render(<NavGroupLabel>模块设置</NavGroupLabel>);
  const label = screen.getByText("模块设置");
  expect(label.tagName).toBe("P");
  expect(label.getAttribute("data-part")).toBe("nav-group-label");
  expect(label.classList.contains("select-none")).toBe(true);
  expect(
    container.querySelector("button, a, [tabindex], [role=button], [style]"),
  ).toBeNull();
});
