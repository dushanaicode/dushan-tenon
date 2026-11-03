import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { NavTree } from "../nav-tree";
import { mockShellIpc, renderShell, resizeShell } from "../shell.test-support";

const tree: NavTree = {
  groups: [
    {
      id: "host",
      items: [
        {
          kind: "parent",
          id: "parent",
          label: "nav.developer",
          iconId: "modules",
          badge: { kind: "count", value: 2 },
          children: [
            {
              kind: "leaf",
              id: "files",
              path: "/files",
              label: "files.title",
              iconId: "files",
              shortcut: "$mod+j",
              badge: { kind: "new", labelKey: "nav.home" },
            },
            {
              kind: "leaf",
              id: "jobs",
              path: "/jobs",
              label: "jobs.title",
              iconId: "jobs",
            },
          ],
        },
      ],
    },
  ],
  footer: [],
};

it("进入活动父项自动展开，手动收起在同父页面和折叠侧栏期间保留", async () => {
  mockShellIpc();
  renderShell({ tree }, "/files");
  const parent = await screen.findByRole("button", { name: "开发者" });
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "收起侧栏" }));
  await screen.findByRole("button", { name: "展开侧栏" });
  fireEvent.click(screen.getByRole("button", { name: "展开侧栏" }));
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "开发者" })
        .getAttribute("aria-expanded"),
    ).toBe("false"),
  );
});
it("图标栏父项用 ref 导航子项，Esc 返回触发器，选页后聚焦 h1", async () => {
  mockShellIpc();
  renderShell({ tree });
  await screen.findByRole("button", { name: "收起侧栏" });
  resizeShell(900);
  const parent = screen.getByRole("button", { name: /开发者/ });
  parent.focus();
  fireEvent.keyDown(parent, { key: "ArrowRight" });
  const flyout = await screen.findByRole("dialog", { name: "开发者" });
  const leaves = within(flyout).getAllByRole("link");
  expect(document.activeElement).toBe(leaves[0]);
  fireEvent.keyDown(leaves[0], { key: "End" });
  expect(document.activeElement).toBe(leaves[1]);
  fireEvent.keyDown(leaves[1], { key: "Home" });
  expect(document.activeElement).toBe(leaves[0]);
  fireEvent.keyDown(leaves[0], { key: "Escape" });
  await waitFor(() => expect(document.activeElement).toBe(parent));
  fireEvent.keyDown(parent, { key: "ArrowRight" });
  fireEvent.click(
    within(await screen.findByRole("dialog", { name: "开发者" })).getByRole(
      "link",
      { name: "文件管理" },
    ),
  );
  const title = await screen.findByRole("heading", { name: "/files" });
  await waitFor(() => expect(document.activeElement).toBe(title));
});
it("父项展开集合按账户会话重建，树移除后不留下失效展开项", async () => {
  mockShellIpc();
  const view = renderShell({ tree });
  const parent = await screen.findByRole("button", { name: "开发者" });
  fireEvent.click(parent);
  expect(parent.getAttribute("aria-expanded")).toBe("true");
  view.update({ userId: "another-subject" });
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "开发者" })
        .getAttribute("aria-expanded"),
    ).toBe("false"),
  );
  view.update({ tree: { groups: [], footer: [] } });
  expect(screen.queryByRole("button", { name: "开发者" })).toBeNull();
  view.update({ tree });
  expect(
    screen
      .getByRole("button", { name: "开发者" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
});
