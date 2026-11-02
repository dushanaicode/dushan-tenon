use std::{fs, path::Path};

use super::{definitions, migrate};

fn assert_same_files(expected: &Path, actual: &Path) {
    let names = |directory: &Path| {
        let mut names: Vec<_> = fs::read_dir(directory)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        names.sort();
        names
    };
    let expected_names = names(expected);
    assert_eq!(expected_names, names(actual));
    for name in expected_names {
        let expected = expected.join(&name);
        let actual = actual.join(name);
        if expected.is_dir() {
            assert_same_files(&expected, &actual);
        } else {
            assert_eq!(
                fs::read(&expected).unwrap(),
                fs::read(actual).unwrap(),
                "{}",
                expected.display()
            );
        }
    }
}

#[test]
fn sql_snapshots_match_definitions() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let generated = tempfile::Builder::new()
        .prefix("notify-snapshots-")
        .tempdir_in(std::env::temp_dir())
        .unwrap();
    migrate::snapshot::generate(generated.path(), &definitions()).unwrap();
    assert_same_files(
        &root.join("sql-snapshots"),
        &generated.path().join("sql-snapshots"),
    );
    assert_eq!(
        fs::read(root.join("src/migrations/snapshots.rs")).unwrap(),
        fs::read(generated.path().join("src/migrations/snapshots.rs")).unwrap()
    );
}

#[test]
#[ignore = "仅新增迁移时运行 pnpm db snapshot；不重写已锁定 SQL"]
fn generate_sql_snapshots() {
    migrate::snapshot::generate(Path::new(env!("CARGO_MANIFEST_DIR")), &definitions()).unwrap();
}
