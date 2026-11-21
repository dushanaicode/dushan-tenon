# 派生指南

把 Dushan Tenon 改成你自己的工具，一般要做三件事：改名、加自己的模块、删掉用不上的模块。本文用一个例子从头走一遍：

- 产品改名为 Example Notes；
- 加一个“备忘”模块：一张表、列表和新建两个命令、一个页面，加上中英文翻译和测试；
- 删掉 demo 模块。

文中每一步都在本仓库的一份副本里实际走过，走完以后 `pnpm check` 和相关测试都通过。

## 开始之前

- 先按 [README](../README.md#4-本地跑起来) 把仓库跑起来：`pnpm install` 和 `pnpm dev` 都正常。
- 用 Git 管理你的派生仓库，每做完一步提交一次。改名脚本要求工作区干净，出了问题可以用 Git 退回。
- 在 PowerShell 里请用 `pnpm.cmd`，例如 `pnpm.cmd check`。
- 手改代码以后，格式不对的地方 `pnpm check` 会报出来。运行 `cargo fmt --all` 和 `pnpm exec biome check --write .` 就能自动修好。

## 1. 先定新身份

身份的唯一来源是 `src-tauri/tauri.conf.json`。改名前先定下面四项：

| 项 | 例子 | 规则 | 用在哪里 |
|---|---|---|---|
| 产品名 | `Example Notes` | 字母、数字、空格、点和连字符，首尾是字母或数字 | 窗口标题、关于页、安装包 |
| 程序名 | `example-notes` | 小写字母开头，由小写字母、数字和单个连字符组成 | exe 文件名、宿主的 Cargo 包名、`package.json` 的 name |
| identifier | `com.example.notes` | 至少两段的小写反向域名 | 系统用它区分应用：安装位置、凭据、开机自启的注册项 |
| 代号 | `notes` | 自动取 identifier 的最后一段，只能有小写字母和数字 | crate 前缀 `notes-*`、环境变量 `NOTES_*`、前端全局变量 `__NOTES_*__`、事件名 `notes:` |

两点提醒：

- 程序发布以后不要再改 identifier。已经安装的程序和它的数据都按 identifier 存放，改了就成了另一个程序。
- 代号会出现在几百处代码里。选一个短而独特的词，不要用 Rust 关键字（例如 `type`、`box`）。

## 2. 改名

### 2.1 运行改名脚本

```powershell
git status
pnpm rename --name "Example Notes" --binary example-notes --identifier com.example.notes
```

`git status` 必须是干净的，否则脚本拒绝运行。脚本做这几件事：

1. 从 `src-tauri/tauri.conf.json` 读出现在的产品名、程序名和 identifier；
2. 在 Git 跟踪的全部文本文件里，一次换掉产品名、identifier、程序名（包括下划线写法，例如 `example_notes_lib`）和代号。代号不分大小写，`tenon`、`Tenon`、`TENON` 分别换成 `notes`、`Notes`、`NOTES`；
3. 文件名里带旧名字的跟着改名，例如 `src-tauri/src/bin/dushan-tenon-cli.rs`；
4. 运行 `cargo update --workspace`、`cargo fmt` 和 Biome。名字的长度变了，Cargo.lock 的顺序和代码的换行也要跟着重排。

图片等二进制文件的内容不会被改动。脚本也会改到这份指南本身，所以改名以后再看这份指南，里面的旧名字已经换成了你的新名字。

### 2.2 手工改的几项

下面这些是写给人看的文字或法律声明，脚本不改：

- **中文名**：用 `git grep -n "渡山榫卯"` 找出来，换成你的中文名。会出现在 `AGENTS.md`、`README.md`、`docs/architecture.md` 和 `src-tauri/Cargo.toml` 的 description 里。
- **版权**：把 `src-tauri/tauri.conf.json` 里的 `bundle.copyright` 改成你的版权。关于页和 exe 属性里显示的就是它。
- **LICENSE**：MIT 许可要求保留原来的版权行 `Copyright (c) 2026 渡山源码`。不要删它，在它下面加一行你自己的版权。
- **仓库地址**：README、CONTRIBUTING、SECURITY（各有中英文两份）和 `.github/ISSUE_TEMPLATE/` 里的 GitHub 地址要换成你的，用 `git grep -n dushanaicode` 可以全部找出来（`scripts/check-structure.mjs` 里那处属于下面的品牌规则）。`.github/workflows/gitee-sync.yml` 是本仓库同步 Gitee 镜像用的，用不上就删掉。
- **贡献和安全说明**：`CONTRIBUTING` 和 `SECURITY` 写的是本仓库的约定，按你自己项目的做法改写。
- **标志和图标**：换掉 `public/brand/logo.svg` 和 `src-tauri/icons/` 里的 5 个文件，文件名和尺寸保持不变。
- **README**：改成介绍你自己产品的内容。
- **品牌规则**：`AGENTS.md` 和 `docs/architecture.md` 里讲“品牌拼音（渡山）”的两段，以及 `scripts/check-structure.mjs` 的 legacy-brand 规则，原本用来防止本仓库的旧品牌残留。改名以后，这条规则还能拦住漏改的旧名字，可以先留着；要改写或删掉，由你决定。

### 2.3 检查

```powershell
pnpm check
pnpm dev
```

`pnpm check` 全部通过，开发窗口的标题是新的产品名，就说明改名完成了。做完提交一次。

## 3. 加一个模块：备忘

下面加一个备忘模块，模块 ID 是 `memo`：

- 一张表 `memo_note`；
- 两个命令：`memo_note_list` 列出当前用户的备忘，`memo_note_create` 新建一条；
- 两个权限：`memo.note.read` 和 `memo.note.write`；
- 一个页面：导航里多一项“备忘”，页面上是新建表单和列表；
- 中英文翻译，以及后端和前端测试。

命名规则：表名、命令名、权限和翻译键都以模块 ID 开头。下面的代码按改名后的代号 `notes` 写，你的代号不同，就把 `notes_`、`notes-` 换成你的。各项合同的完整说明见[模块与装配](modules.md)、[命令与 IPC](ipc.md) 和[数据、任务与恢复](data.md)。

### 3.1 后端：新建 crate

新建目录 `crates/module-memo`。crate 的包名必须是“代号 + `-` + 目录名”，这里是 `notes-module-memo`。

`crates/module-memo/Cargo.toml`：

```toml
[package]
name = "notes-module-memo"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
publish.workspace = true

[dependencies]
notes-framework.workspace = true
sea-query.workspace = true
serde.workspace = true
sqlx.workspace = true
ts-rs.workspace = true

[dev-dependencies]
notes-framework = { workspace = true, features = ["test-support", "migration-tools"] }
tempfile.workspace = true
tokio.workspace = true

[lints]
workspace = true
```

`crates/module-memo/src/lib.rs`：模块声明、数据类型和两个用例。

```rust
//! 备忘模块：当前用户的备忘列表与新建。

pub mod migrations;

use std::{error::Error as _, sync::OnceLock};

use notes_framework::{
    actor::{Actor, ExecutionContext},
    db::{Db, Page, PageRequest},
    error::{AppError, INPUT_INVALID, INTERNAL_UNEXPECTED},
    id::Id,
    module::{Module, ModuleContext, ModuleDeclaration, ModuleFuture},
    time::Timestamp,
};
use sea_query::{Expr, ExprTrait, Order, Query};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

const TABLE: &str = "memo_note";

pub const DECLARATION: ModuleDeclaration = ModuleDeclaration {
    id: "memo",
    version: env!("CARGO_PKG_VERSION"),
    dependencies: &["account"],
    required_capabilities: &[],
    core: false,
    migrations: migrations::MIGRATIONS,
    error_codes: &[],
    permissions: &["memo.note.read", "memo.note.write"],
    dictionaries: &[],
    params: &[],
    file_purposes: &[],
    job_kinds: &[],
    schedules: &[],
    message_keys: &[],
};

#[derive(Debug, Serialize, TS, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MemoNote {
    pub id: Id,
    pub title: String,
    pub content: String,
    pub created_at: Timestamp,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoNoteListInput {
    pub page: u32,
    pub page_size: u32,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MemoNoteCreate {
    pub title: String,
    pub content: String,
}

/// 启动时拿到数据库；模块开关和权限由宿主的统一 IPC 入口检查。
#[derive(Default)]
pub struct MemoService {
    db: OnceLock<Db>,
}

impl Module for MemoService {
    fn declaration(&self) -> &ModuleDeclaration {
        &DECLARATION
    }

    fn start<'a>(&'a self, context: ModuleContext<'a>) -> ModuleFuture<'a> {
        Box::pin(async move {
            self.db
                .set(context.db.clone())
                .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))
        })
    }

    fn stop(&self) -> ModuleFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

impl MemoService {
    pub async fn note_list(
        &self,
        context: &ExecutionContext,
        input: MemoNoteListInput,
    ) -> Result<Page<MemoNote>, AppError> {
        let query = Query::select()
            .columns(["id", "title", "content", "created_at"])
            .from(TABLE)
            .and_where(Expr::col("created_by").eq(owner(context)?))
            .to_owned();
        let request = PageRequest {
            page: input.page,
            page_size: input.page_size,
        };
        self.db()?
            .fetch_page(
                &query,
                request,
                &[("created_at", Order::Desc), ("id", Order::Desc)],
            )
            .await
            .map_err(safe)
    }

    pub async fn note_create(
        &self,
        context: &ExecutionContext,
        input: MemoNoteCreate,
    ) -> Result<MemoNote, AppError> {
        let owner = owner(context)?;
        if !(1..=120).contains(&input.title.chars().count()) || input.title.contains('\0') {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "title"));
        }
        if input.content.chars().count() > 4096 || input.content.contains('\0') {
            return Err(AppError::new(INPUT_INVALID).with_param("path", "content"));
        }
        let note = MemoNote {
            id: Id::new(),
            title: input.title,
            content: input.content,
            created_at: Timestamp::now(),
        };
        self.db()?
            .execute(
                &Query::insert()
                    .into_table(TABLE)
                    .columns(["id", "created_by", "title", "content", "created_at"])
                    .values_panic([
                        note.id.into(),
                        owner.into(),
                        note.title.clone().into(),
                        note.content.clone().into(),
                        note.created_at.into(),
                    ])
                    .to_owned(),
            )
            .await
            .map_err(safe)?;
        Ok(note)
    }

    fn db(&self) -> Result<&Db, AppError> {
        self.db
            .get()
            .ok_or_else(|| AppError::new(INTERNAL_UNEXPECTED))
    }
}

fn owner(context: &ExecutionContext) -> Result<Id, AppError> {
    match context.actor {
        Actor::User(id) => Ok(id),
        Actor::System => Err(AppError::new(INTERNAL_UNEXPECTED)),
    }
}

// 数据库错误的 source 可能带着用户写的内容，不能进运行日志，只保留错误码。
fn safe(error: AppError) -> AppError {
    if error.source().is_some() {
        AppError::new(error.code())
    } else {
        error
    }
}

#[cfg(test)]
mod tests;
```

几点说明：

- 命令的“模块是否启用”和“有没有权限”由宿主统一检查，用例里不用再查。
- 表里记 `created_by`，查询只返回当前用户自己的备忘。
- 输入要自己校验：标题 1 到 120 个字，内容最多 4096 个字，都不能含 NUL 字符。校验失败返回 `app.input.invalid`，`path` 参数指出是哪个字段。

### 3.2 后端：迁移和快照

迁移用 sea-query 定义一次，再由工具生成 SQLite、MySQL、PostgreSQL 三份 SQL 快照。快照生成以后被 `sql-snapshots/lock.json` 锁定，发布后不能再改。表结构要变，就新增一个迁移，见[数据库与迁移](data.md#数据库与迁移)。

`crates/module-memo/src/migrations/memo_note.rs`：

```rust
use notes_framework::db::migrate::{Dialect, create_table};
use sea_query::{ColumnDef, Index, IndexStatement, SchemaStatement, TableStatement};

pub(super) fn statements(dialect: Dialect) -> Vec<SchemaStatement> {
    vec![
        SchemaStatement::TableStatement(TableStatement::Create(
            create_table(dialect, "memo_note")
                .col(ColumnDef::new("id").string_len(36).not_null().primary_key())
                .col(ColumnDef::new("created_by").string_len(36).not_null())
                .col(ColumnDef::new("title").string_len(120).not_null())
                .col(ColumnDef::new("content").text().not_null())
                .col(ColumnDef::new("created_at").big_integer().not_null())
                .to_owned(),
        )),
        SchemaStatement::IndexStatement(IndexStatement::Create(
            Index::create()
                .name("ix_memo_note_created_by_created_at")
                .table("memo_note")
                .col("created_by")
                .col("created_at")
                .to_owned(),
        )),
    ]
}
```

`crates/module-memo/src/migrations/mod.rs`：

```rust
use notes_framework::db::migrate;

mod snapshots;
pub use snapshots::MIGRATIONS;

#[cfg(test)]
mod memo_note;

#[cfg(test)]
fn definitions() -> Vec<migrate::snapshot::Definition> {
    vec![migrate::snapshot::Definition {
        info: migrate::MigrationInfo::new("memo", 1, "create_memo_note"),
        statements: memo_note::statements,
    }]
}

#[cfg(test)]
mod tests;
```

`crates/module-memo/src/migrations/snapshots.rs` 由工具生成。第一次先手写一个空的，好让 crate 能编译：

```rust
// 自动生成，勿手改。运行 pnpm db snapshot 更新。
#[rustfmt::skip]
pub const MIGRATIONS: &[super::migrate::Migration] = &[];
```

`crates/module-memo/src/migrations/tests.rs` 照抄 `crates/module-notify/src/migrations/tests.rs`，只把里面的 `notify-snapshots-` 改成 `memo-snapshots-`。它检查快照和迁移定义是否一致，生成快照也靠它。

### 3.3 后端：测试

`crates/module-memo/src/tests.rs`：

```rust
use super::*;
use notes_framework::db::test_support;

async fn service(test: &test_support::TestDb) -> MemoService {
    let migrations = [
        notes_framework::migrations::MIGRATIONS,
        migrations::MIGRATIONS,
    ]
    .concat();
    test.upgrade(&migrations, 1).await.unwrap();
    let service = MemoService::default();
    service.db.set(test.db.clone()).unwrap();
    service
}

fn create(title: &str) -> MemoNoteCreate {
    MemoNoteCreate {
        title: title.into(),
        content: "内容".into(),
    }
}

fn first_page() -> MemoNoteListInput {
    MemoNoteListInput {
        page: 1,
        page_size: 20,
    }
}

#[tokio::test]
async fn created_notes_are_listed_newest_first_for_their_owner_only() {
    test_support::run(async |test| {
        let service = service(test).await;
        let me = ExecutionContext::new(Actor::User(Id::new()), "trace");
        let other = ExecutionContext::new(Actor::User(Id::new()), "trace");
        let first = service.note_create(&me, create("买牛奶")).await.unwrap();
        let second = service.note_create(&me, create("交房租")).await.unwrap();
        service.note_create(&other, create("别人的")).await.unwrap();
        let page = service.note_list(&me, first_page()).await.unwrap();
        assert_eq!(page.total, 2);
        let ids: Vec<_> = page.items.iter().map(|note| note.id).collect();
        assert_eq!(ids, [second.id, first.id]);
        assert_eq!(page.items[1].title, "买牛奶");
    })
    .await;
}

#[tokio::test]
async fn invalid_title_is_rejected_before_writing() {
    test_support::run(async |test| {
        let service = service(test).await;
        let me = ExecutionContext::new(Actor::User(Id::new()), "trace");
        for title in [String::new(), "长".repeat(121)] {
            let error = service.note_create(&me, create(&title)).await.unwrap_err();
            assert_eq!(error.code(), INPUT_INVALID);
        }
        assert_eq!(service.note_list(&me, first_page()).await.unwrap().total, 0);
    })
    .await;
}
```

### 3.4 后端：登记 crate，生成快照

在根目录 `Cargo.toml` 的 `[workspace.dependencies]` 里加一行：

```toml
notes-module-memo = { path = "crates/module-memo" }
```

在 `src-tauri/Cargo.toml` 的 `[dependencies]` 里加一行：

```toml
notes-module-memo.workspace = true
```

然后依次运行：

```powershell
cargo update --workspace
New-Item -ItemType Directory crates/module-memo/sql-snapshots
pnpm db snapshot
cargo test -p notes-module-memo
```

- `cargo update --workspace` 把新 crate 写进 Cargo.lock。各个 pnpm 命令都带 `--locked`，不先更新会报“lock file needs to be updated”。
- `pnpm db snapshot` 只处理已经有 `sql-snapshots` 目录的 crate，所以要先建一个空目录。运行后会生成三份 SQL、`lock.json` 和新的 `snapshots.rs`。
- `cargo test` 应该看到 3 个测试通过，另有 1 个生成快照的测试被跳过。

### 3.5 宿主：装配和命令

宿主 `src-tauri` 只做装配，不写业务。要改 6 个地方：

**`src-tauri/src/modules.rs`**：声明数组加一项，长度加 1；`registry` 多一个参数，并放进模块列表。

```rust
use notes_module_memo::MemoService;

pub const DECLARATIONS: [&ModuleDeclaration; 6] = [
    // ……原有各项
    &notes_module_memo::DECLARATION,
];

pub fn registry(
    // ……原有参数
    memo: Arc<MemoService>,
    settings: &BTreeMap<String, bool>,
) -> Result<ModuleRegistry, RegistryError> {
    ModuleRegistry::new(
        vec![
            // ……原有各项
            memo,
        ],
        settings,
    )
}
```

**`src-tauri/src/boot.rs`**：创建服务，传给 `modules::registry`，再放进 `Services` 和 `AppState`。

```rust
use notes_module_memo::MemoService;

struct Services {
    // ……
    memo: Arc<MemoService>,
}

// configure_services 里，在读取 enabled 之前：
let memo = Arc::new(MemoService::default());
let registry = modules::registry(
    account.clone(),
    notify.clone(),
    demo.clone(),
    memo.clone(),
    &enabled,
)
.map_err(internal)?;

// 同一个函数末尾构造 Services { ... } 时加上：
            memo,

// RuntimeReady 构造 AppState 时加上：
            memo: services.memo,
```

**`src-tauri/src/state.rs`**：`AppState` 加一个字段。

```rust
use notes_module_memo::MemoService;

pub struct AppState {
    // ……
    pub memo: Arc<MemoService>,
}
```

**`src-tauri/src/data.rs`**：恢复备份时会用新配置重建一次模块列表，`modules::registry(...)` 的调用也要多传 `state.memo.clone()`。不改的话编译不过。

**`src-tauri/src/contract.rs`**：导出命令要用的类型。

```rust
pub use notes_module_memo::{MemoNote, MemoNoteCreate, MemoNoteListInput};
```

**`src-tauri/src/commands/list.rs`**：这是唯一的命令清单。加两行，括号里是调用前要检查的权限：

```rust
[normal] execute("memo.note.read") memo_note_list(MemoNoteListInput) => Page<MemoNote>,
[normal] execute("memo.note.write") memo_note_create(MemoNoteCreate) => MemoNote,
```

每个命令还要一个同名的适配文件，只负责把调用交给模块。

`src-tauri/src/commands/memo_note_list.rs`：

```rust
use super::{AppState, MemoNote, MemoNoteListInput, Page};
use notes_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn memo_note_list(
    state: tauri::State<'_, AppState>,
    input: MemoNoteListInput,
) -> Result<Page<MemoNote>, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(memo_note_list),
        |state| async move { state.memo.note_list(&state.execution, input).await },
    )
    .await
}
```

`src-tauri/src/commands/memo_note_create.rs`：

```rust
use super::{AppState, MemoNote, MemoNoteCreate};
use notes_framework::{error::IpcError, ipc};

#[tauri::command]
pub async fn memo_note_create(
    state: tauri::State<'_, AppState>,
    input: MemoNoteCreate,
) -> Result<MemoNote, IpcError> {
    ipc::execute(
        state.inner(),
        stringify!(memo_note_create),
        |state| async move { state.memo.note_create(&state.execution, input).await },
    )
    .await
}
```

改完运行 `pnpm generate`。它会重新生成前端合同（`src/lib/generated/` 下的 `MemoNote.ts`、`commands.ts`、`permissions.ts` 等）和窗口权限 `src-tauri/capabilities/main.json`。生成物不要手改。

### 3.6 前端：清单、页面和测试

**图标**：导航图标只能用 `src/kit/icons.ts` 里登记过的。在那里从 `lucide-react` 导入 `NotebookPen`，再加一项 `memo: NotebookPen`。

**`src/modules/memo/manifest.ts`**：模块清单，声明导航和路由。

```ts
import type { ModuleManifest } from "@/core/contracts/module";

export const memoManifest: ModuleManifest = {
  id: "memo",
  basePath: "/memo",
  nav: [
    {
      kind: "leaf",
      id: "memo",
      path: "/memo",
      label: "memo.title",
      iconId: "memo",
      permission: "memo.note.read",
    },
  ],
  routes: [
    {
      path: "/memo",
      permission: "memo.note.read",
      Component: () =>
        import("./memo-page").then((m) => ({ default: m.MemoPage })),
    },
  ],
  devPages: [],
  settings: [],
  headerWidgets: [],
  workbenchObjects: [],
  workbenchPanels: [],
  fileTargets: [],
};
```

**`src/modules/memo/memo-page.tsx`**：页面。命令用 `@/lib/generated/commands` 里生成的函数调用。

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, Input, Label, PageHeader, Textarea } from "@/kit";
import { memoNoteCreate, memoNoteList } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { MemoNote } from "@/lib/generated/MemoNote";
import type { Page } from "@/lib/generated/Page";

const listKey = ["memo", "notes"];

export function MemoPage() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const list = useQuery<Page<MemoNote>, IpcError>({
    queryKey: listKey,
    queryFn: () => memoNoteList({ page: 1, pageSize: 50 }),
  });
  const create = useMutation<MemoNote, IpcError>({
    mutationFn: () => memoNoteCreate({ title, content }),
    onSuccess: () => {
      setTitle("");
      setContent("");
      return client.invalidateQueries({ queryKey: listKey });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <section className="mx-auto max-w-3xl space-y-6 py-10">
      <PageHeader title={t("memo.title")} />
      <form className="space-y-3" onSubmit={submit}>
        <div className="space-y-1">
          <Label htmlFor="memo-title">{t("memo.form.title")}</Label>
          <Input
            id="memo-title"
            value={title}
            maxLength={120}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="memo-content">{t("memo.form.content")}</Label>
          <Textarea
            id="memo-content"
            value={content}
            maxLength={4096}
            onChange={(event) => setContent(event.target.value)}
          />
        </div>
        {create.error && <IpcErrorMessage error={create.error} />}
        <Button type="submit" disabled={create.isPending}>
          {t("memo.form.submit")}
        </Button>
      </form>
      {list.isPending && <p role="status">{t("memo.loading")}</p>}
      {list.error && <IpcErrorMessage error={list.error} />}
      {list.data?.items.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("memo.empty")}</p>
      )}
      {list.data && list.data.items.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {list.data.items.map((note) => (
            <li key={note.id} className="space-y-1 p-4">
              <p className="font-medium">{note.title}</p>
              {note.content && (
                <p className="whitespace-pre-wrap text-sm">{note.content}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {new Date(note.createdAt).toLocaleString(i18n.language)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

为了让例子短一些，页面只显示最新的 50 条。真实的列表页可以用 kit 里的 `ListPage` 模板和 `Pagination` 分页。

**`src/modules/memo/memo-page.test.tsx`**：用假的 IPC 测页面。

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { queryWrapper } from "@/core/core.test-support";
import type { MemoNote } from "@/lib/generated/MemoNote";
import { mockIpc } from "@/lib/ipc/ipc.test-support";
import { MemoPage } from "./memo-page";

const note: MemoNote = {
  id: "note-1",
  title: "买牛奶",
  content: "两盒",
  createdAt: "2026-11-20T08:00:00.000Z",
};

function renderPage(notes: MemoNote[]) {
  const calls = mockIpc((command) => {
    if (command === "memo_note_list")
      return { items: notes, total: notes.length, page: 1, pageSize: 50 };
    if (command === "memo_note_create") return note;
    return null;
  });
  const { client } = queryWrapper();
  render(
    <QueryClientProvider client={client}>
      <MemoPage />
    </QueryClientProvider>,
  );
  return calls;
}

test("备忘页列出备忘", async () => {
  renderPage([note]);
  expect(await screen.findByText("买牛奶")).toBeTruthy();
  expect(screen.getByText("两盒")).toBeTruthy();
});

test("提交表单会调用新建命令并刷新列表", async () => {
  const calls = renderPage([]);
  expect(await screen.findByText("还没有备忘。")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "交房租" },
  });
  fireEvent.change(screen.getByLabelText("内容"), {
    target: { value: "月底前" },
  });
  fireEvent.click(screen.getByRole("button", { name: "新建" }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith("memo_note_create", {
      input: { title: "交房租", content: "月底前" },
    }),
  );
  await waitFor(() =>
    expect(
      calls.mock.calls.filter(([command]) => command === "memo_note_list"),
    ).toHaveLength(2),
  );
});
```

**`src/app/module-registry.ts`**：这是前端唯一的模块注册表。导入 `memoManifest`，加到数组最后。

**翻译**：在 `src/core/i18n/zh-CN.json` 和 `en-US.json` 里各加 9 个键。`pnpm check` 会检查两种语言的键是否齐全。

| 键 | 中文 | English |
|---|---|---|
| `modules.names.memo` | 备忘 | Memo |
| `permissions.memo.note.read` | 读取本人备忘 | Read own memos |
| `permissions.memo.note.write` | 新建本人备忘 | Create own memos |
| `memo.title` | 备忘 | Memo |
| `memo.form.title` | 标题 | Title |
| `memo.form.content` | 内容 | Content |
| `memo.form.submit` | 新建 | Create |
| `memo.loading` | 正在加载备忘…… | Loading memos… |
| `memo.empty` | 还没有备忘。 | No memos yet. |

### 3.7 预设

三个预设都要写上每个模块的开关，否则 `pnpm check` 不通过。在 `presets/minimal.toml`、`tool.toml` 和 `full.toml` 的 `[modules.demo]` 后面各加一段，本例只在 full 预设里启用：

```toml
[modules.memo]
enabled = true
```

minimal 和 tool 里写 `enabled = false`。改完再运行一次 `pnpm generate`，它会更新生成的预设目录。

### 3.8 更新写死模块列表的测试

有几个测试把模块列表写死了，用来防止漏装或多装模块。加了模块就要跟着改：

- `scripts/preset.test.mjs`：`modules` 数组和预设分节列表里加上 `memo`，顺序和预设文件一致；
- `src/app/module-registry.test.ts`：`ids` 数组加上 `memo`；
- `src/app/app.test.tsx`：首页导航的链接列表加上 `/memo`。模块没有导航项就不用改；
- `crates/desktop/src/config/tests/settings.rs`：full 预设启用的模块列表加上 `memo`，按字母顺序。

如果新模块在 tool 预设里也启用，还要改 `src-tauri/src/ipc_tests/preset_matrix.rs` 里 tool 预设的模块列表。

### 3.9 检查

```powershell
pnpm check
pnpm test
pnpm dev
```

`pnpm check` 和 `pnpm test` 都通过以后，在开发窗口里应该能看到导航里的“备忘”，能新建备忘，新建的会出现在列表最上面。做完提交一次。

## 4. 删一个模块：demo

只是不想用某个模块的话，不用删代码，在 `config.toml` 里关掉就行：

```toml
[modules.demo]
enabled = false
```

想让代码更干净、安装包更小，再物理删除。通用步骤见[模块与装配](modules.md#物理裁剪一个模块)，下面是 demo 的完整清单。底座的其他测试都不依赖 demo；离不开 demo 的测试放在 demo 自己的文件里，随 demo 一起删。

如果你用开着 demo 的程序跑过，状态目录的数据库里已经有 demo 的迁移记录。删掉 demo 以后，程序会把它们当成未知迁移而拒绝启动。开发时删掉 `Temp/dev-state` 重新开始就行；已经有真实数据的，先看[迁移合同](data.md#数据库与迁移)。

### 4.1 删掉 demo 的文件

```powershell
git rm -r -q crates/module-demo src/modules/demo "src-tauri/src/commands/demo_*.rs" src-tauri/src/exchange.rs src-tauri/src/exchange src-tauri/src/ipc_tests/demo.rs src-tauri/src/ipc_tests/job_watch.rs scripts/check-showcase.mjs scripts/check-showcase.test.mjs
```

| 路径 | 是什么 |
|---|---|
| `crates/module-demo` | 后端模块 |
| `src/modules/demo` | 前端模块，演示中心也在里面 |
| `src-tauri/src/commands/demo_*.rs` | 17 个命令适配 |
| `src-tauri/src/exchange.rs`、`src-tauri/src/exchange/` | 宿主为 demo 的导入导出提供的任务处理器 |
| `src-tauri/src/ipc_tests/demo.rs` | demo 在宿主上的测试 |
| `src-tauri/src/ipc_tests/job_watch.rs` | 任务观察的测试。底座里只有 demo 声明了任务种类，这组测试排的是 demo 的任务。你的模块有了任务以后，可以从底座仓库找回这个文件，换成自己的任务种类 |
| `scripts/check-showcase.mjs`、`scripts/check-showcase.test.mjs` | 演示中心的检查 |

### 4.2 去掉登记 demo 的地方

宿主 `src-tauri/src/` 下：

- `modules.rs`：声明数组去掉 demo，长度减 1；`registry` 去掉 `demo` 参数和列表项，以及 `DemoService` 的导入；
- `boot.rs`：去掉 `DemoService`、`DemoPreferences` 的导入，`Services` 里的 `demo` 字段，创建 `DemoService` 的那段代码，传给 `modules::registry` 的 `demo.clone()`，以及构造 `Services` 和 `AppState` 时的 `demo`；任务处理器那句 `.freeze(exchange::handlers(...))` 改成 `.freeze(Vec::new())`，`use crate::{...}` 里去掉 `exchange`；
- `state.rs`：去掉 `demo` 字段和 `DemoService` 的导入；
- `data.rs`：`modules::registry(...)` 去掉 `state.demo.clone()`；
- `main.rs`：去掉 `pub mod exchange;`；
- `commands/list.rs`：去掉所有 `demo_` 开头的命令；
- `contract.rs`：去掉 `pub use notes_module_demo::{...}`，以及 `DemoAttachmentAdd`、`DemoAttachmentSave`、`DemoExportInput`、`DemoImportInput` 四个结构体；
- `ipc_tests.rs`：去掉 `mod demo;` 和 `mod job_watch;`。

其他地方：

- 根目录 `Cargo.toml` 和 `src-tauri/Cargo.toml` 去掉 `notes-module-demo`，然后运行 `cargo update --workspace`；
- `src/app/module-registry.ts`：去掉 `demoManifest` 的导入和数组项；
- 三个预设 `presets/*.toml` 去掉 `[modules.demo]` 那一段；
- `scripts/check.mjs` 去掉 `checkShowcase` 的导入和调用，`scripts/test.mjs` 去掉 `scripts/check-showcase.test.mjs`；
- 运行 `pnpm generate`。它会重新生成命令、权限、窗口权限，并删掉 `src/lib/generated/` 下 demo 的类型文件。

### 4.3 更新写死模块列表的测试

和 3.8 节是同几处，把 `demo` 去掉：

- `scripts/preset.test.mjs`：`modules` 数组和预设分节列表；
- `src/app/module-registry.test.ts`：`ids` 数组；
- `crates/desktop/src/config/tests/settings.rs`：full 预设启用的模块列表；
- `src/app/preset-matrix.test.tsx`：判断是否显示“开发”导航组的那个条件，去掉 `enabled.has("demo")`。

### 4.4 翻译和文档

demo 的翻译在 `src/core/i18n/zh-CN.json` 和 `en-US.json` 里，一共几百条：键名里有 `demo` 这一段的（例如 `demo.title`、`modules.names.demo`、`permissions.demo.sample.read`），以及演示中心的 `showcase.*`。用下面的命令一次删掉：

```powershell
@'
import { readFileSync, writeFileSync } from "node:fs";
for (const file of ["src/core/i18n/zh-CN.json", "src/core/i18n/en-US.json"]) {
  const keys = JSON.parse(readFileSync(file, "utf8"));
  for (const key of Object.keys(keys)) {
    if (/(^|\.)demo(\.|$)/.test(key) || key.startsWith("showcase.")) delete keys[key];
  }
  writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`);
}
'@ | node --input-type=module
```

`pnpm check` 只检查缺少的翻译，不检查多余的。这一步漏了不会报错，但用不上的文字会打进安装包。

`docs/` 下有几处拿 demo 当例子，链接指向的文件已经删了。用 `git grep -n -i demo -- docs` 找出来，删掉或换成你自己模块的例子。

### 4.5 检查

```powershell
cargo fmt --all
pnpm exec biome check --write .
pnpm check
pnpm test
git grep -n -i demo -- ":!*.md" ":!pnpm-lock.yaml"
```

前两条命令重排格式：删掉 demo 以后，`boot.rs` 等处的代码变短了，换行要跟着调整。`pnpm check` 和 `pnpm test` 都通过，最后一条命令什么也找不到，就删干净了。`pnpm-lock.yaml` 里的校验值碰巧含有这几个字母，与 demo 无关，所以排除。然后删掉 `Temp/dev-state` 再运行 `pnpm dev`，确认程序能正常打开、剩下的模块都能用。做完提交一次。

## 5. 最后检查

1. 运行 `pnpm check` 和 `pnpm test`，全部通过。
2. 删掉 `Temp/dev-state`，再运行 `pnpm dev`。没有配置文件时，所有模块都启用，也不需要登录。
3. 在窗口里确认：
   - 标题栏是新的产品名；
   - 导航里有“备忘”，能新建，新建的备忘出现在列表最上面；
   - “设置 → 关于”的版本下面显示你的版权。
4. 要打安装包，见[安装包构建与发布](release.md)。
