# Calamine adapter

Source: the crates.io `calamine 0.36.1` release package, upstream
<https://github.com/tafia/calamine>, repository-root commit
`0a24c2a9f1e38c0932c1299e633270dc730db505`.
Published crate SHA-256:
`5fa68281b1a76b54a62156474adb06bb380a67e07dd60656e3217152b42183f3`.
The package hash matches the crates.io sparse-index `cksum`, verified on
2026-10-20. The extracted release files were also compared byte-for-byte
with the local registry cache; only the cache's `.cargo-ok` marker is extra.

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
curl -fL -o calamine-0.36.1.crate https://crates.io/api/v1/crates/calamine/0.36.1/download
sha256sum calamine-0.36.1.crate # Must match the SHA-256 above before continuing.
mkdir original && tar -xzf calamine-0.36.1.crate -C original --strip-components=1
git diff --no-index --name-status original vendor/calamine
```

Windows PowerShell equivalent:

```powershell
curl.exe -fL -o calamine-0.36.1.crate https://crates.io/api/v1/crates/calamine/0.36.1/download
if ((Get-FileHash calamine-0.36.1.crate -Algorithm SHA256).Hash -ne "5fa68281b1a76b54a62156474adb06bb380a67e07dd60656e3217152b42183f3") { throw "SHA-256 mismatch" }
New-Item -ItemType Directory original | Out-Null
tar -xzf calamine-0.36.1.crate -C original --strip-components=1
git diff --no-index --name-status original vendor/calamine
```

The command exits 1 because the following intentional differences exist:

- Release-only: `benches/`, `examples/`, `Cargo.lock`, `Cargo.toml.orig`,
  `.cargo_vcs_info.json`, `.github/`, `.gitignore` and `.typos.toml`.
  The last three are upstream development metadata, outside the retained
  source/documentation set.
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
