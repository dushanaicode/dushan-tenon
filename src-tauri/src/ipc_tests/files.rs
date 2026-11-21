use super::*;
use serde_json::json;
use tenon_framework::{actor::Actor, id::Id};

#[test]
fn file_commands_resolve_single_use_tokens_to_paths() {
    with_host(
        "ipc_tests::files::file_commands_resolve_single_use_tokens_to_paths",
        "[ui]\ndeveloper_mode=true\n",
        |_| {},
        |window, root| {
            use tenon_desktop::picked_files::FilePurpose;
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            let source = root.join("input.txt");
            fs::write(&source, "host-token-boundary").unwrap();
            let token = state
                .picked_files
                .insert(actor, FilePurpose::Store, source.clone(), &["txt".into()])
                .unwrap()
                .token;
            let input = json!({"input":{"purpose":"files.attachment","fileToken":token}});
            let file = invoke(window, "files_file_add", input.clone()).unwrap();
            assert_eq!(file["originalName"], "input.txt");
            assert!(!file.to_string().contains(&root.display().to_string()));
            assert_eq!(
                invoke(window, "files_file_add", input).unwrap_err()["code"],
                "app.exchange.file_token_invalid"
            );
            let destination = root.join("copied.txt");
            let token = state
                .picked_files
                .insert(
                    actor,
                    FilePurpose::Save,
                    destination.clone(),
                    &["txt".into()],
                )
                .unwrap()
                .token;
            invoke(
                window,
                "files_file_save_copy",
                json!({"input":{"id":file["id"],"fileToken":token}}),
            )
            .unwrap();
            assert_eq!(fs::read(&destination).unwrap(), fs::read(&source).unwrap());
            for (owner, purpose) in [
                (Actor::User(Id::new()), FilePurpose::Store),
                (actor, FilePurpose::Save),
            ] {
                let token = state
                    .picked_files
                    .insert(owner, purpose, source.clone(), &["txt".into()])
                    .unwrap()
                    .token;
                assert_eq!(
                    invoke(
                        window,
                        "files_file_add",
                        json!({"input":{"purpose":"files.attachment","fileToken":token}})
                    )
                    .unwrap_err()["code"],
                    "app.exchange.file_token_invalid"
                );
            }
        },
    );
}

#[test]
fn command_permission_denial_precedes_token_consumption() {
    with_host(
        "ipc_tests::files::command_permission_denial_precedes_token_consumption",
        "",
        |state| state.identity.permission_checker = Arc::new(DenyAll),
        |window, root| {
            use tenon_desktop::picked_files::FilePurpose;
            let state = window.state::<AppState>();
            let actor = Actor::User(state.account.owner_id().unwrap());
            let source = root.join("private.txt");
            let token = state
                .picked_files
                .insert(actor, FilePurpose::Store, source, &["txt".into()])
                .unwrap()
                .token;
            assert_eq!(
                invoke(
                    window,
                    "files_file_add",
                    json!({"input":{"purpose":"files.attachment","fileToken":token}})
                )
                .unwrap_err()["code"],
                "app.permission.denied"
            );
            assert!(
                state
                    .picked_files
                    .take(&token, actor, FilePurpose::Store, None)
                    .is_ok()
            );
        },
    );
}
