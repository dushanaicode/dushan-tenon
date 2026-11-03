import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshAuth, useAuthStatus } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  accountUserPasswordChange,
  accountUserProfileUpdate,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import { DisplayNameForm } from "@/modules/account/display-name-form";
import { PasswordForm } from "@/modules/account/password-form";

export function ProfilePage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const auth = useAuthStatus();
  const profile = useMutation<unknown, IpcError, string>({
    mutationFn: (displayName) => accountUserProfileUpdate({ displayName }),
    onSuccess: () => refreshAuth(client),
  });
  const [passwordSaved, setPasswordSaved] = useState(false);
  if (!auth.data?.user) return null;
  return (
    <section className="mx-auto max-w-3xl space-y-8 py-10">
      <h1 className="text-2xl font-semibold">{t("account.profile.title")}</h1>
      <section className="space-y-4" aria-labelledby="profile-name">
        <h2 id="profile-name" className="text-lg font-semibold">
          {t("account.profile.editName")}
        </h2>
        <DisplayNameForm
          key={auth.data.user.displayName}
          initialName={auth.data.user.displayName}
          pending={profile.isPending}
          onSave={(name) => profile.mutate(name)}
        />
        {profile.isError && <IpcErrorMessage error={profile.error} />}
        {profile.isSuccess && <p role="status">{t("account.profile.saved")}</p>}
      </section>
      {auth.data.mode === "login" && (
        <section className="space-y-4" aria-labelledby="profile-password">
          <h2 id="profile-password" className="text-lg font-semibold">
            {t("account.profile.changePassword")}
          </h2>
          <p>{t("account.profile.passwordHint")}</p>
          <PasswordForm
            current
            confirm
            submitLabel="account.profile.changePassword"
            onSubmit={async ({
              currentPassword,
              password: newPassword,
              captcha,
            }) => {
              setPasswordSaved(false);
              await accountUserPasswordChange({
                currentPassword,
                newPassword,
                ...(captcha && { captcha }),
              });
              await refreshAuth(client);
              setPasswordSaved(true);
            }}
          />
          {passwordSaved && (
            <p role="status">{t("account.profile.passwordSaved")}</p>
          )}
        </section>
      )}
    </section>
  );
}
