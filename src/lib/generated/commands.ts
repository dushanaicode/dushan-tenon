// 自动生成，勿手改。运行 pnpm generate 更新。

import type { Channel } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import type { AiCancelInput } from "./AiCancelInput";
import type { AiChatInput } from "./AiChatInput";
import type { AiConnectionTest } from "./AiConnectionTest";
import type { AiStreamData } from "./AiStreamData";
import type { AppAbout } from "./AppAbout";
import type { AppModules } from "./AppModules";
import type { AppSettings } from "./AppSettings";
import type { AppSettingsUpdate } from "./AppSettingsUpdate";
import type { AuthStatus } from "./AuthStatus";
import type { CaptchaChallenge } from "./CaptchaChallenge";
import type { CurrentUser } from "./CurrentUser";
import type { DemoAttachmentAdd } from "./DemoAttachmentAdd";
import type { DemoAttachmentSave } from "./DemoAttachmentSave";
import type { DemoDraftLease } from "./DemoDraftLease";
import type { DemoDraftOpen } from "./DemoDraftOpen";
import type { DemoDraftSaved } from "./DemoDraftSaved";
import type { DemoDraftWrite } from "./DemoDraftWrite";
import type { DemoListInput } from "./DemoListInput";
import type { DemoMeasureInput } from "./DemoMeasureInput";
import type { DemoOverview } from "./DemoOverview";
import type { DemoSample } from "./DemoSample";
import type { DemoSampleCreate } from "./DemoSampleCreate";
import type { DemoSampleDraft } from "./DemoSampleDraft";
import type { DemoSampleId } from "./DemoSampleId";
import type { DemoSampleUpdate } from "./DemoSampleUpdate";
import type { DemoSampleVersion } from "./DemoSampleVersion";
import type { FileAddInput } from "./FileAddInput";
import type { FileDelete } from "./FileDelete";
import type { FileId } from "./FileId";
import type { FileListInput } from "./FileListInput";
import type { FilePreview } from "./FilePreview";
import type { FilePurposes } from "./FilePurposes";
import type { FileSaveInput } from "./FileSaveInput";
import type { FileSummary } from "./FileSummary";
import type { FileTextPage } from "./FileTextPage";
import type { FileTextPageInput } from "./FileTextPageInput";
import type { JobDetail } from "./JobDetail";
import type { JobEvent } from "./JobEvent";
import type { JobId } from "./JobId";
import type { JobListInput } from "./JobListInput";
import type { JobResolve } from "./JobResolve";
import type { JobSnapshot } from "./JobSnapshot";
import type { JobSubmitted } from "./JobSubmitted";
import type { JobSummary } from "./JobSummary";
import type { KeyboardSettings } from "./KeyboardSettings";
import type { KeyboardUpdate } from "./KeyboardUpdate";
import type { LoginInput } from "./LoginInput";
import type { NativeSettings } from "./NativeSettings";
import type { NativeSettingsChange } from "./NativeSettingsChange";
import type { NetworkSettings } from "./NetworkSettings";
import type { NetworkSettingsUpdate } from "./NetworkSettingsUpdate";
import type { NotificationItem } from "./NotificationItem";
import type { NotificationListInput } from "./NotificationListInput";
import type { NotificationReadInput } from "./NotificationReadInput";
import type { NotifyTestResult } from "./NotifyTestResult";
import type { OpenKnownTargetInput } from "./OpenKnownTargetInput";
import type { OperationCancelInput } from "./OperationCancelInput";
import type { Page } from "./Page";
import type { ParamEntry } from "./ParamEntry";
import type { PasswordInput } from "./PasswordInput";
import type { PasswordProof } from "./PasswordProof";
import type { ReclaimReport } from "./ReclaimReport";
import type { RecoverInput } from "./RecoverInput";
import type { RecoverResult } from "./RecoverResult";
import type { RecoveryCodes } from "./RecoveryCodes";
import type { RecoveryRemaining } from "./RecoveryRemaining";
import type { ScheduleId } from "./ScheduleId";
import type { ScheduleSnapshot } from "./ScheduleSnapshot";
import type { SettingListInput } from "./SettingListInput";
import type { SettingResetInput } from "./SettingResetInput";
import type { SettingSetInput } from "./SettingSetInput";
import type { StreamCancel } from "./StreamCancel";
import type { StreamEvent } from "./StreamEvent";
import type { UserPasswordChange } from "./UserPasswordChange";
import type { UserProfileUpdate } from "./UserProfileUpdate";
import type { WindowCloseDecision } from "./WindowCloseDecision";
import type { WindowEditDecision } from "./WindowEditDecision";
import type { WindowEditState } from "./WindowEditState";
import type { WindowEvent } from "./WindowEvent";
import type { WorkbenchResetLayout } from "./WorkbenchResetLayout";
import type { WorkbenchSnapshot } from "./WorkbenchSnapshot";
import type { WorkbenchUpdate } from "./WorkbenchUpdate";

