import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useAppSettings } from "@/core/app-settings";
import { authKey, useAuthStatus } from "@/core/auth";
import type { ModuleManifest } from "@/core/contracts/module";
import {
  appModulesQuery,
  canOpenPath,
  useCanOpen,
  useEnabledModules,
} from "@/core/enabled-modules";
import { IpcErrorMessage } from "@/core/ipc-error";
import { routeOfPath, useModuleDirectory } from "@/core/module-directory";
import { evaluateVisibility, type VisibilityAuth } from "@/core/visibility";
import { onWindowEvent } from "@/core/window-events";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Icon,
  ScrollArea,
} from "@/kit";
import {
  appFileIngressClaim,
  appFileIngressDismiss,
  appFileIngressList,
  appFileRecentOpen,
} from "@/lib/generated/commands";
import type { FileIngressItem } from "@/lib/generated/FileIngressItem";
import type { FileIngressSnapshot } from "@/lib/generated/FileIngressSnapshot";
import type { FilePicked } from "@/lib/generated/FilePicked";
import type { IpcError } from "@/lib/generated/IpcError";

type FileTarget = ModuleManifest["fileTargets"][number];
type Transfer = { scope: string; target: string; file: FilePicked };
const Ingress = createContext<{
  transfer: Transfer | null;
  clear: () => void;
  open: () => void;
  count: number;
  available: boolean;
} | null>(null);

export function visibleFileTargets(
  modules: readonly ModuleManifest[],
  enabled: ReadonlySet<string>,
  auth: VisibilityAuth,
) {
  return modules.flatMap((module) =>
    enabled.has(module.id)
      ? module.fileTargets.filter((target) => {
          const route = routeOfPath(module, target.path);
          return (
            route &&
            evaluateVisibility(route, auth) === "visible" &&
            evaluateVisibility(target, auth) === "visible"
          );
        })
      : [],
  );
}

function RouteRequest({
  request,
  pending,
  open,
  dismiss,
}: {
  request: Extract<FileIngressItem, { type: "route" }>;
  pending: boolean;
  open: () => void;
  dismiss: () => void;
}) {
  const { t } = useTranslation();
  const allowed = useCanOpen(request.path);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <span className="min-w-0 flex-1 break-all">{request.path}</span>
      <Button disabled={pending || !allowed} onClick={open}>
        {t("fileIngress.openPage")}
      </Button>
      <Button variant="ghost" disabled={pending} onClick={dismiss}>
        {t("fileIngress.dismiss")}
      </Button>
      {!allowed && (
        <p className="w-full text-sm text-muted-foreground">
          {t("fileIngress.unavailableRoute")}
        </p>
      )}
    </div>
  );
}

