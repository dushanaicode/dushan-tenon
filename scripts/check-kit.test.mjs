import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { format } from "node:util";
import { checkKit, scan, scanSource } from "./check-kit.mjs";

const sourcePath = "src/modules/example.tsx";
const zero = {
  "native-table": 0,
  "native-dialog": 0,
  "native-select": 0,
  "kit-internal-import": 0,
  "engine-import": 0,
  "native-message-box": 0,
  "confirm-label": 0,
  "dialog-title": 0,
  "raw-scroll": 0,
  "viewport-breakpoint": 0,
};
let errorSpy;
let warnSpy;

beforeEach(() => {
  errorSpy = mock.method(console, "error");
  warnSpy = mock.method(console, "warn");
});

afterEach(() => {
  try {
    assert.equal(errorSpy.mock.callCount(), 0);
    assert.equal(warnSpy.mock.callCount(), 0);
  } finally {
    errorSpy.mock.restore();
    warnSpy.mock.restore();
  }
});

describe("scanSource", () => {
  for (const className of [
    "sm:block",
    "md:grid-cols-2",
    "lg:inline",
    "xl:block",
    "2xl:block",
    "max-sm:hidden",
    "max-xl:block",
    "min-md:block",
    "max-[720px]:w-screen",
    "min-[900px]:flex",
    "hover:lg:block",
    "dark:max-[42rem]:block",
    "!md:block",
    "md:block!",
  ]) {
    it(
      format(
        "viewport-breakpoint rejects %s in shell/templates only",
        className,
      ),
      () => {
        for (const path of [
          "src/shell/layout.tsx",
          "src/kit/templates/page.tsx",
          "src/shell/layout.test.tsx",
        ]) {
          for (const expression of [
            `"${className}"`,
            `{cn("p-2", "${className}")}`,
            `{clsx({ "${className}": active })}`,
            `{active ? "${className}" : "block"}`,
            `{\`p-2 ${className}\`}`,
          ]) {
            assert.deepEqual(
              scanSource(
                path,
                `const view = <div\n className=${expression} />;`,
              ),
              [{ rule: "viewport-breakpoint", path, line: 2 }],
            );
          }
        }
        assert.deepEqual(
          scanSource(
            "src/kit/ui/dialog.tsx",
            `const view = <div className="${className}" />;`,
          ),
          [],
        );
        assert.deepEqual(
          scanSource(
            sourcePath,
            `const view = <div className="${className}" />;`,
          ),
          [],
        );
      },
    );
  }

  it("viewport-breakpoint accepts named containers and ignores text/attribute content; nested cn counts once", () => {
    const path = "src/shell/layout.tsx";
    assert.deepEqual(
      scanSource(
        path,
        `const text = "lg:block"; const view = <div title="md:block" className={cn("@medium/content:block @expanded/shell:inline @max-medium/content:hidden @min-[560px]/content:grid-cols-2", "content-['md:block']")}>sm:block</div>;`,
      ),
      [],
    );
    assert.deepEqual(
      scanSource(
        path,
        'const classes = cn(clsx("lg:block")); const view = <div className={classes} />;',
      ),
      [{ rule: "viewport-breakpoint", path, line: 1 }],
    );
  });
  for (const className of [
    "overflow-auto",
    "overflow-scroll",
    "overflow-x-auto",
    "overflow-y-auto",
    "overflow-x-scroll",
    "overflow-y-scroll",
    "kit-no-scrollbar",
    "[scrollbar-gutter:stable_both-edges]",
    "[scrollbar-width:none]",
    "[overflow:auto]",
    "hover:overflow-y-auto",
    "md:[overflow:scroll]",
    "overflow-auto!",
    "!overflow-auto",
  ]) {
    it(
      format("raw-scroll 拒绝 className 与 cn/clsx 字面量中的 %s", className),
      () => {
        for (const expression of [
          `"${className}"`,
          `{cn("p-2", "${className}")}`,
          `{clsx({ "${className}": active })}`,
          `{active ? "${className}" : "overflow-hidden"}`,
          `{\`p-2 ${className}\`}`,
        ]) {
          assert.deepEqual(
            scanSource(
              sourcePath,
              `const view = <div\n className=${expression} />;`,
            ),
            [{ rule: "raw-scroll", path: sourcePath, line: 2 }],
          );
        }
      },
    );
  }

  it("raw-scroll 覆盖独立 cn/clsx 组合，嵌套调用不会重复计数", () => {
    assert.deepEqual(
      scanSource(
        sourcePath,
        'const classes = cn(clsx("overflow-auto")); const view = <div className={classes} />;',
      ),
      [{ rule: "raw-scroll", path: sourcePath, line: 1 }],
    );
  });

  it("raw-scroll 只豁免 kit 的实现文件，支持规范化 Windows 路径", () => {
    const text = 'const view = <div className="overflow-auto" />;';
    assert.deepEqual(scanSource("src\\kit\\ui\\scroll-area.tsx", text), []);
    for (const path of [
      "src/kit/ui/other.tsx",
      "src/kit/ui/scroll-area.test.tsx",
      "src/modules/scroll-area.tsx",
      "src/app/view.tsx",
      "src/shell/view.tsx",
      "src/styleguide/view.tsx",
    ]) {
      assert.deepEqual(scanSource(path, text), [
        { rule: "raw-scroll", path, line: 1 },
      ]);
    }
  });

  it("raw-scroll 不误报裁剪、普通文本、注释与非 className 属性", () => {
    assert.deepEqual(
      scanSource(
        sourcePath,
        `
      // <div className="overflow-auto" />
      const message = "overflow-auto";
      const view = <div title="overflow-auto" className={cn("overflow-hidden overflow-x-clip", "scroll-py-1", { "my-overflow-auto": true })}>overflow-scroll</div>;
    `,
      ),
      [],
    );
  });

  for (const tag of ["table", "dialog", "select"]) {
    it(
      format("按 JSX AST 识别原生 %s 的开标签与自闭合标签，每处计一次", tag),
      () => {
        const text = `const view = <>\n<${tag}></${tag}>\n<${tag} />\n</>;`;
        assert.deepEqual(scanSource(sourcePath, text), [
          { rule: `native-${tag}`, path: sourcePath, line: 2 },
          { rule: `native-${tag}`, path: sourcePath, line: 3 },
        ]);
      },
    );
  }

  it("字符串、注释、模板、大写、成员与命名空间组件不误报", () => {
    assert.deepEqual(
      scanSource(
        sourcePath,
        `
        // <table> <dialog> <select />
        const text = "<table> <dialog> <select />";
        const template = \`<table> <dialog> <select />\`;
        const view = <>
          <Table /><Dialog /><Select /><ui.table /><svg:table />
        </>;
        `,
      ),
      [],
    );
  });

  for (const text of [
    'import { Button } from "@/kit/ui/button";',
    'import type { ButtonProps } from "@/kit/ui/button";',
    'export { Button } from "@/kit/ui/button";',
    'export type { ButtonProps } from "@/kit/ui/button";',
    'export * from "@/kit/ui/button";',
    'import "@/kit/styles/base.css";',
    'import { Button } from "../kit/ui/button";',
    'import { Button } from "../kit/ui/button.tsx";',
    'export { Button } from "../../src/kit/ui/button";',
    'import { Button } from "../lib/../kit/ui/button";',
    'const loaded = import("@/kit/ui/button");',
    'type Imported = import("../kit/ui/button").ButtonProps;',
  ]) {
    it(format("禁止内部导入或重导出：%s", text), () => {
      assert.deepEqual(scanSource(sourcePath, text), [
        { rule: "kit-internal-import", path: sourcePath, line: 1 },
      ]);
    });
  }

  for (const text of [
    'import { Button } from "@/kit";',
    'export { Button } from "@/kit/index";',
    'export { Button } from "@/kit/index.ts";',
    'import { Button } from "../kit";',
    'export { Button } from "../kit/index";',
    'import type { ButtonProps } from "../kit/index.ts";',
    'import { cn } from "../kit/../lib/utils";',
    'import { Button } from "../kitten/ui/button";',
    "const text = 'import { Button } from \"@/kit/ui/button\"';",
    '// export { Button } from "@/kit/ui/button";',
    'const loaded = import("@/kit");',
    'type Imported = import("@/kit/index").ButtonProps;',
    "const loaded = import(moduleName);",
    "const loaded = import(`@/kit/ui/button`);",
    `const loaded = import(\`@/kit/ui/\${component}\`);`,
    "export { local };",
  ]) {
    it(format("允许公共入口且忽略非导入文本：%s", text), () => {
      assert.deepEqual(scanSource(sourcePath, text), []);
    });
  }

  it("规范化 Windows 文件路径并报告 import 的起始行", () => {
    assert.deepEqual(
      scanSource(
        "src\\modules\\example.tsx",
        '// 中文\r\nimport {\r\n Button\r\n} from "../kit/ui/button";',
      ),
      [{ rule: "kit-internal-import", path: sourcePath, line: 2 }],
    );
  });

  for (const name of [
    "@tanstack/react-table",
    "@tanstack/table-core",
    "@radix-ui/react-dialog",
    "radix-ui",
    "sonner",
    "cmdk",
    "@tanstack/react-virtual",
    "@tanstack/virtual-core",
    "react-resizable-panels",
    "streamdown",
    "@streamdown/cjk",
    "use-stick-to-bottom",
  ]) {
    it(format("禁止底层依赖 %s 的 import type 与 export", name), () => {
      assert.deepEqual(
        scanSource(
          "src/modules/types.ts",
          `import type { X } from "${name}";\nexport { x } from "${name}";`,
        ),
        [
          { rule: "engine-import", path: "src/modules/types.ts", line: 1 },
          { rule: "engine-import", path: "src/modules/types.ts", line: 2 },
        ],
      );
    });
  }

  for (const name of [
    "react",
    "@tanstack/react-query",
    "react-router",
    "i18next",
    "react-i18next",
    "radix-ui-other",
    "sonner-kit",
  ]) {
    it(format("允许未禁止的依赖 %s", name), () => {
      assert.deepEqual(
        scanSource(sourcePath, `import { x } from "${name}";`),
        [],
      );
    });
  }

  for (const text of [
    'export * from "radix-ui";',
    'export { toast } from "sonner";',
    'export { toast as notify } from "sonner/dist/index.mjs";',
    'import { toast as notify } from "sonner/dist/index.mjs";',
    'const loaded = import("sonner/dist/index.mjs");',
    'const loaded = import("@tanstack/react-table");',
    'type Imported = import("@tanstack/table-core").Table;',
    'const loaded = import("@tanstack/react-virtual");',
    'export * from "react-resizable-panels";',
    'import "streamdown/styles.css";',
    'type Imported = import("@streamdown/cjk").Plugin;',
    'const loaded = import("use-stick-to-bottom");',
  ]) {
    it(format("底层依赖不能通过其它模块语法绕过：%s", text), () => {
      assert.deepEqual(scanSource(sourcePath, text), [
        { rule: "engine-import", path: sourcePath, line: 1 },
      ]);
    });
  }

  it("kit 内部使用相对原语，不自引公共桶或别名；模板也检查可访问组合", () => {
    const path = "src/kit/templates/form.tsx";
    assert.deepEqual(
      scanSource(
        path,
        'import { DialogContent as C } from "../ui/dialog"; const v = <C />;',
      ),
      [{ rule: "dialog-title", path, line: 1 }],
    );
    assert.deepEqual(
      scanSource(
        path,
        'import * as Sheet from "../ui/sheet.tsx"; const v = <Sheet.SheetContent />;',
      ),
      [{ rule: "dialog-title", path, line: 1 }],
    );
    assert.deepEqual(
      scanSource(
        path,
        'import { ConfirmDialog as C } from "../ui/confirm-dialog"; const v = <C />;',
      ),
      [{ rule: "confirm-label", path, line: 1 }],
    );
    assert.deepEqual(
      scanSource(
        path,
        'import { DialogContent as C, DialogTitle as T } from "../ui/dialog"; const v = <C><T>标题</T></C>;',
      ),
      [],
    );
    assert.deepEqual(
      scanSource(
        path,
        'import { ConfirmDialog as C } from "../ui/confirm-dialog"; const v = <C confirmLabel="删除记录" />;',
      ),
      [],
    );
    for (const name of ["@/kit", "../index", "@/kit/ui/button"]) {
      assert.deepEqual(scanSource(path, `import { Button } from "${name}";`), [
        { rule: "kit-internal-import", path, line: 1 },
      ]);
    }
    assert.deepEqual(
      scanSource(
        "src/kit/ui/dialog.tsx",
        'import { Dialog } from "radix-ui"; const v = <dialog><table /><select /></dialog>;',
      ),
      [],
    );
  });

  it("原生消息框与缺少动作标签被拒绝", () => {
    const text = [
      'import { ConfirmDialog as Confirm } from "@/kit";',
      'window.confirm("删除记录？");',
      'globalThis["alert"]("操作失败");',
      'window?.prompt("名称");',
      'const view = <Confirm title="删除记录" />;',
    ].join("\n");
    assert.deepEqual(scanSource(sourcePath, text), [
      { rule: "native-message-box", path: sourcePath, line: 2 },
      { rule: "native-message-box", path: sourcePath, line: 3 },
      { rule: "native-message-box", path: sourcePath, line: 4 },
      { rule: "confirm-label", path: sourcePath, line: 5 },
    ]);
  });

  for (const [imports, view] of [
    ["import { ConfirmDialog as C } from '@/kit/index';", "<C />"],
    ["import * as Kit from '@/kit';", "<Kit.ConfirmDialog {...props} />"],
    ["import { ConfirmDialog } from '../kit';", "<ConfirmDialog />"],
    [
      "import { ConfirmDialog } from '@/kit';",
      '<ConfirmDialog confirmLabel="" />',
    ],
    [
      "import { ConfirmDialog } from '@/kit';",
      "<ConfirmDialog confirmLabel={null} />",
    ],
    [
      "import { ConfirmDialog } from '@/kit';",
      "<ConfirmDialog confirmLabel={undefined} />",
    ],
    [
      "import { ConfirmDialog } from '@/kit';",
      "<ConfirmDialog confirmLabel />",
    ],
  ]) {
    it(format("显式动作标签覆盖公共入口与别名：%s %s", imports, view), () => {
      assert.deepEqual(
        scanSource(sourcePath, `${imports}\nconst view = ${view};`),
        [{ rule: "confirm-label", path: sourcePath, line: 2 }],
      );
    });
  }

  for (const text of [
    "const confirm = () => true; confirm();",
    'api.confirm(); const text = "window.confirm()";',
    "function example(window) { window.confirm(); }",
    "const window = service; window.alert();",
    "function example({ globalThis }) { globalThis.prompt(); }",
    'import { ConfirmDialog } from "./local"; const view = <ConfirmDialog />;',
    'import { ConfirmDialog } from "@/kit"; const view = <ConfirmDialog confirmLabel="删除记录" />;',
    'import * as Kit from "@/kit"; const view = <Kit.ConfirmDialog confirmLabel={t("delete")} />;',
    'export { ConfirmDialog as Confirm } from "@/kit";',
  ]) {
    it(
      format("有限语法检查不误报业务方法、遮蔽名称或显式标签：%s", text),
      () => {
        assert.deepEqual(scanSource(sourcePath, text), []);
      },
    );
  }

  for (const kind of ["Dialog", "Sheet"]) {
    it(format("%s 静态缺 Title 拒绝，动态组合留人工", kind), () => {
      const imports = `import { ${kind}Content as Content, ${kind}Header as Header, ${kind}Title as Title } from "@/kit";`;
      for (const view of [
        "<Content />",
        "<Content><div>没有标题</div></Content>",
        "<Content><Header /></Content>",
      ]) {
        assert.deepEqual(
          scanSource(sourcePath, `${imports}\nconst view = ${view};`),
          [{ rule: "dialog-title", path: sourcePath, line: 2 }],
        );
      }
      for (const view of [
        "<Content><Header><Title>编辑</Title></Header></Content>",
        "<Content><><Title>编辑</Title></></Content>",
        "<Content><CustomHeader /></Content>",
        "<Content>{children}</Content>",
        "<Content>{show && <Title>编辑</Title>}</Content>",
      ]) {
        assert.deepEqual(
          scanSource(sourcePath, `${imports}\nconst view = ${view};`),
          [],
        );
      }
      assert.deepEqual(
        scanSource(
          sourcePath,
          `import * as Kit from "@/kit"; const view = <Kit.${kind}Content><Kit.${kind}Title>编辑</Kit.${kind}Title></Kit.${kind}Content>;`,
        ),
        [],
      );
    });
  }
});

