# Contributing

[中文](CONTRIBUTING.md)

Thank you for taking part in Dushan Tenon. One person maintains this project, and the conventions below are meant to keep your time from going to waste.

## Feedback

- Please file issues and suggestions on GitHub: <https://github.com/dushanaicode/dushan-tenon/issues>. The Gitee repository is a read-only mirror, so please send all issues and pull requests to GitHub.
- When reporting a bug, include your Windows version and the steps to reproduce, and attach the text from "Settings → About → Copy diagnostic information". The diagnostic text is redacted and contains no paths or account names.
- Do not report security issues in a public issue. Report them privately as described in the [security policy](SECURITY.en.md).

## Before opening a pull request

- Typos, documentation fixes and obvious bugs: open a pull request directly.
- New features or larger changes: open an issue first to describe the idea, and start once we agree on it.
- Keep each pull request to one change.

## Running it locally

See [README section 4](README.en.md#4-run-it-locally) for the requirements and the first launch. In short, run this in the repository root:

```powershell
pnpm install
pnpm dev
```

In PowerShell, use `pnpm.cmd`.

## Checks before committing

```powershell
pnpm check
pnpm test
```

- `pnpm check` checks formatting, lint, types, the layer structure and the generated contracts; `pnpm test` runs all Rust, frontend and script unit tests.
- For a small change, run the related tests first, for example `pnpm test web:src/modules/notify` or `pnpm test rust:ipc_tests`, then run both commands in full before opening the pull request.
- To fix formatting, run `cargo fmt --all` and `pnpm exec biome check --write .`.
- CI runs the same two commands on Windows for every pull request.

## Commit messages

Follow the existing format: `type(scope): one line`, for example `fix(account-ui): one centred card layout for every auth screen`.

- Types are `feat`, `fix`, `docs`, `test` and `refactor`. The scope is the module or directory you changed, and can be left out.
- If needed, add a body after a blank line that says why and what changed.
- English or Chinese are both fine.

## Code rules

The full rules are in [AGENTS.md](AGENTS.md) and [docs/](docs/) (in Chinese). The ones you will meet most often:

- Make the smallest change that meets the need and follow the existing patterns. Do not add compatibility layers, aliases for old names or abstractions nothing uses.
- Dependencies point one way: on the frontend lib → kit → core → visual / shell / modules → app, and modules never import each other. See the [architecture](docs/architecture.md).
- New dependencies must have a permissive license and have been published for at least 14 days. Describe what they are for in an issue first. Direct npm dependencies use exact versions.
- Credentials, runtime data and private keys must never go into code, commits or logs.

## License

Your contributions are released under this repository's [MIT license](LICENSE). By opening a pull request you agree to this and confirm that you have the right to submit the work.