export function FileIngressProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation(),
    navigate = useNavigate(),
    client = useQueryClient();
  const manifests = useModuleDirectory();
  const auth = useAuthStatus();
  const owner =
    (auth.isSuccess || auth.error?.code === "app.operation.busy") &&
    auth.data?.state === "active"
      ? auth.data.user?.id
      : undefined;
  const settings = useAppSettings(),
    modules = useEnabledModules();
  const moduleSnapshot = client.getQueryData(appModulesQuery.queryKey);
  const scope = `${owner}:${auth.data?.mode}:${auth.data?.permissions.join(",")}`;
  const mounted = useRef(false);
  const [open, setOpen] = useState(false),
    [transfer, setTransfer] = useState<Transfer | null>(null);
  const observed = useRef(new Set<string>()),
    priorScope = useRef(scope);
  const queryKey = ["app", "file-ingress", owner];
  const query = useQuery<FileIngressSnapshot, IpcError>({
    queryKey,
    queryFn: appFileIngressList,
    enabled: owner !== undefined,
    retry: false,
  });
  const visibility =
    auth.data && settings.isSuccess
      ? {
          authenticated: owner !== undefined,
          developerMode: settings.data.developerMode.value,
          mode: auth.data.mode,
          permissions: auth.data.permissions,
        }
      : undefined;
  const targets =
    visibility && modules.enabled
      ? visibleFileTargets(manifests, modules.enabled, visibility)
      : [];
  const current = useRef({
    scope,
    targets,
    manifests,
    enabled: modules.enabled,
    visibility,
  });
  current.current = {
    scope,
    targets,
    manifests,
    enabled: modules.enabled,
    visibility,
  };
  const selected =
    transfer !== null &&
    transfer.scope === scope &&
    targets.some((target) => target.id === transfer.target)
      ? transfer
      : null;
  const action = useMutation<void, IpcError, () => Promise<void>>({
    mutationFn: (run) => run(),
    onSuccess: () => client.invalidateQueries({ queryKey }),
    retry: false,
    gcTime: 0,
  });
  useEffect(() => {
    if (transfer && !selected) setTransfer(null);
  }, [transfer, selected]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (priorScope.current !== scope) {
      observed.current.clear();
      setTransfer(null);
      setOpen(false);
      action.reset();
      priorScope.current = scope;
    }
  }, [scope, action.reset]);
  useEffect(() => {
    return onWindowEvent("tenon:files-changed", () => {
      void client.invalidateQueries({ queryKey: ["app", "file-ingress"] });
    });
  }, [client]);
  useEffect(() => {
    if (!owner || !query.data) return;
    const ids = query.data.pending.map((item) => item.id);
    if (query.data.issue) ids.push(`issue:${query.data.issue}`);
    if (query.data.skippedDirectories)
      ids.push(`folders:${query.data.skippedDirectories}`);
    if (ids.some((id) => !observed.current.has(id))) setOpen(true);
    for (const id of ids) observed.current.add(id);
  }, [owner, query.data]);
  function dismiss(id: string) {
    action.mutate(async () => {
      await appFileIngressDismiss({ ids: [id], clearRecent: false });
    });
  }
  function claim(id: string, target: FileTarget) {
    action.mutate(async () => {
      const file = await appFileIngressClaim({ id, purpose: target.purpose });
      if (
        !mounted.current ||
        client.getQueryData(authKey) !== auth.data ||
        client.getQueryData(["app", "settings"]) !== settings.data ||
        client.getQueryData(appModulesQuery.queryKey) !== moduleSnapshot ||
        current.current.scope !== scope ||
        !current.current.targets.includes(target)
      )
        return;
      setTransfer({ scope, target: target.id, file });
      setOpen(false);
      navigate(target.path);
    });
  }
  return (
    <Ingress.Provider
      value={{
        transfer: selected,
        clear: () =>
          setTransfer((current) => (current === selected ? null : current)),
        open: () => setOpen(true),
        count: query.data?.pending.length ?? 0,
        available:
          owner !== undefined &&
          (targets.length > 0 ||
            (query.data !== undefined &&
              (query.data.pending.length > 0 ||
                query.data.recent.length > 0 ||
                query.data.issue !== null ||
                query.data.skippedDirectories > 0))),
      }}
    >
      {children}
      <Dialog open={open && owner !== undefined} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-2xl"
          aria-describedby={undefined}
        >
          <DialogHeader className="shrink-0 px-panel pt-(--panel-pad)">
            <DialogTitle>{t("fileIngress.title")}</DialogTitle>
          </DialogHeader>
          <ScrollArea
            region="content"
            className="min-h-0 flex-1"
            plateClassName="flex flex-col gap-stack px-panel pt-(--stack-gap) pb-(--panel-pad)"
          >
            <p className="text-sm text-muted-foreground">
              {t("fileIngress.hint")}
            </p>
            {query.isError && <IpcErrorMessage error={query.error} />}
            {action.isError && <IpcErrorMessage error={action.error} />}
            {query.data?.issue && (
              <p role="alert">{t(`errors.${query.data.issue}`)}</p>
            )}
            {!!query.data?.skippedDirectories && (
              <p role="status">
                {t("fileIngress.skipped", {
                  count: query.data.skippedDirectories,
                })}
              </p>
            )}
            {selected && (
              <p role="status" className="text-sm">
                {t("fileIngress.selected", { name: selected.file.fileName })}
                <Button variant="ghost" onClick={() => setTransfer(null)}>
                  {t("fileIngress.dismiss")}
                </Button>
              </p>
            )}
            <section
              className="space-y-2"
              aria-label={t("fileIngress.pending")}
            >
              <h3 className="font-semibold">{t("fileIngress.pending")}</h3>
              {query.data?.pending.map((item) =>
                item.type === "route" ? (
                  <RouteRequest
                    key={item.id}
                    request={item}
                    pending={action.isPending}
                    dismiss={() => dismiss(item.id)}
                    open={() =>
                      action.mutate(async () => {
                        await appFileIngressDismiss({
                          ids: [item.id],
                          clearRecent: false,
                        });
                        const latest = current.current;
                        if (
                          !mounted.current ||
                          client.getQueryData(authKey) !== auth.data ||
                          client.getQueryData(["app", "settings"]) !==
                            settings.data ||
                          client.getQueryData(appModulesQuery.queryKey) !==
                            moduleSnapshot ||
                          latest.scope !== scope ||
                          !canOpenPath(
                            latest.manifests,
                            latest.enabled,
                            latest.visibility,
                            item.path,
                          )
                        )
                          return;
                        setOpen(false);
                        navigate(item.path);
                      })
                    }
                  />
                ) : (
                  <div
                    key={item.id}
                    className="space-y-2 rounded-md border border-border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 break-all">
                        {item.name}
                      </span>
                      <Badge>{item.extension}</Badge>
                      <Button
                        variant="ghost"
                        disabled={action.isPending}
                        onClick={() => dismiss(item.id)}
                      >
                        {t("fileIngress.dismiss")}
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {targets
                        .filter((target) =>
                          target.extensions.includes(item.extension),
                        )
                        .map((target) => (
                          <Button
                            key={target.id}
                            variant="outline"
                            disabled={action.isPending || selected !== null}
                            onClick={() => claim(item.id, target)}
                          >
                            {t("fileIngress.handleWith", {
                              target: t(target.labelKey),
                            })}
                          </Button>
                        ))}
                    </div>
                    {!targets.some((target) =>
                      target.extensions.includes(item.extension),
                    ) && (
                      <p className="text-sm text-muted-foreground">
                        {t("fileIngress.noTarget")}
                      </p>
                    )}
                  </div>
                ),
              )}
              {query.data?.pending.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("fileIngress.empty")}
                </p>
              )}
            </section>
            <section className="space-y-2" aria-label={t("fileIngress.recent")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{t("fileIngress.recent")}</h3>
                <Button
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate(async () => {
                      await appFileIngressDismiss({
                        ids: [],
                        clearRecent: true,
                      });
                    })
                  }
                >
                  {t("fileIngress.clearRecent")}
                </Button>
              </div>
              {query.data?.recent.map(
                (item) =>
                  item.type === "file" && (
                    <div key={item.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {item.name}
                      </span>
                      <Button
                        variant="outline"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate(async () => {
                            await appFileRecentOpen({ id: item.id });
                          })
                        }
                      >
                        {t("fileIngress.reopen")}
                      </Button>
                    </div>
                  ),
              )}
            </section>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </Ingress.Provider>
  );
}

export function FileIngressButton() {
  const { t } = useTranslation(),
    context = useContext(Ingress);
  if (!context) throw new Error("FileIngressProvider is required");
  if (!context.available) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t("fileIngress.title")}
      onClick={context.open}
    >
      <Icon iconId="files" />
      {context.count > 0 && <span className="text-xs">{context.count}</span>}
    </Button>
  );
}

/** Optional incoming-file channel; the same page still supports its own file picker. */
export function useIncomingFile(target: string) {
  const context = useContext(Ingress);
  return context?.transfer?.target === target
    ? { file: context.transfer.file, clear: context.clear }
    : null;
}
