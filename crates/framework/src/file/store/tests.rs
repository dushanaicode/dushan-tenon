use super::*;
use crate::db::{
    PageRequest,
    test_support::{self, TestDb},
};

const PURPOSES: &[FilePurposeDeclaration] = &[
    FilePurposeDeclaration {
        code: "test.attachment",
        extensions: KNOWN_EXTENSIONS,
    },
    FilePurposeDeclaration {
        code: "test.text",
        extensions: &["txt"],
    },
];
fn actor() -> ExecutionContext {
    ExecutionContext::new(Actor::User(Id::new()), "file-test")
}
async fn setup(test: &TestDb, max_mib: u64) -> FileStore {
    test.upgrade(crate::migrations::MIGRATIONS, 1)
        .await
        .unwrap();
    crate::file::test_support::file_store(test, max_mib, PURPOSES).unwrap()
}
fn input(page: u32, page_size: u32, purpose: Option<&str>, keyword: Option<&str>) -> FileListInput {
    FileListInput {
        pagination: PageRequest { page, page_size },
        purpose: purpose.map(str::to_owned),
        keyword: keyword.map(str::to_owned),
    }
}
fn source(test: &TestDb, name: &str, bytes: &[u8]) -> PathBuf {
    let path = test.root.path().join(name);
    fs::write(&path, bytes).unwrap();
    path
}
async fn add(store: &FileStore, test: &TestDb, name: &str, bytes: &[u8]) -> FileRecord {
    store
        .add(&actor(), "test.attachment", &source(test, name, bytes))
        .await
        .unwrap()
}

#[tokio::test]
async fn metadata_hash_layout_listing_filters_pagination_and_instance_isolation() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let who = actor();
        let a = store
            .add(&who, "test.text", &source(test, "a%_!.TXT", b"abc"))
            .await
            .unwrap();
        assert_eq!(a.extension, "txt");
        assert_eq!(a.original_name, "a%_!.TXT");
        assert_eq!(a.size_bytes, 3);
        assert_eq!(
            a.sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(a.stored_path, relative(a.id, a.created_at).unwrap());
        assert_eq!(a.row_version, 1);
        assert_eq!(who.actor, Actor::User(a.created_by));
        assert_eq!(fs::read(store.path(&a).unwrap()).unwrap(), b"abc");
        let b = add(&store, test, "b.txt", b"second").await;
        // 固定相同时间，验证 ID 决胜排序；两者处于相同 UTC 月。
        test.db
            .execute(
                &Query::update()
                    .table(TABLE.name)
                    .value("created_at", a.created_at)
                    .and_where(Expr::col("id").eq(b.id))
                    .to_owned(),
            )
            .await
            .unwrap();
        let page = store.list(input(1, 1, None, None)).await.unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.items[0].id, b.id);
        assert_eq!(
            store.list(input(2, 1, None, None)).await.unwrap().items[0].id,
            a.id
        );
        assert_eq!(
            store
                .list(input(1, 20, Some("test.text"), Some("%_!")))
                .await
                .unwrap()
                .items[0]
                .id,
            a.id
        );
        assert_eq!(
            store
                .list(input(1, 20, Some("test.attachment"), Some("%")))
                .await
                .unwrap()
                .total,
            0
        );
        fs::remove_file(store.path(&a).unwrap()).unwrap();
        assert!(
            store
                .list(input(1, 20, Some("test.text"), None))
                .await
                .unwrap()
                .items[0]
                .missing
        );
        assert_eq!(
            store
                .list(input(0, 20, None, None))
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        let other_root = test.root.path().join("other");
        fs::create_dir(&other_root).unwrap();
        let other = FileStore::new(
            test.db.clone(),
            &other_root,
            InstanceId::load_or_create(&other_root).unwrap(),
            DEFAULT_MAX_MIB,
            PURPOSES,
        );
        assert_eq!(other.list(input(1, 20, None, None)).await.unwrap().total, 0);
        for id in [a.id, b.id, Id::new()] {
            assert_eq!(other.get(id).await.unwrap_err().code(), DATA_NOT_FOUND);
            assert_eq!(other.preview(id).await.unwrap_err().code(), DATA_NOT_FOUND);
            assert_eq!(
                other.delete(id, 1).await.unwrap_err().code(),
                DATA_NOT_FOUND
            );
            assert_eq!(
                other
                    .save_copy(id, &other_root.join("out.txt"))
                    .await
                    .unwrap_err()
                    .code(),
                DATA_NOT_FOUND
            );
        }
    })
    .await;
}

