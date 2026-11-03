import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { useAuthStatus } from "@/core/auth";
import { useEnabledModules } from "@/core/enabled-modules";
import { renderMessage } from "@/core/i18n/message";
import { IpcErrorMessage } from "@/core/ipc-error";
import { useJobPath } from "@/core/jobs/job-link";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from "@/kit";
import {
  notifyList,
  notifyMarkAllRead,
  notifyMarkRead,
  notifyUnreadCount,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { NotificationItem } from "@/lib/generated/NotificationItem";
import type { Page } from "@/lib/generated/Page";
import { cn } from "@/lib/utils";

export function useNotifications() {
  const auth = useAuthStatus();
  const { enabled } = useEnabledModules();
  return {
    key: ["notify", "notifications", auth.data?.user?.id],
    active:
      (auth.isSuccess || auth.error?.code === "app.operation.busy") &&
      auth.data?.state === "active" &&
      Boolean(enabled?.has("notify")),
  };
}

export function useNotificationList(
  page: number,
  pageSize: number,
  unreadOnly: boolean,
  open = true,
) {
  const { key, active } = useNotifications();
  return useQuery<Page<NotificationItem>, IpcError>({
    queryKey: [...key, "list", page, pageSize, unreadOnly],
    queryFn: async ({ signal }) => {
      const result = await notifyList({ page, pageSize, unreadOnly });
      signal.throwIfAborted();
      return result;
    },
    enabled: active && open,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
}

export function useMarkRead() {
  const client = useQueryClient();
  const { key, active } = useNotifications();
  const mutation = useMutation<null, IpcError, string[] | undefined>({
    mutationFn: (ids) => (ids ? notifyMarkRead({ ids }) : notifyMarkAllRead()),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
  return {
    isPending: mutation.isPending,
    error: mutation.error,
    active,
    mutate: (...args: Parameters<typeof mutation.mutate>) => {
      if (active) mutation.mutate(...args);
    },
  };
}

function relativeTime(createdAt: string, language: string, now: number) {
  const seconds = (new Date(createdAt).getTime() - now) / 1000;
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  for (const [unit, size] of [
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (Math.abs(seconds) >= size)
      return format.format(Math.round(seconds / size), unit);
  }
  return format.format(Math.round(seconds), "second");
}

function NotificationList({
  items,
  now,
  onOpened,
  page = false,
}: {
  items: NotificationItem[];
  now: number;
  onOpened?: () => void;
  page?: boolean;
}) {
  const { t } = useTranslation();
  const mark = useMarkRead();
  return (
    <>
      {mark.error && <IpcErrorMessage error={mark.error} />}
      {items.length === 0 && (
        <p className="p-5 text-sm text-muted-foreground">{t("notify.empty")}</p>
      )}
      <ul className="divide-y divide-border">
        {items.map((item) => (
          <NotificationRow
            key={item.id}
            item={item}
            now={now}
            mark={mark}
            onOpened={onOpened}
            page={page}
          />
        ))}
      </ul>
    </>
  );
}

function NotificationRow({
  item,
  now,
  mark,
  onOpened,
  page,
}: {
  item: NotificationItem;
  now: number;
  mark: ReturnType<typeof useMarkRead>;
  onOpened?: () => void;
  page: boolean;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const path = useJobPath(item.jobId);
  const target = useRef(path);
  target.current = path;
  return (
    <li
      className={cn("flex items-center gap-3", !item.readAt && "bg-accent/50")}
    >
      <button
        type="button"
        disabled={mark.isPending}
        className="min-w-0 flex-1 space-y-2 p-4 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        onClick={() =>
          mark.mutate([item.id], {
            onSuccess: () => {
              onOpened?.();
              if (target.current) void navigate(target.current);
            },
          })
        }
      >
        <span className="flex items-center gap-2 font-medium">
          {!item.readAt && (
            <span className="size-2 shrink-0 rounded-full bg-primary">
              <span className="sr-only">{t("notify.unread")}</span>
            </span>
          )}
          {renderMessage(i18n, item.titleKey, item.params)}
        </span>
        <span className="block break-words text-sm text-muted-foreground">
          {renderMessage(i18n, item.bodyKey, item.params)}
        </span>
        <time
          dateTime={item.createdAt}
          title={new Date(item.createdAt).toLocaleString(i18n.language)}
          className="block text-xs text-muted-foreground"
        >
          {relativeTime(item.createdAt, i18n.language, now)}
        </time>
      </button>
      {page && !item.readAt && (
        <Button
          className="mr-4 shrink-0"
          variant="ghost"
          disabled={mark.isPending}
          onClick={() => mark.mutate([item.id])}
        >
          {t("notify.markRead")}
        </Button>
      )}
    </li>
  );
}

export function NotificationBell() {
  const { key, active } = useNotifications();
  return active ? <ActiveBell key={key[2]} /> : null;
}

function ActiveBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { key, active } = useNotifications();
  const client = useQueryClient();
  const userId = key[2];
  const unread = useQuery<number, IpcError>({
    queryKey: [...key, "unread"],
    queryFn: async ({ signal }) => {
      const count = await notifyUnreadCount();
      signal.throwIfAborted();
      return count;
    },
    enabled: active,
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: "always",
  });
  const list = useNotificationList(1, 5, false, open);
  const mark = useMarkRead();
  useEffect(() => {
    if (!active) return;
    const refresh = () => {
      void client.invalidateQueries({
        queryKey: ["notify", "notifications", userId],
      });
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active, client, userId]);
  if (!active) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("notify.bell")}
          aria-expanded={open}
          aria-controls="notification-panel"
          className="relative"
          overlay={
            unread.data !== undefined && unread.data > 0 ? (
              <span
                role="status"
                aria-label={t("notify.unreadCount", { count: unread.data })}
                className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-xs text-primary-foreground"
              >
                {unread.data > 99 ? "99+" : unread.data}
              </span>
            ) : null
          }
        >
          <Bell className="size-5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        asChild
        role="region"
        align="end"
        sideOffset={12}
        className="w-[min(24rem,80vw)] overflow-hidden p-0"
      >
        <section id="notification-panel" aria-label={t("notify.title")}>
          <div className="flex items-center justify-between p-4">
            <h2 className="font-semibold">{t("notify.title")}</h2>
            <Button
              size="icon"
              variant="ghost"
              aria-label={t("notify.close")}
              onClick={() => {
                setOpen(false);
              }}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {unread.isError && <IpcErrorMessage error={unread.error} />}
          {list.isPending && (
            <p role="status" className="p-4">
              {t("notify.loading")}
            </p>
          )}
          {list.isError && <IpcErrorMessage error={list.error} />}
          {mark.error && <IpcErrorMessage error={mark.error} />}
          <ScrollArea className="max-h-[60vh]">
            {list.data && (
              <NotificationList
                items={list.data.items}
                now={list.dataUpdatedAt}
                onOpened={() => setOpen(false)}
              />
            )}
          </ScrollArea>
          <div className="flex items-center justify-between border-t border-border p-3">
            <Button
              variant="ghost"
              disabled={mark.isPending}
              onClick={() => mark.mutate(undefined)}
            >
              {t("notify.markAllRead")}
            </Button>
            <Link
              to="/notify"
              className="rounded px-3 py-2 text-sm text-brand underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setOpen(false)}
            >
              {t("notify.viewAll")}
            </Link>
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}

export function NotificationsPage() {
  const { key, active } = useNotifications();
  return active ? <ActiveNotificationsPage key={key[2]} /> : null;
}

function ActiveNotificationsPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const pageSize = 20;
  const list = useNotificationList(page, pageSize, unreadOnly);
  const mark = useMarkRead();
  if (!mark.active) return null;
  return (
    <section className="mx-auto max-w-4xl space-y-6 py-10">
      <h1 className="text-2xl font-semibold">{t("notify.title")}</h1>
      <div className="flex items-center justify-between gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => {
              setUnreadOnly(event.target.checked);
              setPage(1);
            }}
          />
          {t("notify.unreadOnly")}
        </label>
        <Button
          variant="ghost"
          disabled={mark.isPending}
          onClick={() =>
            mark.mutate(undefined, { onSuccess: () => setPage(1) })
          }
        >
          {t("notify.markAllRead")}
        </Button>
      </div>
      {list.isPending && <p role="status">{t("notify.loading")}</p>}
      {list.isError && <IpcErrorMessage error={list.error} />}
      {mark.error && <IpcErrorMessage error={mark.error} />}
      {list.data && (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            <NotificationList
              items={list.data.items}
              now={list.dataUpdatedAt}
              page
            />
          </div>
          <nav
            aria-label={t("notify.pagination")}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <p>
              {t("notify.pageInfo", {
                page,
                pages: Math.max(1, Math.ceil(list.data.total / pageSize)),
                total: list.data.total,
              })}
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={page === 1 || list.isFetching}
                onClick={() => setPage(page - 1)}
              >
                {t("notify.previous")}
              </Button>
              <Button
                variant="ghost"
                disabled={page * pageSize >= list.data.total || list.isFetching}
                onClick={() => setPage(page + 1)}
              >
                {t("notify.next")}
              </Button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
