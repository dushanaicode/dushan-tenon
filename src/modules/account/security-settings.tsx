import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshAuth, useAuthStatus } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import { ParamForm } from "@/core/settings/param-form";
import { SettingGroup } from "@/kit";
import {
  accountAuthDisableLogin,
  accountAuthEnableLogin,
  accountAuthRecoveryRegenerate,
  accountAuthRecoveryRemaining,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { RecoveryRemaining } from "@/lib/generated/RecoveryRemaining";
import { PasswordForm } from "@/modules/account/password-form";
import { RecoveryCodes } from "@/modules/account/recovery-codes";

const remainingKey = ["account", "recovery", "remaining"];

export function SecuritySettings() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const auth = useAuthStatus();
  const [codes, setCodes] = useState<string[] | null>(null);
  const remaining = useQuery<RecoveryRemaining, IpcError>({
    queryKey: remainingKey,
    queryFn: accountAuthRecoveryRemaining,
    enabled: auth.data?.mode === "login",
  });
  if (!auth.data) return null;
  const login = auth.data.mode === "login";
  return (
    <section aria-labelledby="security-title" className="space-y-4">
      <h2 id="security-title" className="text-xl font-semibold">
        {t("account.auth.security")}
      </h2>
      <ParamForm group="account.security" includeDisabled={false} />
      {codes ? (
        <SettingGroup>
          <section
            aria-labelledby="recovery-title"
            className="flex flex-col gap-stack p-panel"
          >
            <h2 id="recovery-title" className="text-xl font-semibold">
              {t("account.auth.recoveryTitle")}
            </h2>
            <p className="text-muted-foreground">
              {t("account.auth.recoveryHint")}
            </p>
            <RecoveryCodes
              codes={codes}
              onSaved={() => {
                setCodes(null);
                void refreshAuth(client);
              }}
            />
          </section>
        </SettingGroup>
      ) : (
        <>
          <SettingGroup>
            <p className="text-muted-foreground">
              {t(
                login ? "account.auth.disableHint" : "account.auth.enableHint",
              )}
            </p>
            <PasswordForm
              settingsLayout
              key={auth.data.mode}
              submitLabel={
                login ? "account.auth.disableLogin" : "account.auth.enableLogin"
              }
              confirm={!login}
              onSubmit={async ({ password, captcha }) => {
                if (login) {
                  await accountAuthDisableLogin({
                    password,
                    ...(captcha && { captcha }),
                  });
                  client.removeQueries({ queryKey: remainingKey });
                  await refreshAuth(client);
                } else {
                  const result = await accountAuthEnableLogin({ password });
                  setCodes(result.recoveryCodes);
                  await refreshAuth(client);
                }
              }}
            />
          </SettingGroup>
          {login && (
            <SettingGroup title={t("account.auth.regenerateCodes")}>
              {remaining.isPending && (
                <p role="status">{t("account.auth.remainingLoading")}</p>
              )}
              {remaining.isError && <IpcErrorMessage error={remaining.error} />}
              {remaining.data && (
                <p>
                  {t("account.auth.remainingCodes", {
                    count: remaining.data.remaining,
                  })}
                </p>
              )}
              <p className="text-muted-foreground">
                {t("account.auth.regenerateHint")}
              </p>
              <PasswordForm
                settingsLayout
                submitLabel="account.auth.regenerateCodes"
                onSubmit={async ({ password, captcha }) => {
                  const result = await accountAuthRecoveryRegenerate({
                    password,
                    ...(captcha && { captcha }),
                  });
                  setCodes(result.recoveryCodes);
                  await client.invalidateQueries({ queryKey: remainingKey });
                }}
              />
            </SettingGroup>
          )}
        </>
      )}
    </section>
  );
}