it("raw-scroll 覆盖 TSX，原生标签与引擎只豁免实现、生成物和测试", async () => {
  const temporary = join(process.cwd(), "Temp/test/check-kit");
  await mkdir(temporary, { recursive: true });
  const fixture = await mkdtemp(join(temporary, "kit-scan-"));
  try {
    const files = {
      "src/modules/view.tsx": "const view = <table />;",
      "src/app/outer.tsx": [
        'import { DialogContent } from "@/kit";',
        "const view = <dialog />;",
        "const wrapped = <DialogContent><CustomHeader /></DialogContent>;",
      ].join("\n"),
      "src/lib/engine.ts": 'import type { X } from "@tanstack/table-core";',
      "src/kit/ui/table.tsx": "const view = <table />;",
      "src/kit/ui/raw.tsx": 'const view = <div className="overflow-auto" />;',
      "src/lib/generated/raw.tsx":
        'const view = <div className="overflow-auto" />;',
      "src/kit/ui/scroll-area.tsx":
        'const view = <div className="overflow-auto" />;',
      "src/lib/generated/engine.ts": 'import { x } from "radix-ui";',
      "src/modules/view.test.tsx": "const view = <select />;",
      "src/modules/scroll.test.tsx":
        'const view = <div className="overflow-auto" />;',
      "src/modules/helper.test.ts": 'import { x } from "radix-ui";',
      "src/modules/readme.md": "<table />",
      "src/app/styles.css": '@import "../kit/styles/index.css";',
      "src/modules/legacy.jsx": "const view = <table />;",
      "outside.tsx": "const view = <table />;",
    };
    for (const [path, text] of Object.entries(files)) {
      const absolute = join(fixture, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, text, "utf8");
    }
    const report = await scan(fixture);
    assert.deepEqual(report.counts, {
      ...zero,
      "native-table": 1,
      "native-dialog": 1,
      "engine-import": 1,
      "raw-scroll": 3,
    });
    assert.deepEqual(
      report.violations.map((item) => item.path),
      [
        "src/app/outer.tsx",
        "src/kit/ui/raw.tsx",
        "src/lib/engine.ts",
        "src/lib/generated/raw.tsx",
        "src/modules/scroll.test.tsx",
        "src/modules/view.tsx",
      ],
    );
    assert.deepEqual(report.manualReviews, [
      { rule: "dialog-title", path: "src/app/outer.tsx", line: 3 },
    ]);
  } finally {
    const actual = await realpath(fixture);
    assert.equal(dirname(actual), await realpath(temporary));
    await rm(actual, { recursive: true });
  }
});

