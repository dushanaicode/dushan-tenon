import DemoMeasurePage from "../../measure-page";
import { ShowcaseGuide } from "./showcase-guide";

export function MeasureGuide() {
  return (
    <div className="flex min-w-0 flex-col gap-stack">
      <ShowcaseGuide id="measure" />
      <DemoMeasurePage />
    </div>
  );
}