#[tokio::test]
async fn add_validates_names_types_content_and_live_size_parameter() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let who = actor();
        assert_eq!(
            store
                .add(&who, "unknown", Path::new("x.txt"))
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        for name in [
            "bad\n.txt".to_owned(),
            format!("{}.txt", "x".repeat(256)),
            "no-extension".into(),
            "empty.".into(),
        ] {
            let error = store
                .add(&who, "test.text", &test.root.path().join(name))
                .await
                .unwrap_err();
            assert_eq!(error.code(), INPUT_INVALID);
            assert_eq!(error.params["path"], "file");
        }
        assert_eq!(
            store
                .add(&who, "test.text", Path::new("file.png"))
                .await
                .unwrap_err()
                .code(),
            TYPE_NOT_ALLOWED
        );
        for (ext, good) in [
            ("png", b"\x89PNG\r\n\x1a\n".as_slice()),
            ("jpg", b"\xff\xd8\xff"),
            ("jpeg", b"\xff\xd8\xff"),
            ("gif", b"GIF89a"),
            ("webp", b"RIFF1234WEBP"),
            ("pdf", b"%PDF-"),
            ("xlsx", b"PK\x03\x04"),
            ("txt", b"abc"),
            ("md", b"# a"),
            ("csv", b"a,b"),
            ("json", b"{}"),
        ] {
            add(&store, test, &format!("good.{ext}"), good).await;
            assert_eq!(
                store
                    .add(
                        &who,
                        "test.attachment",
                        &source(test, &format!("bad.{ext}"), b"\xff\x00")
                    )
                    .await
                    .unwrap_err()
                    .code(),
                CONTENT_MISMATCH
            );
        }
        add(&store, test, "empty.txt", b"").await;
        let store = setup(test, 1).await;
        let exact = source(test, "exact.txt", &vec![b'x'; MIB as usize]);
        assert_eq!(
            store
                .add(&who, "test.text", &exact)
                .await
                .unwrap()
                .size_bytes,
            MIB as i64
        );
        let big = source(test, "big.txt", &vec![b'x'; MIB as usize + 1]);
        let error = store.add(&who, "test.text", &big).await.unwrap_err();
        assert_eq!(error.code(), TOO_LARGE);
        assert_eq!(error.params["max"], "1");
        assert_eq!(fs::read_dir(store.0.root.join("tmp")).unwrap().count(), 0);
    })
    .await;
}

#[tokio::test]
async fn growing_source_is_limited_during_copy_and_partial_is_removed() {
    // Read 在元数据检查后增长实际文件，确定性验证复制循环，而不依赖线程竞态。
    struct Growing {
        file: File,
        path: PathBuf,
        grown: bool,
    }
    impl Read for Growing {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            if !self.grown {
                OpenOptions::new()
                    .append(true)
                    .open(&self.path)?
                    .write_all(&vec![b'x'; MIB as usize])?;
                self.grown = true;
            }
            self.file.read(buffer)
        }
    }
    test_support::run(async |test| {
        let store = setup(test, 1).await;
        let path = test.root.path().join("source.txt");
        fs::write(&path, b"a").unwrap();
        let mut source = Growing {
            file: File::open(&path).unwrap(),
            path,
            grown: false,
        };
        assert_eq!(source.file.metadata().unwrap().len(), 1);
        let partial = test.root.path().join("file.part");
        {
            let output = File::create(&partial).unwrap();
            let _guard = PartialFile(partial.clone());
            assert_eq!(
                copy_limited(
                    &mut source,
                    output,
                    store.0.max_mib,
                    &CancellationToken::new()
                )
                .unwrap_err()
                .code(),
                TOO_LARGE
            );
        }
        assert!(!partial.exists());
    })
    .await;
}

