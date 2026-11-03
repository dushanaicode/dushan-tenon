import { useTranslation } from "react-i18next";
import { usePermission } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { ParamForm } from "@/core/settings/param-form";
import { StatusPage } from "@/kit";

export default function DemoSettingsSection() {
  const { t } = useTranslation();
  const developerMode = useDeveloperMode();
  const canManage = usePermission("demo.settings.manage");
  if (!developerMode) return <StatusPage kind="notFound" />;
  if (!canManage) return <StatusPage kind="forbidden" />;
  return (
    <div className="flex flex-col gap-stack">
      <p className="text-body text-muted-foreground">
        {t("demo.settingsHint")}
      </p>
      <ParamForm includeDisabled={false} group="demo.work" />
    </div>
  );
}
