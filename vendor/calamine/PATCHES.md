# Calamine adapter

Source: the crates.io `calamine 0.37.0` release package, upstream
<https://github.com/tafia/calamine>, repository-root commit
`f2c5948242fdfe390e292313a1f87f9db19b9633`.
Published crate SHA-256:
`c9ca341b94bc4b29e08970b1a03914fad2dfe177e2ecb67fcd6de9046004aafb`.
The package hash matches the crates.io sparse-index `cksum`, verified on
2026-11-20, and the recorded commit is the package's `.cargo_vcs_info.json`.
The release was upgraded from 0.36.1 because calamine 0.37.0 moves to `zip`
9; every `zip` 8.x release was yanked upstream for security advisories.

The upstream package uses the single MIT license; no dual-license selection
is needed. `LICENSE-MIT.md` is preserved byte-for-byte, including its
copyright notice. The full text is also in the repository-root
`THIRD_PARTY_NOTICES.md`.

## Patches

1. **Ignore the shared-string allocation hint.** In `read_shared_strings`,
   remove parsing of the file-supplied `uniqueCount` and the corresponding
   `self.strings.reserve(n)`. A malicious declaration can request enormous
   allocations before cells are read and abort the entire process on allocation
   failure. The vector now grows with the actual `<si>` strings. One local
   comment replaces the removed block; the `break` and all other source bytes
   are unchanged.

## Package layout and release comparison

The standalone manifest starts from the normalized published `Cargo.toml`.
It removes example, benchmark and dev-dependency sections, sets
`publish = false`, and adds an empty `[workspace]`. Dependency constraints,
features and other package metadata are unchanged. The root workspace excludes
this directory and consumes it as a path dependency. No transitive lockfile
entries change.

`README.md`, `Changelog.md` and `LICENSE-MIT.md` are retained byte-for-byte;
the changelog is included to preserve the release history.

Reproduce the comparison from the repository root:

```sh
curl -fL -o calamine-0.37.0.crate https://crates.io/api/v1/crates/calamine/0.37.0/download
sha256sum calamine-0.37.0.crate # Must match the SHA-256 above before continuing.
mkdir original && tar -xzf calamine-0.37.0.crate -C original --strip-components=1
git diff --no-index --name-status original vendor/calamine
```

Windows PowerShell equivalent:

```powershell
curl.exe -fL -o calamine-0.37.0.crate https://crates.io/api/v1/crates/calamine/0.37.0/download
if ((Get-FileHash calamine-0.37.0.crate -Algorithm SHA256).Hash -ne "c9ca341b94bc4b29e08970b1a03914fad2dfe177e2ecb67fcd6de9046004aafb") { throw "SHA-256 mismatch" }
New-Item -ItemType Directory original | Out-Null
tar -xzf calamine-0.37.0.crate -C original --strip-components=1
git diff --no-index --name-status original vendor/calamine
```

The command exits 1 because the following intentional differences exist:

- Release-only: `benches/`, `examples/`, `Cargo.lock`, `Cargo.toml.orig`,
  `.cargo_vcs_info.json`, `.gitattributes`, `.github/`, `.gitignore` and
  `.typos.toml`. The last four are upstream development metadata, outside
  the retained source/documentation set.
- Changed: `Cargo.toml` and `src/xlsx/mod.rs` only.
- Vendor-only: this `PATCHES.md`.
- Every other retained file, including every other file under `src/`, is
  byte-for-byte identical to the original release.

## Upgrading

Fetch the new published crate and its sparse-index entry, verify the package
hash and recorded upstream commit, and retain the original files for comparison.
Reapply this same source patch and the manifest-only layout adjustments.
Rerun the host exchange regressions for normal and excessive shared-string
declarations, compare every retained file, and update this provenance and
comparison record. Preserve the license text and update the root notices.
