import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { refreshAuth } from "@/core/auth";
import { Button } from "@/kit";
import { accountAuthRecover } from "@/lib/generated/commands";
import { PasswordForm } from "@/modules/account/password-form";

export function RecoverForm({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [entering, setEntering] = useState(false);
  if (remaining !== null)
    return (
      <>
        <h1 className="text-2xl font-semibold">{t("account.auth.recover")}</h1>
        <p role="status">{t("account.auth.recovered", { count: remaining })}</p>
        <Button
          disabled={entering}
          onClick={async () => {
            setEntering(true);
            await refreshAuth(client);
            onBack();
          }}
        >
          {t("account.auth.enter")}
        </Button>
      </>
    );
  return (
    <>
      <h1 className="text-2xl font-semibold">{t("account.auth.recover")}</h1>
      <PasswordForm
        submitLabel="account.auth.resetPassword"
        confirm
        recovery
        onSubmit={async ({ password, recoveryCode, captcha }) => {
          const result = await accountAuthRecover({
            recoveryCode,
            newPassword: password,
            ...(captcha && { captcha }),
          });
          setRemaining(result.remainingCodes);
        }}
      />
      <Button variant="ghost" onClick={onBack}>
        {t("account.auth.backToLogin")}
      </Button>
    </>
  );
}
