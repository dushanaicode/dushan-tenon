import { LockKeyhole, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionActions } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button } from "@/kit";

export function SessionActions({ locked = false }: { locked?: boolean }) {
  const { t } = useTranslation();
  const mutation = useSessionActions();
  return (
    <div
      className={
        locked
          ? "flex flex-col items-center gap-stack"
          : "flex items-center gap-2"
      }
    >
      {!locked && (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("account.auth.lock")}
          title={t("account.auth.lock")}
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("lock")}
        >
          <LockKeyhole aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size={locked ? "default" : "icon"}
        aria-label={t("account.auth.logout")}
        title={t("account.auth.logout")}
        disabled={mutation.isPending}
        onClick={() => mutation.mutate("logout")}
      >
        <LogOut aria-hidden="true" />
        {locked && t("account.auth.logout")}
      </Button>
      {mutation.isError && <IpcErrorMessage error={mutation.error} />}
    </div>
  );
}
