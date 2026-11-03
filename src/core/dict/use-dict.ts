import { useTranslation } from "react-i18next";
import type { DictTone } from "@/lib/generated/DictTone";
import { DICTIONARIES, type DictCode } from "@/lib/generated/dict-codes";

export function useDict(code: DictCode) {
  const { t } = useTranslation();
  const items = DICTIONARIES[code];
  function label(value: string): string {
    return items.some((item) => item.value === value)
      ? t(`dict.${code}.${value}`)
      : value;
  }
  return {
    name: t(`dict.${code}`),
    label,
    tone(value: string): DictTone {
      return items.find((item) => item.value === value)?.tone ?? "neutral";
    },
    options() {
      return items.map((item) => ({
        value: item.value,
        label: label(item.value),
        tone: item.tone,
      }));
    },
  };
}