#[tokio::test]
async fn insert_failure_cleans_renamed_file() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        test.raw("DROP TABLE fw_file").await;
        assert!(
            store
                .add(&actor(), "test.text", &source(test, "a.txt", b"a"))
                .await
                .is_err()
        );
        let today = relative(Id::new(), Timestamp::now()).unwrap();
        let parent = Path::new(&today).parent().unwrap();
        assert_eq!(fs::read_dir(store.0.root.join(parent)).unwrap().count(), 0);
        assert_eq!(fs::read_dir(store.0.root.join("tmp")).unwrap().count(), 0);
    })
    .await;
}

#[tokio::test]
async fn previews_are_bounded_utf8_and_handle_missing_and_unsupported() {
    test_support::run(async |test| {
        let store=setup(test, DEFAULT_MAX_MIB).await;
        let image=add(&store,test,"a.png",b"\x89PNG\r\n\x1a\n").await;
        match store.preview(image.id).await.unwrap() { FilePreview::Image{mime,data_url} => {assert_eq!(mime,"image/png");assert_eq!(data_url,"data:image/png;base64,iVBORw0KGgo=");}, _=>panic!("image") }
        let mut bytes=vec![b'a'; HEAD_BYTES-1]; bytes.extend_from_slice("中尾".as_bytes());
        let text=add(&store,test,"long.txt",&bytes).await;
        match store.preview(text.id).await.unwrap() { FilePreview::Text{text,truncated}=>{assert!(truncated); assert_eq!(text.len(),HEAD_BYTES-1);},_=>panic!("text") }
        let text=add(&store,test,"short.md","中文".as_bytes()).await;
        assert!(matches!(store.preview(text.id).await.unwrap(),FilePreview::Text{text,truncated:false} if text=="中文"));
        let mut big=vec![0;5*MIB as usize+1]; big[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let big=add(&store,test,"big.png",&big).await; assert_eq!(store.preview(big.id).await.unwrap_err().code(),PREVIEW_TOO_LARGE);
        for (name,bytes) in [("a.pdf",b"%PDF-".as_slice()),("a.xlsx",b"PK\x03\x04")] {
            let record=add(&store,test,name,bytes).await; assert_eq!(store.preview(record.id).await.unwrap_err().code(),PREVIEW_UNSUPPORTED);
            fs::remove_file(store.path(&record).unwrap()).unwrap(); assert_eq!(store.preview(record.id).await.unwrap_err().code(),MISSING);
        }
        fs::remove_file(store.path(&image).unwrap()).unwrap(); assert_eq!(store.preview(image.id).await.unwrap_err().code(),MISSING);
    }).await;
}

#[tokio::test]
async fn text_pages_preserve_utf8_and_reject_changed_files_and_bad_cursors() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let mut bytes = vec![b'a'; HEAD_BYTES - 1];
        bytes.extend_from_slice("中尾\nsecond page".as_bytes());
        let record = add(&store, test, "paged.txt", &bytes).await;
        let first = store
            .text_page(FileTextPageInput {
                id: record.id,
                offset: 0,
                fingerprint: None,
            })
            .await
            .unwrap();
        assert_eq!(first.text.len(), HEAD_BYTES - 1);
        assert_eq!(first.total_bytes, bytes.len() as u64);
        let next = first.next_offset.unwrap();
        let last = store
            .text_page(FileTextPageInput {
                id: record.id,
                offset: next,
                fingerprint: Some(first.fingerprint.clone()),
            })
            .await
            .unwrap();
        assert_eq!(last.text, "中尾\nsecond page");
        assert_eq!(last.next_offset, None);
        assert_eq!(
            [first.text.as_bytes(), last.text.as_bytes()].concat(),
            bytes
        );
        assert_eq!(
            store
                .text_page(FileTextPageInput {
                    id: record.id,
                    offset: next,
                    fingerprint: None
                })
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        assert_eq!(
            store
                .text_page(FileTextPageInput {
                    id: record.id,
                    offset: next + 1,
                    fingerprint: Some(first.fingerprint.clone())
                })
                .await
                .unwrap_err()
                .code(),
            CONTENT_MISMATCH
        );
        assert_eq!(
            store
                .text_page(FileTextPageInput {
                    id: record.id,
                    offset: bytes.len() as u64 + 1,
                    fingerprint: Some(first.fingerprint.clone())
                })
                .await
                .unwrap_err()
                .code(),
            INPUT_INVALID
        );
        let path = store.path(&record).unwrap();
        let modified = fs::metadata(&path).unwrap().modified().unwrap() + Duration::from_secs(1);
        let mut changed = bytes.clone();
        changed[0] = b'b';
        fs::write(&path, changed).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(fs::FileTimes::new().set_modified(modified))
            .unwrap();
        assert_eq!(
            store
                .text_page(FileTextPageInput {
                    id: record.id,
                    offset: next,
                    fingerprint: Some(first.fingerprint)
                })
                .await
                .unwrap_err()
                .code(),
            DATA_VERSION_CONFLICT
        );
        fs::remove_file(&path).unwrap();
        assert_eq!(
            store
                .text_page(FileTextPageInput {
                    id: record.id,
                    offset: 0,
                    fingerprint: None
                })
                .await
                .unwrap_err()
                .code(),
            MISSING
        );
        let empty = add(&store, test, "empty.txt", b"").await;
        let page = store
            .text_page(FileTextPageInput {
                id: empty.id,
                offset: 0,
                fingerprint: None,
            })
            .await
            .unwrap();
        assert_eq!(page.text, "");
        assert_eq!(page.next_offset, None);
        let image = add(&store, test, "img.png", b"\x89PNG\r\n\x1a\n").await;
        assert_eq!(
            store
                .text_page(FileTextPageInput {
                    id: image.id,
                    offset: 0,
                    fingerprint: None
                })
                .await
                .unwrap_err()
                .code(),
            PREVIEW_UNSUPPORTED
        );
    })
    .await;
}

