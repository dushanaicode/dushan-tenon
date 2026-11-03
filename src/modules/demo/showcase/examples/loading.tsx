// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Loading, Skeleton } from "@/kit";

export function LoadingExample() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  return (
    <div className="space-y-3">
      <div aria-busy={loading} className="space-y-3">
        {loading ? (
          <>
            <Loading label={t("showcase.feedback.loading")} />
            <div aria-hidden="true" className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </>
        ) : (
          <p role="status">{t("showcase.feedback.loaded")}</p>
        )}
      </div>
      <Button variant="outline" onClick={() => setLoading(!loading)}>
        {t(
          loading
            ? "showcase.feedback.finishLoading"
            : "showcase.feedback.reload",
        )}
      </Button>
    </div>
  );
}