export function demoDraftOpen(input: DemoDraftOpen): Promise<DemoSampleDraft> {
  return invoke<DemoSampleDraft>("demo_draft_open", { input });
}

export function demoDraftWrite(input: DemoDraftWrite): Promise<DemoDraftSaved> {
  return invoke<DemoDraftSaved>("demo_draft_write", { input });
}

export function demoDraftCommit(input: DemoDraftLease): Promise<DemoSample> {
  return invoke<DemoSample>("demo_draft_commit", { input });
}

export function demoDraftDiscard(input: DemoDraftLease): Promise<null> {
  return invoke<null>("demo_draft_discard", { input });
}

export function demoOverviewGet(): Promise<DemoOverview> {
  return invoke<DemoOverview>("demo_overview_get");
}

export function demoSampleList(
  input: DemoListInput,
): Promise<Page<DemoSample>> {
  return invoke<Page<DemoSample>>("demo_sample_list", { input });
}

export function demoSampleGet(input: DemoSampleId): Promise<DemoSample> {
  return invoke<DemoSample>("demo_sample_get", { input });
}

export function demoSampleCreate(input: DemoSampleCreate): Promise<DemoSample> {
  return invoke<DemoSample>("demo_sample_create", { input });
}

export function demoSampleUpdate(input: DemoSampleUpdate): Promise<DemoSample> {
  return invoke<DemoSample>("demo_sample_update", { input });
}

export function demoSampleDelete(input: DemoSampleVersion): Promise<null> {
  return invoke<null>("demo_sample_delete", { input });
}

export function demoMeasureStart(
  input: DemoMeasureInput,
): Promise<JobSubmitted> {
  return invoke<JobSubmitted>("demo_measure_start", { input });
}

export function demoAttachmentAdd(
  input: DemoAttachmentAdd,
): Promise<DemoSample> {
  return invoke<DemoSample>("demo_attachment_add", { input });
}

export function demoAttachmentPreview(
  input: DemoSampleId,
): Promise<FilePreview> {
  return invoke<FilePreview>("demo_attachment_preview", { input });
}

export function demoAttachmentSave(input: DemoAttachmentSave): Promise<null> {
  return invoke<null>("demo_attachment_save", { input });
}

export function demoAttachmentRemove(
  input: DemoSampleVersion,
): Promise<DemoSample> {
  return invoke<DemoSample>("demo_attachment_remove", { input });
}

export function appOperationCancel(input: OperationCancelInput): Promise<null> {
  return invoke<null>("app_operation_cancel", { input });
}

export function appWindowMinimize(): Promise<null> {
  return invoke<null>("app_window_minimize");
}

export function appWindowToggleMaximize(): Promise<null> {
  return invoke<null>("app_window_toggle_maximize");
}

export function appWindowStartDragging(): Promise<null> {
  return invoke<null>("app_window_start_dragging");
}

export function appWindowClose(): Promise<null> {
  return invoke<null>("app_window_close");
}

export function appWindowCloseDecide(
  input: WindowCloseDecision,
): Promise<null> {
  return invoke<null>("app_window_close_decide", { input });
}

export function appWindowWatch(onEvent: Channel<WindowEvent>): Promise<null> {
  return invoke<null>("app_window_watch", { onEvent });
}

export function appWindowEditState(input: WindowEditState): Promise<null> {
  return invoke<null>("app_window_edit_state", { input });
}

export function appWindowEditDecide(input: WindowEditDecision): Promise<null> {
  return invoke<null>("app_window_edit_decide", { input });
}

export function appOpenKnownTarget(input: OpenKnownTargetInput): Promise<null> {
  return invoke<null>("app_open_known_target", { input });
}

export function appNativeSettingsGet(): Promise<NativeSettings> {
  return invoke<NativeSettings>("app_native_settings_get");
}

export function appNativeSettingsUpdate(
  input: NativeSettingsChange,
): Promise<NativeSettings> {
  return invoke<NativeSettings>("app_native_settings_update", { input });
}

