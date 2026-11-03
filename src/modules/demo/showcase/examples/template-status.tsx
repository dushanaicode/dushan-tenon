// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, StatusPage, type StatusPageKind } from "@/kit";

const kinds = [
  { id: "empty", label: "showcase.templates.empty" },
  { id: "error", label: "showcase.templates.error" },
  { id: "forbidden", label: "showcase.templates.forbidden" },
  { id: "notFound", label: "showcase.templates.notFound" },
  { id: "loading", label: "showcase.templates.loading" },
] as const;
export function TemplateStatusExample() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<StatusPageKind>("empty");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {kinds.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            aria-pressed={kind === item.id}
            onClick={() => setKind(item.id)}
          >
            {t(item.label)}
          </Button>
        ))}
      </div>
      <StatusPage
        kind={kind}
        description={t(
          kind === "error"
            ? "showcase.templates.statusErrorReason"
            : "showcase.templates.statusDescription",
        )}
        onRetry={() => setKind("empty")}
        action={
          <Button onClick={() => setKind("loading")}>
            {t("showcase.templates.startLoading")}
          </Button>
        }
      />
    </div>
  );
}
