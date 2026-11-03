// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/kit";

export function ButtonExample() {
  const { t } = useTranslation();
  const [count, setCount] = useState(0);
  return (
    <Button onClick={() => setCount(count + 1)}>
      {t("showcase.buttons.add", { count })}
    </Button>
  );
}
