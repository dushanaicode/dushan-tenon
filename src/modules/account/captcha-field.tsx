import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, Input } from "@/kit";
import type { CaptchaAnswer } from "@/lib/generated/CaptchaAnswer";
import type { CaptchaChallenge } from "@/lib/generated/CaptchaChallenge";
import { accountAuthCaptcha } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";

export function useCaptcha(alwaysRequired = false) {
  const [required, setRequired] = useState(alwaysRequired);
  const [answer, setAnswer] = useState("");
  const request = useMutation<CaptchaChallenge, IpcError>({
    mutationFn: accountAuthCaptcha,
    gcTime: 0,
  });
  const { mutate } = request;
  useEffect(() => {
    if (alwaysRequired) mutate();
  }, [alwaysRequired, mutate]);
  function refresh() {
    setAnswer("");
    request.mutate();
  }
  const value: CaptchaAnswer | undefined =
    required && request.isSuccess ? { id: request.data.id, answer } : undefined;
  return {
    required,
    request,
    answer,
    setAnswer,
    value,
    refresh,
    onError(error: IpcError) {
      if (
        error.code === "account.auth.captcha_required" ||
        error.code === "account.auth.captcha_invalid" ||
        (required && error.code === "account.auth.invalid_credentials")
      ) {
        setRequired(true);
        refresh();
      }
    },
    reset() {
      setRequired(alwaysRequired);
      setAnswer("");
      request.reset();
    },
  };
}

export function CaptchaField({
  captcha,
  disabled,
}: {
  captcha: ReturnType<typeof useCaptcha>;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  if (!captcha.required) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        {captcha.request.isSuccess && (
          <img
            src={captcha.request.data.image}
            alt={t("account.auth.captchaImage")}
            width={160}
            height={56}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          aria-label={t("account.auth.refreshCaptcha")}
          disabled={disabled || captcha.request.isPending}
          onClick={captcha.refresh}
        >
          {t("account.auth.refreshCaptcha")}
        </Button>
      </div>
      {captcha.request.isPending && (
        <p role="status">{t("account.auth.captchaLoading")}</p>
      )}
      {captcha.request.isError && (
        <IpcErrorMessage error={captcha.request.error} />
      )}
      <label htmlFor={id} className="block space-y-2">
        {t("account.auth.captcha")}
        <Input
          id={id}
          value={captcha.answer}
          onChange={(event) => captcha.setAnswer(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </label>
    </div>
  );
}
