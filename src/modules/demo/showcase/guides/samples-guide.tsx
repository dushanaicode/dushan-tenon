import DemoSamplesPage from "../../samples-page";
import { ShowcaseGuide } from "./showcase-guide";

export function SamplesGuide() {
  return (
    <div className="flex min-w-0 flex-col gap-stack">
      <ShowcaseGuide id="samples" />
      <DemoSamplesPage />
    </div>
  );
}