export function appWindowStateReset(): Promise<NativeSettings> {
  return invoke<NativeSettings>("app_window_state_reset");
}

export function aiChatStream(
  input: AiChatInput,
  channel: Channel<StreamEvent<AiStreamData>>,
): Promise<null> {
  return invoke<null>("ai_chat_stream", { input, channel });
}

export function aiChatCancel(input: AiCancelInput): Promise<null> {
  return invoke<null>("ai_chat_cancel", { input });
}

export function aiServiceTest(): Promise<AiConnectionTest> {
  return invoke<AiConnectionTest>("ai_service_test");
}

export function appSettingList(
  input: SettingListInput,
): Promise<Array<ParamEntry>> {
  return invoke<Array<ParamEntry>>("app_setting_list", { input });
}

export function appSettingSet(input: SettingSetInput): Promise<ParamEntry> {
  return invoke<ParamEntry>("app_setting_set", { input });
}

export function appSettingReset(input: SettingResetInput): Promise<ParamEntry> {
  return invoke<ParamEntry>("app_setting_reset", { input });
}

export function filesFileList(
  input: FileListInput,
): Promise<Page<FileSummary>> {
  return invoke<Page<FileSummary>>("files_file_list", { input });
}

export function filesFilePurposes(): Promise<FilePurposes> {
  return invoke<FilePurposes>("files_file_purposes");
}

export function filesFilePreview(input: FileId): Promise<FilePreview> {
  return invoke<FilePreview>("files_file_preview", { input });
}

export function filesFileTextPage(
  input: FileTextPageInput,
): Promise<FileTextPage> {
  return invoke<FileTextPage>("files_file_text_page", { input });
}

export function filesFileSaveCopy(input: FileSaveInput): Promise<null> {
  return invoke<null>("files_file_save_copy", { input });
}

export function filesFileAdd(input: FileAddInput): Promise<FileSummary> {
  return invoke<FileSummary>("files_file_add", { input });
}

export function filesFileDelete(input: FileDelete): Promise<null> {
  return invoke<null>("files_file_delete", { input });
}

export function filesFileReclaim(): Promise<ReclaimReport> {
  return invoke<ReclaimReport>("files_file_reclaim");
}

export function appJobMineGet(input: JobId): Promise<JobSnapshot> {
  return invoke<JobSnapshot>("app_job_mine_get", { input });
}

export function appJobMineWatch(
  input: JobId,
  channel: Channel<StreamEvent<JobEvent>>,
): Promise<null> {
  return invoke<null>("app_job_mine_watch", { input, channel });
}

export function appJobMineCancel(input: JobId): Promise<null> {
  return invoke<null>("app_job_mine_cancel", { input });
}

export function appAboutGet(): Promise<AppAbout> {
  return invoke<AppAbout>("app_about_get");
}

export function appNetworkSettingsGet(): Promise<NetworkSettings> {
  return invoke<NetworkSettings>("app_network_settings_get");
}

export function appNetworkSettingsUpdate(
  input: NetworkSettingsUpdate,
): Promise<NetworkSettings> {
  return invoke<NetworkSettings>("app_network_settings_update", { input });
}

export function appWorkbenchGet(): Promise<WorkbenchSnapshot> {
  return invoke<WorkbenchSnapshot>("app_workbench_get");
}

export function appKeyboardGet(): Promise<KeyboardSettings> {
  return invoke<KeyboardSettings>("app_keyboard_get");
}

export function appKeyboardUpdate(
  input: KeyboardUpdate,
): Promise<KeyboardSettings> {
  return invoke<KeyboardSettings>("app_keyboard_update", { input });
}

export function appWorkbenchUpdate(
  input: WorkbenchUpdate,
): Promise<WorkbenchSnapshot> {
  return invoke<WorkbenchSnapshot>("app_workbench_update", { input });
}

export function appWorkbenchResetLayout(
  input: WorkbenchResetLayout,
): Promise<WorkbenchSnapshot> {
  return invoke<WorkbenchSnapshot>("app_workbench_reset_layout", { input });
}

export function appSettingsGet(): Promise<AppSettings> {
  return invoke<AppSettings>("app_settings_get");
}

export function appSettingsUpdate(
  input: AppSettingsUpdate,
): Promise<AppSettings> {
  return invoke<AppSettings>("app_settings_update", { input });
}

export function appModulesList(): Promise<AppModules> {
  return invoke<AppModules>("app_modules_list");
}

