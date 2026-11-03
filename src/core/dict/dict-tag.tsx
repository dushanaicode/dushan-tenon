import { useDict } from "@/core/dict/use-dict";
import { Badge } from "@/kit";
import type { DictCode } from "@/lib/generated/dict-codes";

export function DictTag({ code, value }: { code: DictCode; value: string }) {
  const dict = useDict(code);
  return <Badge tone={dict.tone(value)}>{dict.label(value)}</Badge>;
}
