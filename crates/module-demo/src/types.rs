use serde::{Deserialize, Serialize};
use tenon_framework::{id::Id, time::Timestamp};
use ts_rs::TS;

tenon_framework::dict_enum! {
    pub enum DemoSampleStage {
        Draft => "draft" (Neutral),
        Ready => "ready" (Success),
    }
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DemoAttachment {
    pub id: Id,
    pub name: String,
    pub extension: String,
    #[ts(type = "number")]
    pub bytes: i64,
    pub missing: bool,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DemoSample {
    pub id: Id,
    pub code: String,
    pub title: String,
    pub note: String,
    pub stage: DemoSampleStage,
    #[ts(type = "number | null")]
    pub character_count: Option<i64>,
    pub attachment: Option<DemoAttachment>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    #[ts(type = "number")]
    pub row_version: i64,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DemoSampleId {
    pub id: Id,
}

#[derive(Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoSampleVersion {
    pub id: Id,
    #[ts(type = "number")]
    pub row_version: i64,
}

#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DemoSampleCreate {
    pub code: String,
    pub title: String,
    pub note: String,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoSampleUpdate {
    pub id: Id,
    #[ts(type = "number")]
    pub row_version: i64,
    pub title: String,
    pub note: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoDraftFields {
    pub code: String,
    pub title: String,
    pub note: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoDraftLease {
    pub id: Id,
    pub session_id: Id,
    #[ts(type = "number")]
    pub revision: i64,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoDraftOpen {
    pub sample_id: Option<Id>,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoDraftWrite {
    pub lease: DemoDraftLease,
    pub fields: DemoDraftFields,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DemoDraftSaved {
    #[ts(type = "number")]
    pub revision: i64,
    pub updated_at: Timestamp,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DemoSampleDraft {
    pub lease: DemoDraftLease,
    pub sample_id: Option<Id>,
    #[ts(type = "number | null")]
    pub base_version: Option<i64>,
    pub baseline: DemoDraftFields,
    pub fields: DemoDraftFields,
    pub recovered: bool,
    pub conflict: bool,
    pub updated_at: Timestamp,
}

#[derive(Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoListInput {
    pub page: u32,
    pub page_size: u32,
    #[ts(optional)]
    pub keyword: Option<String>,
    #[ts(optional)]
    pub stage: Option<DemoSampleStage>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct DemoOverview {
    #[ts(type = "number")]
    pub total: i64,
    #[ts(type = "number")]
    pub ready: i64,
    pub recent: Vec<DemoSample>,
}

#[derive(Deserialize, Serialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DemoMeasureInput {
    pub samples: Vec<DemoSampleVersion>,
}

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoExportOptions {
    #[ts(optional)]
    pub keyword: Option<String>,
    #[ts(optional)]
    pub stage: Option<DemoSampleStage>,
}

#[derive(Clone, Copy, Deserialize, Serialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum DemoImportMode {
    Error,
    Skip,
}

#[derive(Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DemoImportOptions {
    pub mode: DemoImportMode,
}