it("check-kit 零基线拒绝任一违规", async () => {
  const temporary = join(process.cwd(), "Temp/test/check-kit");
  await mkdir(temporary, { recursive: true });
  const fixture = await mkdtemp(join(temporary, "kit-zero-"));
  const output = mock.method(console, "log", () => {});
  try {
    await mkdir(join(fixture, "src"));
    await mkdir(join(fixture, "src/shell"));
    const path = join(fixture, "src/shell/view.tsx");
    await writeFile(path, "const view = <div />;", "utf8");
    assert.equal(await checkKit(process.env, fixture), undefined);
    for (const source of [
      "const view = <table />;",
      "const view = <dialog />;",
      "const view = <select />;",
      'import { Button } from "@/kit/ui/button";',
      'import { toast } from "sonner";',
      'window.confirm("删除？");',
      'import { ConfirmDialog as C } from "@/kit"; const view = <C />;',
      'import { SheetContent } from "@/kit"; const view = <SheetContent />;',
      'const view = <div className="overflow-auto" />;',
      'const view = <div className="md:block" />;',
    ]) {
      await writeFile(path, source, "utf8");
      await assert.rejects(
        checkKit(process.env, fixture),
        /Kit 约束要求所有规则为零/,
      );
    }
  } finally {
    output.mock.restore();
    const actual = await realpath(fixture);
    assert.equal(dirname(actual), await realpath(temporary));
    await rm(actual, { recursive: true });
  }
});

