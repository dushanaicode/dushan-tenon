// showcase-example
import { useTranslation } from "react-i18next";
import { Timeline } from "@/kit";

export const displayRecord = {
  nameKey: "showcase.display.sampleName",
  completed: 3,
  total: 4,
  stages: [
    {
      id: "created",
      titleKey: "showcase.display.created",
      time: "09:00",
      tone: "neutral",
    },
    {
      id: "checked",
      titleKey: "showcase.display.checked",
      time: "09:10",
      tone: "success",
    },
    {
      id: "running",
      titleKey: "showcase.display.running",
      time: "09:20",
      tone: "info",
    },
  ],
} as const;

export function TimelineExample() {
  const { t } = useTranslation();
  return (
    <Timeline
      items={displayRecord.stages.map((stage) => ({
        id: stage.id,
        title: t(stage.titleKey),
        time: stage.time,
        tone: stage.tone,
        description: t(displayRecord.nameKey),
      }))}
    />
  );
}
