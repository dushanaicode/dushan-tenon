import { useMutation } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, FormField, Input, SettingRow } from "@/kit";
import type { CaptchaAnswer } from "@/lib/generated/CaptchaAnswer";
import type { IpcError } from "@/lib/generated/IpcError";
import { CaptchaField, useCaptcha } from "@/modules/account/captcha-field";

type Credentials = {
  password: string;
  recoveryCode: string;
  currentPassword: string;
  captcha?: CaptchaAnswer;
};

function PasswordField({
  settingsLayout,
  label,
  ...input
}: ComponentProps<typeof Input> & {
  settingsLayout: boolean;
  label: ReactNode;
}) {
  return settingsLayout ? (
    <SettingRow label={label}>
      {(control) => <Input {...input} {...control} />}
    </SettingRow>
  ) : (
    <FormField label={label}>
      {(control) => <Input {...input} {...control} />}
    </FormField>
  );
}

export function PasswordForm({
  submitLabel,
  confirm = false,
  recovery = false,
  current = false,
  settingsLayout = false,
  onSubmit,
}: {
  submitLabel: string;
  confirm?: boolean;
  recovery?: boolean;
  current?: boolean;
  settingsLayout?: boolean;
  onSubmit: (credentials: Credentials) => Promise<void>;
}) {
  const { t } = useTranslation();
  const captcha = useCaptcha();
  const [validationError, setValidationError] = useState<
    "account.auth.required" | "account.auth.passwordMismatch" | null
  >(null);
  const mutation = useMutation<void, IpcError, Credentials>({
    mutationFn: onSubmit,
    onError: captcha.onError,
    gcTime: 0,
  });
  return (
    <form
      noValidate
      className={
        settingsLayout
          ? "flex min-w-0 flex-col gap-4"
          : "flex max-w-md flex-col gap-4"
      }
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const password = String(data.get("password"));
        if (
          !password ||
          (confirm && !data.get("confirm")) ||
          (recovery && !data.get("recoveryCode")) ||
          (current && !data.get("currentPassword")) ||
          (captcha.required && (!captcha.value || !captcha.answer.trim()))
        ) {
          setValidationError("account.auth.required");
          return;
        }
        if (confirm && password !== data.get("confirm")) {
          setValidationError("account.auth.passwordMismatch");
          return;
        }
        setValidationError(null);
        mutation.mutate(
          {
            password,
            recoveryCode: recovery ? String(data.get("recoveryCode")) : "",
            currentPassword: current ? String(data.get("currentPassword")) : "",
            ...(captcha.value && { captcha: captcha.value }),
          },
          {
            onSuccess: () => {
              form.reset();
              captcha.reset();
            },
          },
        );
      }}
    >
      {recovery && (
        <PasswordField
          settingsLayout={settingsLayout}
          label={t("account.auth.recoveryCode")}
          name="recoveryCode"
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {current && (
        <PasswordField
          settingsLayout={settingsLayout}
          label={t("account.profile.currentPassword")}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
        />
      )}
      <PasswordField
        settingsLayout={settingsLayout}
        label={t(
          recovery || current
            ? "account.auth.newPassword"
            : "account.auth.password",
        )}
        name="password"
        type="password"
        autoComplete={confirm ? "new-password" : "current-password"}
      />
      {confirm && (
        <>
          <p className="text-sm text-muted-foreground">
            {t("account.auth.passwordHint")}
          </p>
          <PasswordField
            settingsLayout={settingsLayout}
            label={t(
              recovery || current
                ? "account.auth.confirmNewPassword"
                : "account.auth.confirmPassword",
            )}
            name="confirm"
            type="password"
            autoComplete="new-password"
          />
        </>
      )}
      <CaptchaField captcha={captcha} disabled={mutation.isPending} />
      {validationError && <p role="alert">{t(validationError)}</p>}
      {mutation.isError && (
        <IpcErrorMessage
          error={mutation.error}
          message={
            recovery &&
            mutation.error.code === "account.auth.invalid_credentials"
              ? t("account.auth.recoveryInvalid")
              : undefined
          }
        />
      )}
      <Button
        type="submit"
        disabled={mutation.isPending || captcha.request.isPending}
      >
        {t(submitLabel)}
      </Button>
    </form>
  );
}
