// showcase-example
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, VirtualList, VirtualLog } from "@/kit";

export function VirtualLogExample() {
  const { t } = useTranslation();
  const [count, setCount] = useState(1000);
  const [selected, setSelected] = useState<number | null>(null);
  const items = useMemo(
    () => Array.from({ length: count }, (_, index) => index + 1),
    [count],
  );
  const lines = useMemo(
    () =>
      items.map(
        (number) =>
          `${String(number).padStart(6, "0")}  INFO  ${t("showcase.display.virtualRow", { number })}${number % 25 === 0 ? ` — ${t("showcase.display.virtualLong")}` : ""}`,
      ),
    [items, t],
  );
  return (
    <section className="min-w-0 space-y-3">
      <h3 className="font-semibold">{t("showcase.display.virtualTitle")}</h3>
      <p className="text-sm text-muted-foreground">
        {t("showcase.display.virtualDescription")}
      </p>
      <div className="flex flex-wrap gap-2">
        {[1000, 100000].map((value) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={count === value}
            onClick={() => {
              setCount(value);
              setSelected(null);
            }}
          >
            {t("showcase.display.virtualCount", { count: value })}
          </Button>
        ))}
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {t("showcase.display.virtualSelected", { number: selected ?? "—" })}
      </p>
      <div className="grid min-w-0 gap-4 @3xl:grid-cols-2">
        <VirtualList
          label={t("showcase.display.virtualList")}
          items={items}
          getKey={(item) => item}
          estimateSize={44}
          renderItem={(item) => (
            <div className="p-1">
              <Button
                variant="ghost"
                className="w-full justify-start"
                aria-pressed={selected === item}
                onClick={() => setSelected(item)}
              >
                {t("showcase.display.virtualRow", { number: item })}
              </Button>
            </div>
          )}
        />
        <VirtualLog label={t("showcase.display.virtualLog")} lines={lines} />
      </div>
    </section>
  );
}
