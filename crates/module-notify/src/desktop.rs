//! 固定桌面渠道；配置 gate 与账号许可共同保护同步发送。

use tenon_framework::{error::AppError, id::Id};

use crate::{NotifyService, notifications::NotificationItem, quiet};

/// 外部投递结果；错误只保留安全错误码，不保存传输细节。
#[derive(Debug, PartialEq, Eq)]
pub enum DesktopDelivery {
    Delivered,
    Failed(Option<String>),
    Unknown(Option<String>),
    Skipped,
}

/// 宿主在配置读锁内读取实时开关，开启时恰好调用一次 send，关闭返回 Skipped。
/// 必须持锁至同步回调结束；锁中毒返回 AppError，不得使用启动快照。
/// 回调不能重入配置锁；翻译、异步参数读取必须先完成。
pub trait DesktopGate: Send + Sync {
    fn with_enabled(
        &self,
        send: &mut dyn FnMut() -> Result<DesktopDelivery, AppError>,
    ) -> Result<DesktopDelivery, AppError>;
}

/// 宿主发送纯文本；成功表示系统通知插件接受了请求。
pub trait DesktopNotifier: Send + Sync {
    /// 发送失败使用 notify 的 DESKTOP_FAILED；调用方不记录原始传输错误。
    fn send(&self, title: &str, body: &str) -> Result<(), AppError>;

    /// 查询 main 窗口焦点。查询失败必须返回 true，并只记录安全 reason_code。
    fn window_focused(&self) -> bool;
}

impl NotifyService {
    pub(super) async fn send_desktop(
        &self,
        recipient: Id,
        item: &NotificationItem,
    ) -> Result<DesktopDelivery, AppError> {
        if self
            .desktop_gate
            .with_enabled(&mut || Ok(DesktopDelivery::Delivered))?
            == DesktopDelivery::Skipped
        {
            return Ok(DesktopDelivery::Skipped);
        }
        let started = self.started()?;
        let quiet_enabled = started.params.bool("notify.quiet_enabled").await?;
        let quiet_start = started.params.int("notify.quiet_start_hour").await?;
        let quiet_end = started.params.int("notify.quiet_end_hour").await?;
        let when_focused = started.params.bool("notify.desktop_when_focused").await?;
        self.account
            .with_active_user(recipient, || {
                let title = started.translator.text(&item.title_key, &item.params)?;
                let body = started.translator.text(&item.body_key, &item.params)?;
                self.desktop_gate.with_enabled(&mut || {
                    if quiet_enabled
                        && quiet::in_window(
                            quiet::local_hour((self.clock)()),
                            quiet_start,
                            quiet_end,
                        )
                    {
                        return Ok(DesktopDelivery::Skipped);
                    }
                    if !when_focused && self.notifier.window_focused() {
                        return Ok(DesktopDelivery::Skipped);
                    }
                    self.notifier.send(&title, &body)?;
                    Ok(DesktopDelivery::Delivered)
                })
            })
            .await
            .map(|result| result.unwrap_or(DesktopDelivery::Skipped))
    }
}
