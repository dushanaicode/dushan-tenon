import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isOverridden } from "@/core/app-settings";
import { useAuthStatus } from "@/core/auth";
import { useDeveloperMode } from "@/core/developer-mode";
import { IpcErrorMessage } from "@/core/ipc-error";
import { SettingSelect } from "@/core/settings/setting-select";
import { SettingSource } from "@/core/settings/setting-source";
import {
  Button,
  Input,
  Loading,
  SettingGroup,
  SettingRow,
  Switch,
} from "@/kit";
import {
  appNetworkSettingsGet,
  appNetworkSettingsUpdate,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { NetworkSettings } from "@/lib/generated/NetworkSettings";
import type { ProxyCredentialChange } from "@/lib/generated/ProxyCredentialChange";

function NetworkForm({
  saved,
  onSaved,
  refetch,
}: {
  saved: NetworkSettings;
  onSaved: (saved: NetworkSettings) => void;
  refetch: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const developer = useDeveloperMode();
  const [mode, setMode] = useState(saved.mode.value);
  const [endpoint, setEndpoint] = useState(saved.endpoint.value);
  const [auth, setAuth] = useState(saved.auth.value);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<IpcError | null>(null);
  const [success, setSuccess] = useState(false);
  const readOnly =
    saved.credentialSource === "environment" ||
    [saved.mode, saved.endpoint, saved.auth].some((setting) =>
      isOverridden(setting.source),
    );
  const disabled = readOnly || pending;

  // 直接调用 IPC：秘密仅在组件状态和本次调用栈中，不进入 MutationCache。
  async function save(credentials: ProxyCredentialChange, clear = false) {
    setPending(true);
    setError(null);
    setSuccess(false);
    try {
      const next = await appNetworkSettingsUpdate({
        mode,
        endpoint: mode === "direct" ? saved.endpoint.value : endpoint,
        auth: clear ? false : mode === "direct" ? saved.auth.value : auth,
        credentials,
      });
      setUsername("");
      setPassword("");
      setMode(next.mode.value);
      setEndpoint(next.endpoint.value);
      setAuth(next.auth.value);
      onSaved(next);
      setSuccess(true);
    } catch (error) {
      setError(error as IpcError);
      await refetch();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-stack"
      aria-label={t("settings.network.title")}
      onSubmit={(event) => {
        event.preventDefault();
        void save(
          mode === "manual" && auth && (username !== "" || password !== "")
            ? { type: "replace", username, password }
            : { type: "keep" },
        );
      }}
    >
      <SettingGroup>
        <SettingSelect
          label={t("settings.network.mode")}
          value={mode}
          source={saved.mode.source}
          options={[
            { value: "direct", label: t("settings.network.direct") },
            { value: "manual", label: t("settings.network.manual") },
          ]}
          disabled={disabled}
          locked={readOnly}
          reason={readOnly ? t("settings.network.readOnly") : undefined}
          onValueChange={setMode}
        />
        <SettingRow
          label={t("settings.network.endpoint")}
          description={t("settings.network.endpointHint")}
          source={saved.endpoint.source}
          hint={
            <SettingSource
              source={saved.endpoint.source}
              locked={readOnly}
              reason={t("settings.network.readOnly")}
            />
          }
        >
          {(control) => (
            <Input
              {...control}
              value={endpoint}
              maxLength={1024}
              disabled={disabled || mode === "direct"}
              onChange={(event) => setEndpoint(event.target.value)}
            />
          )}
        </SettingRow>
        <SettingRow
          label={t("settings.network.auth")}
          source={saved.auth.source}
          hint={
            <SettingSource
              source={saved.auth.source}
              locked={readOnly}
              reason={t("settings.network.readOnly")}
            />
          }
        >
          {(control) => (
            <Switch
              {...control}
              checked={auth}
              disabled={disabled || mode === "direct"}
              onCheckedChange={(checked) => {
                setAuth(checked);
                if (!checked) {
                  setUsername("");
                  setPassword("");
                }
              }}
            />
          )}
        </SettingRow>
        <p className="text-body">
          {t(
            saved.credentialsSet
              ? "settings.network.credentialsSet"
              : "settings.network.credentialsUnset",
          )}
        </p>
        {(developer || saved.credentialSource === "environment") && (
          <p className="text-body text-muted-foreground">
            {t(`settings.network.credentialSource.${saved.credentialSource}`)}
          </p>
        )}
        {readOnly && (
          <p className="text-body">{t("settings.network.readOnly")}</p>
        )}
        {auth && (
          <>
            <SettingRow label={t("settings.network.username")}>
              {(control) => (
                <Input
                  {...control}
                  autoComplete="off"
                  value={username}
                  maxLength={1024}
                  disabled={disabled || mode === "direct"}
                  onChange={(event) => setUsername(event.target.value)}
                />
              )}
            </SettingRow>
            <SettingRow label={t("settings.network.password")}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  maxLength={4096}
                  disabled={disabled || mode === "direct"}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </SettingRow>
            <p className="text-body text-muted-foreground">
              {t("settings.network.secretHint")}
            </p>
          </>
        )}
        {error && <IpcErrorMessage error={error} />}
        {success && (
          <p role="status" className="text-body">
            {t("settings.network.saved")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={disabled}>
            {t("settings.network.save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !saved.credentialsSet}
            onClick={() => void save({ type: "clear" }, true)}
          >
            {t("settings.network.clearCredentials")}
          </Button>
        </div>
      </SettingGroup>
    </form>
  );
}

function OwnerNetworkSection({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const queryKey = ["app", "network-settings", userId];
  const settings = useQuery<NetworkSettings, IpcError>({
    queryKey,
    queryFn: appNetworkSettingsGet,
    retry: false,
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return (
    <section aria-labelledby="network-title" className="space-y-4">
      <h2 id="network-title" className="text-xl font-semibold">
        {t("settings.sections.network")}
      </h2>
      <p className="text-body">{t("settings.network.scope")}</p>
      <p className="text-body text-muted-foreground">
        {t("settings.network.directServices")}
      </p>
      {settings.isError ? (
        <>
          <IpcErrorMessage error={settings.error} />
          <Button
            variant="outline"
            onClick={() => void settings.refetch()}
            disabled={settings.isFetching}
          >
            {t("settings.native.refresh")}
          </Button>
        </>
      ) : settings.data ? (
        <NetworkForm
          saved={settings.data}
          onSaved={(saved) => client.setQueryData(queryKey, saved)}
          refetch={settings.refetch}
        />
      ) : (
        <Loading label={t("kit.loading")} />
      )}
    </section>
  );
}

export function NetworkSection() {
  const auth = useAuthStatus();
  if (auth.data?.state !== "active" || auth.data.user === null) return null;
  return (
    <OwnerNetworkSection
      key={`${auth.data.user.id}:${auth.data.permissions.join(",")}`}
      userId={auth.data.user.id}
    />
  );
}
