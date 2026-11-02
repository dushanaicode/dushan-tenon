use super::*;

fn unused_codes(user_id: Id) -> sea_query::SelectStatement {
    let mut query = select(RECOVERY).into_query();
    query
        .clear_selects()
        .columns(["id", "code_hash"])
        .and_where(Expr::col("user_id").eq(user_id))
        .and_where(Expr::col("used_at").is_null());
    query
}

impl AccountService {
    pub async fn recover(
        &self,
        input: RecoverInput,
        trace_id: &str,
    ) -> Result<RecoverResult, AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        if !matches!(self.state()?, RuntimeState::Login { .. }) {
            return Err(AppError::new(MODE_CONFLICT));
        }
        // 恢复事务嵌套在尝试保护内；隔离其 future 布局，保持宿主 release 可编译。
        let (user, remaining_codes) = Box::pin(self.attempt(input.captcha, async {
            password::validate(&input.new_password)?;
            let user = self.user(self.started()?.owner).await?;
            let hashes = self.started()?.db.fetch_all(&unused_codes(user.id)).await?;
            let code_id = password::verify_recovery(input.recovery_code.into(), hashes)
                .await?
                .ok_or_else(|| AppError::new(INVALID_CREDENTIALS))?;
            let hash = password::hash_password(input.new_password.into()).await?;
            let context = ExecutionContext::new(Actor::User(user.id), trace_id);
            let mut tx = self.started()?.db.begin().await?;
            // 所有恢复码写入都先锁用户，再锁码，防止恢复、重发和模式切换交错。
            let user: User = tx
                .fetch_optional(&user_query(user.id).lock_exclusive().to_owned())
                .await?
                .ok_or_else(|| AppError::new(INVALID_CREDENTIALS))?;
            let current: Option<(Id, String)> = tx
                .fetch_optional(
                    &unused_codes(user.id)
                        .and_where(Expr::col("id").eq(code_id))
                        .lock_exclusive()
                        .to_owned(),
                )
                .await?;
            if current.is_none() {
                return Err(AppError::new(INVALID_CREDENTIALS));
            }
            tx.update_by_id(
                RECOVERY,
                &context,
                code_id,
                None,
                [("used_at", (self.clock)().into())],
            )
            .await?;
            tx.update_by_id(
                USER,
                &context,
                user.id,
                Some(user.row_version),
                [("password_hash", hash.expose_secret().into())],
            )
            .await?;
            let remaining: Vec<(Id, String)> = tx.fetch_all(&unused_codes(user.id)).await?;
            tx.commit().await?;
            self.clear_session().await?;
            Ok((user, remaining.len() as u32))
        }))
        .await?;
        self.create_session(&user).await?;
        Ok(RecoverResult { remaining_codes })
    }

    pub async fn recovery_regenerate(
        &self,
        context: &ExecutionContext,
        input: PasswordProof,
    ) -> Result<RecoveryCodes, AppError> {
        let _permit = self
            .operations
            .acquire()
            .await
            .map_err(|_| AppError::new(INTERNAL_UNEXPECTED))?;
        let (_, _, user) = self.session(false).await?;
        if context.actor != Actor::User(user.id) {
            return Err(AppError::new(MODE_CONFLICT));
        }
        self.check_password(&user, input).await?;
        let secrets = password::regenerate().await?;
        let mut tx = self.started()?.db.begin().await?;
        let current: Option<User> = tx
            .fetch_optional(&user_query(user.id).lock_exclusive().to_owned())
            .await?;
        if !current.is_some_and(|current| current.password_hash == user.password_hash) {
            return Err(AppError::new(SESSION_EXPIRED));
        }
        replace_recovery(&mut tx, context, user.id, &secrets.hashes).await?;
        tx.commit().await?;
        Ok(RecoveryCodes {
            recovery_codes: secrets.codes,
        })
    }

    pub async fn recovery_remaining(&self) -> Result<RecoveryRemaining, AppError> {
        let (_, _, user) = self.session(false).await?;
        let codes: Vec<(Id, String)> = self.started()?.db.fetch_all(&unused_codes(user.id)).await?;
        Ok(RecoveryRemaining {
            remaining: codes.len() as u32,
        })
    }
}