export function appStreamCancel(input: StreamCancel): Promise<null> {
  return invoke<null>("app_stream_cancel", { input });
}

export function devtoolsJobList(
  input: JobListInput,
): Promise<Page<JobSummary>> {
  return invoke<Page<JobSummary>>("devtools_job_list", { input });
}

export function devtoolsJobGet(input: JobId): Promise<JobDetail> {
  return invoke<JobDetail>("devtools_job_get", { input });
}

export function devtoolsJobWatch(
  input: JobId,
  channel: Channel<StreamEvent<JobEvent>>,
): Promise<null> {
  return invoke<null>("devtools_job_watch", { input, channel });
}

export function devtoolsJobCancel(input: JobId): Promise<null> {
  return invoke<null>("devtools_job_cancel", { input });
}

export function devtoolsJobRetry(input: JobId): Promise<null> {
  return invoke<null>("devtools_job_retry", { input });
}

export function devtoolsJobResolve(input: JobResolve): Promise<null> {
  return invoke<null>("devtools_job_resolve", { input });
}

export function devtoolsScheduleList(): Promise<Array<ScheduleSnapshot>> {
  return invoke<Array<ScheduleSnapshot>>("devtools_schedule_list");
}

export function devtoolsScheduleRunNow(
  input: ScheduleId,
): Promise<JobSubmitted> {
  return invoke<JobSubmitted>("devtools_schedule_run_now", { input });
}

export function accountUserMe(): Promise<CurrentUser> {
  return invoke<CurrentUser>("account_user_me");
}

export function notifyList(
  input: NotificationListInput,
): Promise<Page<NotificationItem>> {
  return invoke<Page<NotificationItem>>("notify_list", { input });
}

export function notifyUnreadCount(): Promise<number> {
  return invoke<number>("notify_unread_count");
}

export function notifyTestSend(): Promise<NotifyTestResult> {
  return invoke<NotifyTestResult>("notify_test_send");
}

export function notifyMarkRead(input: NotificationReadInput): Promise<null> {
  return invoke<null>("notify_mark_read", { input });
}

export function notifyMarkAllRead(): Promise<null> {
  return invoke<null>("notify_mark_all_read");
}

export function accountUserProfileUpdate(
  input: UserProfileUpdate,
): Promise<null> {
  return invoke<null>("account_user_profile_update", { input });
}

export function accountUserPasswordChange(
  input: UserPasswordChange,
): Promise<null> {
  return invoke<null>("account_user_password_change", { input });
}

export function accountAuthStatus(): Promise<AuthStatus> {
  return invoke<AuthStatus>("account_auth_status");
}

export function accountAuthLogin(input: LoginInput): Promise<null> {
  return invoke<null>("account_auth_login", { input });
}

export function accountAuthCaptcha(): Promise<CaptchaChallenge> {
  return invoke<CaptchaChallenge>("account_auth_captcha");
}

export function accountAuthRecover(
  input: RecoverInput,
): Promise<RecoverResult> {
  return invoke<RecoverResult>("account_auth_recover", { input });
}

export function accountAuthInitialize(
  input: PasswordInput,
): Promise<RecoveryCodes> {
  return invoke<RecoveryCodes>("account_auth_initialize", { input });
}

export function accountAuthConfirmMode(input: PasswordProof): Promise<null> {
  return invoke<null>("account_auth_confirm_mode", { input });
}

export function accountAuthLogout(): Promise<null> {
  return invoke<null>("account_auth_logout");
}

export function accountSessionLock(): Promise<null> {
  return invoke<null>("account_session_lock");
}

export function accountSessionUnlock(input: PasswordProof): Promise<null> {
  return invoke<null>("account_session_unlock", { input });
}

export function accountSessionTouch(): Promise<null> {
  return invoke<null>("account_session_touch");
}

export function accountAuthEnableLogin(
  input: PasswordInput,
): Promise<RecoveryCodes> {
  return invoke<RecoveryCodes>("account_auth_enable_login", { input });
}

export function accountAuthDisableLogin(input: PasswordProof): Promise<null> {
  return invoke<null>("account_auth_disable_login", { input });
}

export function accountAuthRecoveryRegenerate(
  input: PasswordProof,
): Promise<RecoveryCodes> {
  return invoke<RecoveryCodes>("account_auth_recovery_regenerate", { input });
}

export function accountAuthRecoveryRemaining(): Promise<RecoveryRemaining> {
  return invoke<RecoveryRemaining>("account_auth_recovery_remaining");
}
