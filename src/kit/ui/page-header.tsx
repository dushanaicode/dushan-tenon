// Original kit component.
import { createContext, type ReactNode, useContext } from "react";
import { cn } from "@/lib/utils";
import { usePageTitleRef } from "../page-title-focus";

export type PageHeadingLevelProviderProps = {
  level: 2 | 3 | 4 | 5 | 6;
  children: ReactNode;
};

const PageHeadingLevelContext = createContext<
  1 | PageHeadingLevelProviderProps["level"]
>(1);

export function PageHeadingLevelProvider({
  level,
  children,
}: PageHeadingLevelProviderProps) {
  return (
    <PageHeadingLevelContext value={level}>{children}</PageHeadingLevelContext>
  );
}

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  leading?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  actions,
  leading,
  className,
}: PageHeaderProps) {
  const Heading = `h${useContext(PageHeadingLevelContext)}` as const;
  const titleRef = usePageTitleRef(title, Heading === "h1");
  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex flex-col gap-stack sm:flex-row sm:flex-wrap sm:items-start",
        className,
      )}
    >
      <div className="flex min-w-0 flex-none items-start gap-stack sm:flex-[1_1_16rem]">
        {leading}
        <div className="flex min-w-0 flex-col gap-2">
          <Heading
            ref={titleRef}
            data-part="title"
            className="text-2xl font-semibold tracking-tight"
          >
            {title}
          </Heading>
          {description != null && (
            <p
              data-part="description"
              className="text-body text-muted-foreground"
            >
              {description}
            </p>
          )}
        </div>
      </div>
      {actions != null && (
        <div className="ml-auto flex flex-wrap items-center gap-stack">
          {actions}
        </div>
      )}
    </header>
  );
}
