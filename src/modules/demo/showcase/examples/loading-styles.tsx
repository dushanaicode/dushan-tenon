// showcase-example
import { Loading } from "@/kit";

export function LoadingStylesExample() {
  return (
    <div className="grid gap-stack sm:grid-cols-2">
      <Loading size="block" />
      <Loading size="page" />
    </div>
  );
}
