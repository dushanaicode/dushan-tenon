//! macOS 13+ main-application login item. Construct only for an installed product.
use smappservice_rs::{AppService, ServiceStatus, ServiceType};
use tenon_framework::error::AppError;

use tenon_desktop::native::{
    UNAVAILABLE,
    autostart::{AutostartAdapter, Registration, StartupApproval},
};

pub struct SystemMacAutostart;

fn registration(status: ServiceStatus) -> Result<Registration, AppError> {
    match status {
        ServiceStatus::NotRegistered => Ok(Registration::NotRegistered),
        ServiceStatus::Enabled | ServiceStatus::RequiresApproval => {
            Ok(Registration::Registered("main-app".into()))
        }
        ServiceStatus::NotFound => Err(AppError::new(UNAVAILABLE)),
    }
}

fn approval(status: ServiceStatus) -> Result<StartupApproval, AppError> {
    match status {
        ServiceStatus::Enabled => Ok(StartupApproval::Allowed),
        ServiceStatus::NotRegistered | ServiceStatus::RequiresApproval => {
            Ok(StartupApproval::Disabled)
        }
        ServiceStatus::NotFound => Err(AppError::new(UNAVAILABLE)),
    }
}

impl AutostartAdapter for SystemMacAutostart {
    fn registered(&self) -> Result<Registration, AppError> {
        registration(AppService::new(ServiceType::MainApp).status())
    }

    fn approval(&self) -> Result<StartupApproval, AppError> {
        approval(AppService::new(ServiceType::MainApp).status())
    }

    fn set_registered(&self, enabled: bool) -> Result<Registration, AppError> {
        let service = AppService::new(ServiceType::MainApp);
        match (enabled, service.status()) {
            (true, ServiceStatus::NotRegistered) => {
                service.register().map_err(|_| AppError::new(UNAVAILABLE))?
            }
            (false, ServiceStatus::Enabled | ServiceStatus::RequiresApproval) => service
                .unregister()
                .map_err(|_| AppError::new(UNAVAILABLE))?,
            (_, ServiceStatus::NotFound) => return Err(AppError::new(UNAVAILABLE)),
            // A registered-but-disabled item keeps the user's System Settings decision.
            _ => {}
        }
        let observed = registration(service.status())?;
        if matches!(observed, Registration::Registered(_)) != enabled {
            return Err(AppError::new(UNAVAILABLE));
        }
        Ok(observed)
    }

    fn restore(&self, snapshot: &Registration) -> Result<(), AppError> {
        // Restore registration only. Never manufacture or revoke OS user consent;
        // Autostart::apply rechecks registration; approval is observed separately.
        self.set_registered(matches!(snapshot, Registration::Registered(_)))
            .map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_login_item_does_not_imply_user_approval() {
        assert!(matches!(
            registration(ServiceStatus::NotRegistered).unwrap(),
            Registration::NotRegistered
        ));
        assert!(matches!(
            registration(ServiceStatus::RequiresApproval).unwrap(),
            Registration::Registered(_)
        ));
        assert!(matches!(
            approval(ServiceStatus::RequiresApproval).unwrap(),
            StartupApproval::Disabled
        ));
        assert!(matches!(
            approval(ServiceStatus::Enabled).unwrap(),
            StartupApproval::Allowed
        ));
        assert!(registration(ServiceStatus::NotFound).is_err());
        assert!(approval(ServiceStatus::NotFound).is_err());
    }
}