#[tokio::test]
async fn save_copy_overwrites_and_failure_leaves_no_partial() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let record = add(&store, test, "a.txt", b"saved").await;
        let dest = source(test, "out.TXT", b"old");
        store.save_copy(record.id, &dest).await.unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"saved");
        assert_eq!(
            store
                .save_copy(record.id, &test.root.path().join("out.pdf"))
                .await
                .unwrap_err()
                .code(),
            TYPE_NOT_ALLOWED
        );
        let blocked = test.root.path().join("directory.txt");
        fs::create_dir(&blocked).unwrap();
        assert!(store.save_copy(record.id, &blocked).await.is_err());
        assert!(
            !test
                .root
                .path()
                .join(format!("directory.txt.{}.partial", record.id))
                .exists()
        );
        assert!(
            store
                .save_copy(record.id, &test.root.path().join("absent/out.txt"))
                .await
                .is_err()
        );
        fs::remove_file(store.path(&record).unwrap()).unwrap();
        assert_eq!(
            store.save_copy(record.id, &dest).await.unwrap_err().code(),
            MISSING
        );
        assert_eq!(fs::read(dest).unwrap(), b"saved");
    })
    .await;
}

#[tokio::test]
async fn deletion_checks_versions_commits_before_io_and_tolerates_missing_or_io_failure() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let record = add(&store, test, "a.txt", b"data").await;
        let path = store.path(&record).unwrap();
        assert_eq!(
            store.delete(record.id, 2).await.unwrap_err().code(),
            DATA_VERSION_CONFLICT
        );
        assert!(path.exists());
        store.delete(record.id, 1).await.unwrap();
        assert!(!path.exists());
        assert_eq!(
            store.get(record.id).await.unwrap_err().code(),
            DATA_NOT_FOUND
        );
        let record = add(&store, test, "missing.txt", b"data").await;
        fs::remove_file(store.path(&record).unwrap()).unwrap();
        store.delete(record.id, 1).await.unwrap();
        let record = add(&store, test, "blocked.txt", b"data").await;
        let path = store.path(&record).unwrap();
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        store.delete(record.id, 1).await.unwrap();
        assert!(path.is_dir());
        assert_eq!(
            store.get(record.id).await.unwrap_err().code(),
            DATA_NOT_FOUND
        );
    })
    .await;
}

