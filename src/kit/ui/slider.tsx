// 套件自写；许可见项目根 LICENSE。
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SliderProps = Omit<ComponentProps<"input">, "type">;

/** 用 Label 的 htmlFor 或 FormField 的 control 关联可见标签。 */
export function Slider({ className, ...props }: SliderProps) {
  return (
    <input
      {...props}
      type="range"
      data-slot="slider"
      className={cn(
        // 保留原生 appearance，accent-color 同步填充段与滑块，无独立值状态。
        "h-control w-full min-w-0 cursor-pointer accent-primary",
        "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "[&::-webkit-slider-runnable-track]:rounded-pill [&::-webkit-slider-runnable-track]:bg-muted",
        "[&::-webkit-slider-thumb]:rounded-pill [&::-webkit-slider-thumb]:bg-primary",
        "forced-colors:accent-[Highlight] forced-colors:disabled:opacity-100",
        "forced-colors:[&::-webkit-slider-runnable-track]:bg-[Canvas]",
        "forced-colors:[&::-webkit-slider-thumb]:bg-[Highlight]",
        "forced-colors:focus-visible:outline-[Highlight]",
        className,
      )}
    />
  );
}
