import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { useAuthStatus } from "@/core/auth";
import { renderMessage } from "@/core/i18n/message";
import { IpcErrorMessage } from "@/core/ipc-error";
import { useJobPath } from "@/core/jobs/job-link";
import { useParamList } from "@/core/settings/param-queries";
import { Button, toast } from "@/kit";
import { notifyUnreadCount } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { NotificationItem } from "@/lib/generated/NotificationItem";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import {
  useMarkRead,
  useNotificationList,
  useNotifications,
} from "./notifications";

function value(entries: ParamEntry[], key: string): string {
  const entry = entries.find((entry) => entry.key === key);
  if (entry?.value == null)
    throw new Error(`Missing notification preference: ${key}`);
  return entry.value;
}

function ToastAction({
  items,
  id,
  userId,
}: {
  items: NotificationItem[];
  id: string;
  userId: string;
}) {
  const { key, active } = useNotifications();
  return active && key[2] === userId ? (
    <ActiveToastAction items={items} id={id} />
  ) : null;
}

function ActiveToastAction({
  items,
  id,
}: {
  items: NotificationItem[];
  id: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const mark = useMarkRead();
  const job = items.length === 1 ? items[0].jobId : null;
  const path = useJobPath(job);
  const target = useRef(path);
  target.current = path;
  return (
    <>
      <Button
        variant="ghost"
        disabled={mark.isPending}
        onClick={() =>
          mark.mutate(
            items.map((item) => item.id),
            {
              onSuccess: () => {
                toast.dismiss(id);
                if (job === null) void navigate("/notify");
                else if (target.current) void navigate(target.current);
              },
            },
          )
        }
      >
        {t("notify.toast.view")}
      </Button>
      {mark.error && <IpcErrorMessage error={mark.error} />}
    </>
  );
}

function ActiveToasts({ userId }: { userId: string }) {
  const [lastSeen] = useState(Date.now);
  const seen = useRef(new Set<string>());
  const toastIds = useRef(new Set<string>());
  const { key } = useNotifications();
  // 仅订阅铃铛已有的未读数，不另起计数请求或轮询。
  const unread = useQuery<number, IpcError>({
    queryKey: [...key, "unread"],
    queryFn: notifyUnreadCount,
    enabled: false,
  });
  const list = useNotificationList(
    1,
    5,
    true,
    unread.data !== undefined && unread.data > 0,
  );

  useEffect(() => {
    const ids = toastIds.current;
    return () => {
      for (const id of ids) toast.dismiss(id);
    };
  }, []);

  if (!list.data) return null;
  const items = list.data.items.filter(
    (item) =>
      item.readAt === null &&
      Date.parse(item.createdAt) > lastSeen &&
      !seen.current.has(item.id),
  );
  if (items.length === 0) return null;
  return (
    <NewToasts
      userId={userId}
      items={items}
      seen={seen.current}
      toastIds={toastIds.current}
    />
  );
}

function NewToasts({
  userId,
  items,
  seen,
  toastIds,
}: {
  userId: string;
  items: NotificationItem[];
  seen: Set<string>;
  toastIds: Set<string>;
}) {
  const { t, i18n } = useTranslation();
  const params = useParamList(userId, false);

  useEffect(() => {
    if (!params.isSuccess || params.isFetching) return;
    const fresh = items.filter((item) => !seen.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) seen.add(item.id);
    if (value(params.data, "notify.in_app_toast") === "false") return;
    const seconds = Number(value(params.data, "notify.toast_seconds"));
    const position = value(params.data, "notify.toast_position") as NonNullable<
      Parameters<typeof toast>[1]
    >["position"];
    const batches = fresh.length > 3 ? [fresh] : fresh.map((item) => [item]);
    for (const items of batches) {
      const item = items[0];
      const id = `notify:${userId}:${item.id}`;
      toastIds.add(id);
      toast(
        items.length > 1
          ? t("notify.toast.summary", { count: items.length })
          : renderMessage(i18n, item.titleKey, item.params),
        {
          id,
          description:
            items.length > 1
              ? undefined
              : renderMessage(i18n, item.bodyKey, item.params),
          duration: seconds === 0 ? Infinity : seconds * 1000,
          position,
          closeButton: true,
          action: <ToastAction items={items} id={id} userId={userId} />,
        },
      );
    }
  }, [
    items,
    params.data,
    params.isSuccess,
    params.isFetching,
    userId,
    i18n,
    t,
    seen,
    toastIds,
  ]);
  return null;
}

export function NotificationToasts() {
  const { active } = useNotifications();
  const auth = useAuthStatus();
  if (!active || !auth.data?.user) return null;
  return <ActiveToasts key={auth.data.user.id} userId={auth.data.user.id} />;
}
