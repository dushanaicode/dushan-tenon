import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  isOverridden,
  useAppSettings,
  useSettingsPending,
  useSettingsUpdate,
} from "@/core/app-settings";
import { useSessionActions } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import { useIpcErrorToast } from "@/core/use-ipc-toast";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
  Skeleton,
} from "@/kit";
import type { CurrentUser } from "@/lib/generated/CurrentUser";
import type { Language } from "@/lib/generated/Language";
import type { Theme } from "@/lib/generated/Theme";

export function UserMenu({
  user,
  profilePath,
}: {
  user: CurrentUser;
  profilePath?: string;
}) {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const update = useSettingsUpdate();
  const pending = useSettingsPending();
  const session = useSessionActions();
  const onError = useIpcErrorToast();
  if (settings.isPending) return <Skeleton className="size-8 rounded-full" />;
  if (settings.isError) return <IpcErrorMessage error={settings.error} />;
  const name = user.displayName || t("account.user.owner");
  const { language, theme } = settings.data;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={name}
          title={t("shell.userMenu")}
        >
          <Avatar className="bg-primary/15 text-primary" aria-hidden="true">
            <AvatarFallback className="font-semibold">
              {Array.from(name)[0]}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="truncate font-semibold">{name}</div>
        </DropdownMenuLabel>
        {profilePath && (
          <DropdownMenuItem asChild>
            <Link to={profilePath}>
              <Icon iconId="profile" />
              {t("shell.userMenu.profile")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t("shell.userMenu.language")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label={t("shell.userMenu.language")}
          value={language.value}
          title={t(`settings.source.${language.source}`)}
          onValueChange={(value) =>
            update.mutate({ language: value as Language }, { onError })
          }
        >
          {(["zh-CN", "en-US"] as const).map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              disabled={pending || isOverridden(language.source)}
            >
              {value === "zh-CN" ? "简体中文" : "English"}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          aria-label={t("theme.label")}
          value={theme.value}
          title={t(`settings.source.${theme.source}`)}
          onValueChange={(value) =>
            update.mutate({ theme: value as Theme }, { onError })
          }
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <DropdownMenuRadioItem
              key={value}
              value={value}
              disabled={pending || isOverridden(theme.source)}
            >
              {t(`theme.${value}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {user.mode === "login" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={session.isPending}
              onSelect={() => session.mutate("lock", { onError })}
            >
              <Icon iconId="lock" />
              {t("account.auth.lock")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={session.isPending}
              onSelect={() => session.mutate("logout", { onError })}
            >
              <Icon iconId="logout" />
              {t("account.auth.logout")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
