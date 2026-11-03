import { useQueryClient } from "@tanstack/react-query";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshAuth, useAuthStatus } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, ScrollArea } from "@/kit";
import {
  accountAuthConfirmMode,
  accountAuthInitialize,
  accountAuthLogin,
  accountSessionUnlock,
} from "@/lib/generated/commands";
import { ActivityTracker } from "@/modules/account/activity-tracker";
import { PasswordForm } from "@/modules/account/password-form";
import { RecoverForm } from "@/modules/account/recover-form";
import { RecoveryCodes } from "@/modules/account/recovery-codes";
import { SessionActions } from "@/modules/account/session-actions";

export function AuthGate({
  children,
  header,
}: {
  children: ReactNode;
  header: ReactNode;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const auth = useAuthStatus();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [recovering, setRecovering] = useState(false);
  const state = auth.data?.state;
  // 维护独占会拒绝所有 Normal 查询；busy 不代表认证失效。
  // 仅保留上次已验证的数据，避免卸载正在运行的备份进度与取消入口。
  const maintenanceBusy =
    auth.error?.code === "app.operation.busy" && auth.data !== undefined;
  useEffect(() => {
    if (state === "anonymous" || auth.data?.mode === "none") setCodes(null);
    if (state && state !== "active") {
      const filter = {
        predicate: (query: { queryKey: readonly unknown[] }) =>
          !(query.queryKey[0] === "account" && query.queryKey[1] === "auth") &&
          !(query.queryKey[0] === "app" && query.queryKey[1] === "settings"),
      };
      void client.cancelQueries(filter);
      client.removeQueries(filter);
    }
  }, [client, state, auth.data?.mode]);
  let content: ReactNode;
  if (auth.isPending)
    content = <p role="status">{t("account.auth.loading")}</p>;
  else if (auth.isError && !maintenanceBusy)
    content = (
      <>
        <IpcErrorMessage error={auth.error} />
        <Button onClick={() => void auth.refetch()}>
          {t("account.auth.retry")}
        </Button>
      </>
    );
  else if (auth.data) {
    const status = auth.data;
    if (status.state === "active" && !codes && !recovering)
      return (
        <Fragment key={status.user?.id}>
          {status.mode === "login" && (
            <ActivityTracker minutes={status.idleLockMinutes} />
          )}
          {children}
        </Fragment>
      );
    if (recovering)
      content = <RecoverForm onBack={() => setRecovering(false)} />;
    else if (codes && status.state === "active")
      content = (
        <>
          <ActivityTracker minutes={status.idleLockMinutes} />
          <RecoveryCodes codes={codes} onSaved={() => setCodes(null)} />
        </>
      );
    else if (status.state === "initRequired")
      content = (
        <>
          <h1 className="text-2xl font-semibold">
            {t("account.auth.initialize")}
          </h1>
          <PasswordForm
            submitLabel="account.auth.initialize"
            confirm
            onSubmit={async ({ password }) => {
              const result = await accountAuthInitialize({ password });
              setCodes(result.recoveryCodes);
              await refreshAuth(client);
            }}
          />
        </>
      );
    else if (status.state === "confirmRequired")
      content = (
        <>
          <h1 className="text-2xl font-semibold">
            {t("account.auth.confirmMode")}
          </h1>
          <p>{t("account.auth.confirmHint")}</p>
          <PasswordForm
            submitLabel="account.auth.confirmMode"
            onSubmit={async ({ password, captcha }) => {
              await accountAuthConfirmMode({
                password,
                ...(captcha && { captcha }),
              });
              await refreshAuth(client);
            }}
          />
        </>
      );
    else if (status.state === "locked")
      content = (
        <>
          <h1 className="text-2xl font-semibold">{t("account.auth.locked")}</h1>
          <p>{status.user?.displayName || t("account.user.owner")}</p>
          <PasswordForm
            submitLabel="account.auth.unlock"
            onSubmit={async ({ password, captcha }) => {
              await accountSessionUnlock({
                password,
                ...(captcha && { captcha }),
              });
              await refreshAuth(client);
            }}
          />
          <SessionActions locked />
        </>
      );
    else
      content = (
        <>
          <h1 className="text-2xl font-semibold">{t("account.auth.login")}</h1>
          <PasswordForm
            submitLabel="account.auth.login"
            onSubmit={async ({ password, captcha }) => {
              await accountAuthLogin({
                password,
                ...(captcha && { captcha }),
              });
              await refreshAuth(client);
            }}
          />
          <Button variant="ghost" onClick={() => setRecovering(true)}>
            {t("account.auth.forgotPassword")}
          </Button>
        </>
      );
  }
  return (
    <ScrollArea
      region="content"
      className="h-dvh bg-background text-foreground"
    >
      {!auth.isPending && header}
      <main className="mx-auto flex max-w-xl flex-col gap-6 px-6 py-16">
        {content}
      </main>
    </ScrollArea>
  );
}