fn old(path: &Path) {
    File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_times(fs::FileTimes::new().set_modified(SystemTime::now() - Duration::from_secs(7200)))
        .unwrap();
}

#[tokio::test]
async fn reclaim_orphans_stale_tmp_missing_rows_and_grace_period() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let record = add(&store, test, "a.txt", b"keep").await;
        let path = store.path(&record).unwrap();
        old(&path);
        let parent = path.parent().unwrap();
        let orphan = parent.join(Id::new().to_string());
        fs::write(&orphan, b"orphan").unwrap();
        old(&orphan);
        let young = parent.join(Id::new().to_string());
        fs::write(&young, b"young").unwrap();
        let tmp = store.0.root.join("tmp/stale.part");
        fs::write(&tmp, b"stale").unwrap();
        old(&tmp);
        let young_tmp = store.0.root.join("tmp/young.part");
        fs::write(&young_tmp, b"young").unwrap();
        let missing_record = add(&store, test, "missing.txt", b"gone").await;
        fs::remove_file(store.path(&missing_record).unwrap()).unwrap();
        let outside = source(test, "outside.txt", b"outside");
        old(&outside);
        let report = store.reclaim().await.unwrap();
        assert_eq!(
            (
                report.orphan_files,
                report.orphan_bytes,
                report.stale_tmp,
                report.missing_rows,
                report.failed
            ),
            (1, 6, 1, 1, 0)
        );
        assert!(path.exists() && young.exists() && young_tmp.exists() && outside.exists());
        assert!(!orphan.exists() && !tmp.exists());
        assert!(store.get(missing_record.id).await.is_ok());
        assert_eq!(store.list(input(1, 20, None, None)).await.unwrap().total, 2);
    })
    .await;
}

#[test]
fn base64_rfc4648_vectors_and_path_validation() {
    for (bytes, expected) in [
        ("", ""),
        ("f", "Zg=="),
        ("fo", "Zm8="),
        ("foo", "Zm9v"),
        ("foob", "Zm9vYg=="),
        ("fooba", "Zm9vYmE="),
        ("foobar", "Zm9vYmFy"),
    ] {
        assert_eq!(base64(bytes.as_bytes()), expected);
    }
    let root = tempfile::tempdir().unwrap();
    assert!(safe_path(root.path(), "../outside").is_err());
    assert!(safe_path(root.path(), "/absolute").is_err());
    let id = Id::new();
    for (timestamp, directory) in [
        ("0000-01-01T00:00:00.000Z", "0000/01"),
        ("9999-12-01T00:00:00.000Z", "9999/12"),
        ("2026-11-01T00:00:00.000+08:00", "2026/10"),
    ] {
        assert_eq!(
            relative(id, timestamp.parse().unwrap()).unwrap(),
            format!("{directory}/{id}")
        );
    }
    let max = Timestamp::from_millis(jiff::Timestamp::MAX.as_second() * 1_000).unwrap();
    assert_eq!(relative(id, max).unwrap(), format!("9999/12/{id}"));
}

