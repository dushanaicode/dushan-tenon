use super::{invoke, with_host};
use serde_json::json;
use tenon_framework::id::Id;

#[test]
fn workbench_commands_round_trip_shared_state_and_revision() {
    with_host(
        "ipc_tests::workbench::workbench_commands_round_trip_shared_state_and_revision",
        "",
        |_| {},
        |window, _| {
            let initial = invoke(window, "app_workbench_get", json!({})).unwrap();
            assert_eq!(initial["revision"], 0);
            assert_eq!(initial["objects"], json!([]));
            assert!(initial["activeObject"].is_null());
            let object = json!({"kind":"job","id":Id::new()});
            let objects = json!({"kind":"set-objects","objects":[object],"activeObject":object});
            let saved = invoke(
                window,
                "app_workbench_update",
                json!({
                    "input":{"expectedRevision":0,"change":objects}
                }),
            )
            .unwrap();
            assert_eq!(saved["revision"], 1);
            assert_eq!(saved["objects"], json!([object]));
            assert_eq!(saved["activeObject"], object);
            assert_eq!(saved["layouts"], initial["layouts"]);
            assert_eq!(saved["auxiliary"], initial["auxiliary"]);

            let auxiliary = json!({"width":480,"visible":true,"panel":"job-inspector"});
            let panel = json!({"kind":"set-auxiliary","auxiliary":auxiliary});
            let console = json!({"primaryWidth":360,"primaryCollapsed":true});
            let layout = json!({"kind":"set-layout","layout":{"console":console}});
            for change in [&objects, &panel, &layout] {
                let error = invoke(
                    window,
                    "app_workbench_update",
                    json!({
                        "input":{"expectedRevision":0,"change":change}
                    }),
                )
                .unwrap_err();
                assert_eq!(error["code"], "app.workbench.conflict");
            }
            assert_eq!(
                invoke(
                    window,
                    "app_workbench_reset_layout",
                    json!({
                        "input":{"expectedRevision":0}
                    })
                )
                .unwrap_err()["code"],
                "app.workbench.conflict"
            );
            assert_eq!(
                invoke(window, "app_workbench_get", json!({})).unwrap(),
                saved
            );

            for (revision, change) in [(1, panel), (2, layout)] {
                invoke(
                    window,
                    "app_workbench_update",
                    json!({
                        "input":{"expectedRevision":revision,"change":change}
                    }),
                )
                .unwrap();
            }
            let saved = invoke(window, "app_workbench_get", json!({})).unwrap();
            assert_eq!(saved["revision"], 3);
            assert_eq!(saved["layouts"], json!({"console":console}));
            assert_eq!(saved["auxiliary"], auxiliary);
            assert_eq!(saved["objects"], json!([object]));
            assert_eq!(saved["activeObject"], object);
            for change in [
                json!({"kind":"set-objects","objects":[object,object],"activeObject":null}),
                json!({"kind":"set-objects","objects":[],"activeObject":object}),
                json!({"kind":"set-auxiliary","auxiliary":{"width":481,"visible":true,"panel":null}}),
            ] {
                assert_eq!(
                    invoke(
                        window,
                        "app_workbench_update",
                        json!({
                            "input":{"expectedRevision":3,"change":change}
                        })
                    )
                    .unwrap_err()["code"],
                    "app.workbench.invalid"
                );
            }
            let mut mixed = objects.clone();
            mixed["layout"] = json!({"console":console});
            assert!(
                invoke(
                    window,
                    "app_workbench_update",
                    json!({
                        "input":{"expectedRevision":3,"change":mixed}
                    })
                )
                .is_err()
            );
            assert!(
                invoke(
                    window,
                    "app_workbench_update",
                    json!({
                        "input":{"expectedRevision":3,"change":objects,"subjectId":Id::new()}
                    })
                )
                .is_err()
            );
            assert_eq!(
                invoke(window, "app_workbench_get", json!({})).unwrap(),
                saved
            );
            let reset = invoke(
                window,
                "app_workbench_reset_layout",
                json!({
                    "input":{"expectedRevision":3}
                }),
            )
            .unwrap();
            let mut expected = initial;
            expected["revision"] = json!(4);
            assert_eq!(reset, expected);
            assert_eq!(
                invoke(window, "app_workbench_get", json!({})).unwrap(),
                reset
            );
        },
    );
}

#[test]
fn workbench_commands_require_the_active_user() {
    with_host(
        "ipc_tests::workbench::workbench_commands_require_the_active_user",
        "",
        |_| {},
        |window, _| {
            invoke(
                window,
                "account_auth_enable_login",
                json!({
                    "input":{"password":"owner-password"}
                }),
            )
            .unwrap();
            invoke(window, "account_auth_logout", json!({})).unwrap();
            for (command, body) in [
                ("app_workbench_get", json!({})),
                (
                    "app_workbench_update",
                    json!({
                        "input":{"expectedRevision":0,"change":{"kind":"set-objects","objects":[],"activeObject":null}}
                    }),
                ),
                (
                    "app_workbench_update",
                    json!({
                        "input":{"expectedRevision":0,"change":{"kind":"set-auxiliary","auxiliary":{"width":320,"visible":false,"panel":null}}}
                    }),
                ),
                (
                    "app_workbench_reset_layout",
                    json!({"input":{"expectedRevision":0}}),
                ),
            ] {
                assert_eq!(
                    invoke(window, command, body).unwrap_err()["code"],
                    "account.auth.required"
                );
            }
        },
    );
}
