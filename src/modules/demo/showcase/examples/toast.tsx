// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, toast } from "@/kit";

export function ToastExample() {
  const { t } = useTranslation();
  const [last, setLast] = useState("showcase.feedback.toastReady");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            toast.success(t("showcase.feedback.toastSuccess"));
            setLast("showcase.feedback.toastSuccess");
          }}
        >
          {t("showcase.feedback.successToast")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            toast.error(t("showcase.feedback.toastError"));
            setLast("showcase.feedback.toastError");
          }}
        >
          {t("showcase.feedback.errorToast")}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            toast(t("showcase.feedback.toastInfo"));
            setLast("showcase.feedback.toastInfo");
          }}
        >
          {t("showcase.feedback.infoToast")}
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {t(last)}
      </p>
    </div>
  );
}
