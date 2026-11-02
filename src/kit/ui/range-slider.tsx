// 套件自写；许可见项目根 LICENSE。
import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type RangeSliderProps = Pick<
  ComponentProps<typeof SliderPrimitive.Root>,
  "min" | "max" | "step" | "minStepsBetweenThumbs" | "disabled" | "className"
> & {
  value: readonly [number, number];
  onValueChange: (value: [number, number]) => void;
  thumbLabels: readonly [string, string];
};

export function RangeSlider({
  value,
  onValueChange,
  thumbLabels,
  className,
  ...props
}: RangeSliderProps) {
  return (
    <SliderPrimitive.Root
      {...props}
      value={[...value]}
      onValueChange={([lower, upper]) => onValueChange([lower, upper])}
      data-slot="range-slider"
      data-kit="range-slider"
      className={cn(
        "relative flex h-control w-full min-w-0 touch-none items-center select-none",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 forced-colors:data-[disabled]:opacity-100",
        className,
      )}
    >
      <SliderPrimitive.Track
        data-slot="range-slider-track"
        className="relative h-1.5 w-full grow overflow-hidden rounded-pill bg-muted forced-colors:bg-[Canvas]! forced-colors:border forced-colors:border-[CanvasText]"
      >
        <SliderPrimitive.Range
          data-slot="range-slider-range"
          className="absolute h-full bg-primary forced-colors:bg-[Highlight]!"
        />
      </SliderPrimitive.Track>
      {thumbLabels.map((label, index) => (
        <SliderPrimitive.Thumb
          // 两个固定位置分别承载下限 / 上限标签，标签文本可相同。
          key={index === 0 ? "lower" : "upper"}
          aria-label={label}
          data-slot="range-slider-thumb"
          className="relative block size-4 rounded-pill border border-border bg-primary after:absolute after:-inset-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-2 forced-colors:bg-[Highlight]! forced-colors:focus-visible:outline-[Highlight]"
        />
      ))}
    </SliderPrimitive.Root>
  );
}
