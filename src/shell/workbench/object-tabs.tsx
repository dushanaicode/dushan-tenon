import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ObjectRef } from "@/core/contracts/workbench";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  ScrollArea,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/kit";
import { useShellFocus } from "../shell-focus";
import { useWorkbenchObjects } from "./object-view";
import { objectKey } from "./objects";

export function ObjectTabs() {
  const objects = useWorkbenchObjects();
  const { t } = useTranslation();
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const focus = useShellFocus();
  const previousCount = useRef(objects.entries.length);
  useEffect(() => {
    if (previousCount.current > 0 && objects.entries.length === 0)
      focus.focus("content");
    previousCount.current = objects.entries.length;
  }, [objects.entries.length, focus]);
  if (objects.entries.length === 0 && objects.removed === 0) return null;
  const activeKey = objects.current
    ? objectKey(objects.current.object.ref)
    : "";
  function close(ref: ObjectRef) {
    const index = objects.entries.findIndex(
      ({ object }) => objectKey(object.ref) === objectKey(ref),
    );
    const neighbor = objects.entries[index + 1] ?? objects.entries[index - 1];
    if (neighbor) {
      tabs.current.get(objectKey(neighbor.object.ref))?.focus();
    }
    objects.close(ref);
  }
  return (
    <div className="shrink-0 border-b border-border" data-slot="object-tabs">
      {objects.removed > 0 && (
        <p role="status" className="px-3 text-body text-muted-foreground">
          {t("workbench.objects.removed", { count: objects.removed })}
        </p>
      )}
      {objects.entries.length > 0 && (
        <div className="flex h-9 min-w-0 items-center">
          <Tabs
            asChild
            value={activeKey}
            activationMode="manual"
            className="min-w-0 flex-1 gap-0"
            onValueChange={(key) => {
              const entry = objects.entries.find(
                ({ object }) => objectKey(object.ref) === key,
              );
              if (entry) void objects.activate(entry.object.ref);
            }}
          >
            <ScrollArea axis="x">
              <TabsList
                variant="line"
                aria-label={t("workbench.objects.title")}
                className="h-9 justify-start rounded-none"
              >
                {objects.entries.map(({ object }) => (
                  <div
                    key={objectKey(object.ref)}
                    className="flex h-9 shrink-0 items-center"
                  >
                    <TabsTrigger
                      ref={(element) => {
                        const key = objectKey(object.ref);
                        if (element) tabs.current.set(key, element);
                        return () => {
                          tabs.current.delete(key);
                        };
                      }}
                      value={objectKey(object.ref)}
                      data-object-key={objectKey(object.ref)}
                      id={`object-tab-${objectKey(object.ref)}`}
                      aria-controls="workbench-object-view"
                      title={object.title}
                      aria-label={object.title}
                      disabled={objects.pending}
                      className="max-w-64 rounded-none"
                      onFocus={(event) =>
                        event.currentTarget.scrollIntoView({
                          block: "nearest",
                          inline: "nearest",
                        })
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Delete" &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          close(object.ref);
                        }
                      }}
                    >
                      <Icon iconId={object.iconId} />
                      <span className="truncate">{object.title}</span>
                    </TabsTrigger>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0"
                      disabled={objects.pending}
                      aria-label={t("workbench.objects.close", {
                        title: object.title,
                      })}
                      onClick={() => close(object.ref)}
                    >
                      <Icon iconId="close" />
                    </Button>
                  </div>
                ))}
              </TabsList>
            </ScrollArea>
          </Tabs>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                aria-label={t("workbench.objects.all")}
              >
                <Icon iconId="menu" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {objects.entries.map(({ object }) => (
                <DropdownMenuItem
                  key={objectKey(object.ref)}
                  disabled={objects.pending}
                  onSelect={() => void objects.activate(object.ref)}
                >
                  {object.title}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={objects.pending}
                onSelect={objects.closeAll}
              >
                {t("workbench.objects.closeAll")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
