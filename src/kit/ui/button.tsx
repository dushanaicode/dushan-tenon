// Adapted from shadcn/ui's MIT-licensed new-york Button; semantic kit tokens.
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-control text-body font-medium focus-visible:outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring",
    "disabled:pointer-events-none disabled:opacity-50",
    "kit-icon-control [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground",
          "hover:bg-primary-hover active:bg-primary-active",
        ],
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline:
          "border border-input bg-card text-card-foreground hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: [
          "bg-destructive text-destructive-foreground",
          "hover:bg-destructive-hover",
        ],
        link: "text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-control px-4 py-2",
        icon: "size-control",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    overlay?: ReactNode;
  };

export type ButtonFaceProps = ComponentProps<"span">;

export function ButtonFace({ className, ...props }: ButtonFaceProps) {
  return (
    <span
      className={cn(
        "inline-flex min-w-0 flex-1 [align-items:inherit] [justify-content:inherit] gap-[inherit]",
        className,
      )}
      {...props}
      data-part="face"
    />
  );
}

export function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  children,
  overlay,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      data-kit="button"
      data-variant={variant}
      data-size={size}
    >
      {asChild ? (
        <Slot.Slottable>{children}</Slot.Slottable>
      ) : (
        <ButtonFace>{children}</ButtonFace>
      )}
      {overlay != null && (
        <span data-part="overlay" className="contents">
          {overlay}
        </span>
      )}
    </Component>
  );
}