#[test]
fn save_copy_cancellation_preserves_destination_and_cleans_partial() {
    struct CancellingRead {
        bytes: io::Cursor<Vec<u8>>,
        cancellation: CancellationToken,
    }
    impl Read for CancellingRead {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            let result = self.bytes.read(buffer);
            self.cancellation.cancel();
            result
        }
    }
    let root = tempfile::tempdir().unwrap();
    let dest = root.path().join("copy.txt");
    fs::write(&dest, b"original").unwrap();
    let id = Id::new();
    let cancellation = CancellationToken::new();
    let mut reader = CancellingRead {
        bytes: io::Cursor::new(vec![b'a'; HEAD_BYTES * 2]),
        cancellation: cancellation.clone(),
    };
    assert_eq!(
        save_file(&mut reader, &dest, id, &cancellation)
            .unwrap_err()
            .code(),
        JOB_CANCELLED
    );
    assert_eq!(fs::read(&dest).unwrap(), b"original");
    assert!(!root.path().join(format!("copy.txt.{id}.partial")).exists());
}

#[cfg(windows)]
#[test]
fn filename_rejects_unpaired_utf16() {
    use std::os::windows::ffi::OsStringExt;
    let name = std::ffi::OsString::from_wide(&[0xd800, 0x2e, 0x74, 0x78, 0x74]);
    assert_eq!(
        source_name(Path::new(&name)).unwrap_err().code(),
        INPUT_INVALID
    );
}

#[cfg(windows)]
#[tokio::test]
async fn reclaim_reports_failed_deletion_and_continues() {
    use std::os::windows::fs::OpenOptionsExt;
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let record = add(&store, test, "a.txt", b"keep").await;
        let path = store.path(&record).unwrap();
        let parent = path.parent().unwrap();
        let blocked = parent.join(Id::new().to_string());
        fs::write(&blocked, b"blocked").unwrap();
        old(&blocked);
        let other = parent.join(Id::new().to_string());
        fs::write(&other, b"other").unwrap();
        old(&other);
        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&blocked)
            .unwrap();
        let report = store.reclaim().await.unwrap();
        assert_eq!(report.failed, 1);
        assert_eq!(report.orphan_files, 1);
        assert!(!other.exists());
        drop(held);
        assert!(blocked.exists());
    })
    .await;
}

#[tokio::test]
async fn reclaim_does_not_follow_directory_links_or_read_tampered_paths() {
    test_support::run(async |test| {
        let store = setup(test, DEFAULT_MAX_MIB).await;
        let record = add(&store, test, "a.txt", b"data").await;
        let outside = test.root.path().join("outside");
        fs::create_dir_all(outside.join("10")).unwrap();
        let victim = outside.join("10").join(Id::new().to_string());
        fs::write(&victim, b"safe").unwrap();
        old(&victim);
        let link = store.0.root.join("2099");
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&outside, &link).or_else(|error| {
            let output = std::process::Command::new("cmd")
                .args(["/d", "/c", "mklink", "/J"])
                .arg(&link)
                .arg(&outside)
                .output()?;
            if output.status.success() {
                eprintln!("directory junction fallback exercised");
                Ok(())
            } else {
                Err(error)
            }
        });
        #[cfg(not(windows))]
        let linked = std::os::unix::fs::symlink(&outside, &link);
        match linked {
            Ok(()) => {
                assert!(
                    safe_path(
                        &store.0.root,
                        &format!("2099/10/{}", victim.file_name().unwrap().to_str().unwrap())
                    )
                    .is_err()
                );
                store.reclaim().await.unwrap();
                assert_eq!(fs::read(&victim).unwrap(), b"safe");
                #[cfg(windows)]
                fs::remove_dir(&link).unwrap();
                #[cfg(not(windows))]
                fs::remove_file(&link).unwrap();
            }
            Err(error) => eprintln!("SKIP directory symlink creation unavailable: {error}"),
        }
        test.db
            .execute(
                &Query::update()
                    .table(TABLE.name)
                    .value("stored_path", "../outside/victim")
                    .and_where(Expr::col("id").eq(record.id))
                    .to_owned(),
            )
            .await
            .unwrap();
        assert_eq!(
            store.preview(record.id).await.unwrap_err().code(),
            INTERNAL_UNEXPECTED
        );
        assert_eq!(fs::read(victim).unwrap(), b"safe");
    })
    .await;
}

#[test]
fn default_file_limit_is_twenty_mib() {
    assert_eq!(DEFAULT_MAX_MIB, 20);
}
