// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, ConfirmDialog } from "@/kit";

export function ConfirmDialogExample() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"normal" | "danger" | null>(null);
  const [result, setResult] = useState("showcase.overlays.noAction");
  const dialogProps = {
    open: kind !== null,
    onOpenChange: (open: boolean) => {
      if (!open) setKind(null);
    },
    title: t(
      kind === "danger"
        ? "showcase.overlays.removeTitle"
        : "showcase.overlays.finishTitle",
    ),
    description: t("showcase.overlays.confirmDescription"),
    cancelLabel: t("showcase.overlays.cancel"),
    onConfirm: () => {
      setResult(
        kind === "danger"
          ? "showcase.overlays.removed"
          : "showcase.overlays.finished",
      );
      setKind(null);
    },
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => setKind("normal")}>
          {t("showcase.overlays.normalConfirm")}
        </Button>
        <Button variant="destructive" onClick={() => setKind("danger")}>
          {t("showcase.overlays.dangerConfirm")}
        </Button>
      </div>
      {kind === "danger" ? (
        <ConfirmDialog
          {...dialogProps}
          confirmLabel={t("showcase.overlays.remove")}
          tone="destructive"
        />
      ) : (
        <ConfirmDialog
          {...dialogProps}
          confirmLabel={t("showcase.overlays.finish")}
        />
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {t(result)}
      </p>
    </div>
  );
}
