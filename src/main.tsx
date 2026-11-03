import { createRoot } from "react-dom/client";
import { startApp } from "@/app/bootstrap";
import { getInitialSettings } from "@/core/appearance-bridge";
import { i18n } from "@/core/i18n";
import { ErrorView } from "@/kit";
import "@/app/styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("缺少应用挂载节点 #root");

try {
  await startApp(root, getInitialSettings());
} catch (error) {
  createRoot(root).render(
    <ErrorView
      message={i18n.t("recovery.title")}
      detail={
        error instanceof Error
          ? error.message
          : i18n.t("errors.app.ipc.unexpected")
      }
    />,
  );
}
