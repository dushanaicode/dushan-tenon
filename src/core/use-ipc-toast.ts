import { useTranslation } from "react-i18next";
import { toast } from "@/kit";
import type { IpcError } from "@/lib/generated/IpcError";

export function useIpcErrorToast(): (error: IpcError) => void {
  const { t } = useTranslation();
  return (error) => {
    toast.error(t(`errors.${error.code}`, error.params), {
      description: t("error.traceId", { traceId: error.traceId }),
    });
  };
}