it("标题/确认文案未知项独立计数且阻止自动通过，已知标签和标题可以通过", async () => {
  const temporary = join(process.cwd(), "Temp/test/check-kit");
  await mkdir(temporary, { recursive: true });
  const fixture = await mkdtemp(join(temporary, "kit-manual-"));
  const output = mock.method(console, "log", () => {});
  try {
    await mkdir(join(fixture, "src/kit/templates"), { recursive: true });
    const path = join(fixture, "src/kit/templates/form.tsx");
    for (const [rule, source] of [
      [
        "dialog-title",
        'import { DialogContent as C } from "../ui/dialog"; const v = <C><CustomHeader /></C>;',
      ],
      [
        "dialog-title",
        'import { SheetContent as C, SheetTitle as T } from "../ui/sheet"; const v = <C>{show && <T>标题</T>}</C>;',
      ],
      [
        "dialog-title",
        'import { SheetContent as C } from "../ui/sheet"; const v = <C {...props} />;',
      ],
      [
        "confirm-label",
        'import { ConfirmDialog as C } from "../ui/confirm-dialog"; const v = <C confirmLabel={t("delete")} />;',
      ],
      [
        "confirm-label",
        'import { ConfirmDialog as C } from "../ui/confirm-dialog"; const v = <C confirmLabel="删除" {...props} />;',
      ],
    ]) {
      await writeFile(path, source);
      const report = await scan(fixture);
      assert.deepEqual(report.counts, zero);
      assert.deepEqual(report.violations, []);
      assert.deepEqual(report.manualReviews, [
        { rule, path: "src/kit/templates/form.tsx", line: 1 },
      ]);
      await assert.rejects(checkKit(process.env, fixture), /待人工复核/);
    }
    await writeFile(
      path,
      'import { DialogContent as C, DialogTitle as T } from "../ui/dialog"; const v = <C><T>编辑</T></C>;',
    );
    assert.equal(await checkKit(process.env, fixture), undefined);
  } finally {
    output.mock.restore();
    const actual = await realpath(fixture);
    assert.equal(dirname(actual), await realpath(temporary));
    await rm(actual, { recursive: true });
  }
});
