import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import type { ModuleId, ModuleManifest } from "@/core/contracts/module";
import type {
  SectionDirectory,
  SectionTable,
  SettingSection,
  VisibilityResult,
} from "@/core/contracts/settings";
import { useDeveloperMode } from "@/core/developer-mode";
import { appModulesQuery } from "@/core/enabled-modules";
import { useModuleDirectory } from "@/core/module-directory";
import { sortParams, useParamList } from "@/core/settings/param-queries";
import { evaluateVisibility, type VisibilityAuth } from "@/core/visibility";
import type { AuthStatus } from "@/lib/generated/AuthStatus";
import type { ParamEntry } from "@/lib/generated/ParamEntry";
import { PARAM_GROUPS } from "@/lib/generated/param-keys";
import { builtinSections } from "./builtin-sections";

export function buildSections({
  manifests,
  enabled,
  auth,
  params,
}: {
  manifests: readonly ModuleManifest[];
  enabled: ReadonlySet<string>;
  auth: VisibilityAuth;
  params: readonly ParamEntry[];
}): SectionTable {
  const all: SettingSection[] = [];
  const access = new Map<string, VisibilityResult>();
  const declaredGroups = new Map<string, ModuleId>(
    PARAM_GROUPS.map(({ id, moduleId }) => [id, moduleId]),
  );
  const claimedGroups = new Set<string>();

  function readable(entry: ParamEntry) {
    return (
      entry.readPermission === null ||
      auth.permissions.includes(entry.readPermission)
    );
  }

  function add(section: SettingSection, hasReadableParams = true) {
    if (access.has(section.id))
      throw new Error(`Duplicate setting section id: ${section.id}`);
    let decision: VisibilityResult = evaluateVisibility(
      section.visibility,
      auth,
    );
    if (section.moduleId !== null && !enabled.has(section.moduleId)) {
      decision = "notFound";
    } else if (
      decision === "visible" &&
      (!hasReadableParams ||
        (section.kind === "params" && section.entries.length === 0))
    ) {
      decision = "forbidden";
    }
    all.push(section);
    access.set(section.id, decision);
  }

  for (const section of builtinSections) {
    add({
      ...section,
      path: `/settings/${section.id}`,
      kind: "component",
      moduleId: null,
      visibility: section,
    });
  }
  for (const manifest of manifests) {
    for (const section of manifest.settings) {
      for (const group of section.paramGroups ?? []) {
        const owner = declaredGroups.get(group);
        if (owner === undefined)
          throw new Error(`Unknown parameter group: ${group}`);
        if (owner !== manifest.id)
          throw new Error(
            `Parameter group belongs to another module: ${group}`,
          );
        if (claimedGroups.has(group))
          throw new Error(`Parameter group already claimed: ${group}`);
        claimedGroups.add(group);
      }
      add(
        {
          ...section,
          path: `/settings/${section.id}`,
          kind: "component",
          moduleId: manifest.id,
          visibility: section,
        },
        !section.paramGroups?.length ||
          params.some(
            (entry) =>
              section.paramGroups?.includes(entry.group) && readable(entry),
          ),
      );
    }
  }
  const groups = new Map<string, { moduleId: ModuleId; entries: ParamEntry[] }>(
    PARAM_GROUPS.map(({ id, moduleId }) => [id, { moduleId, entries: [] }]),
  );
  for (const entry of sortParams(params)) {
    const group = groups.get(entry.group);
    if (!group) throw new Error(`Unknown parameter group: ${entry.group}`);
    if (group.moduleId !== entry.moduleId)
      throw new Error(
        `Parameter group belongs to another module: ${entry.group}`,
      );
    // 查询返回当前可读项；权限变化时也立即移除缓存中的旧可读项。
    if (readable(entry)) {
      group.entries.push(entry);
    }
  }
  for (const [group, { moduleId, entries }] of groups) {
    if (claimedGroups.has(group)) continue;
    add({
      id: `param.${group}`,
      path: `/settings/param.${group}`,
      labelKey: `param.group.${group}`,
      order: 80,
      moduleId,
      visibility: {},
      kind: "params",
      group,
      entries,
    });
  }
  all.sort(
    (a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return {
    all,
    visible: all.filter((section) => access.get(section.id) === "visible"),
    access,
  };
}

// 调用方在 AuthGate 内，认证未就绪和失败由外层处理。
export function useSectionDirectory(
  auth: AuthStatus,
  userId: string,
): SectionDirectory {
  const manifests = useModuleDirectory();
  const client = useQueryClient();
  const developerMode = useDeveloperMode();
  const modules = useQuery(appModulesQuery);
  const params = useParamList(userId, false);
  const knownPermissions = useRef(auth.permissions);
  useEffect(() => {
    if (knownPermissions.current === auth.permissions) return;
    knownPermissions.current = auth.permissions;
    void client.invalidateQueries({ queryKey: ["app", "setting", userId] });
  }, [client, userId, auth.permissions]);
  return useMemo(() => {
    // 维护独占期间 Normal 查询返回 busy；已有目录保持渲染，
    // 否则会卸载备份控制和设置草稿。初次加载与其它错误仍正常报错。
    const maintenanceBusy =
      params.error?.code === "app.operation.busy" && params.data !== undefined;
    const error = modules.error ?? (maintenanceBusy ? null : params.error);
    if (error) return { status: "error", error };
    if (!modules.isSuccess || params.data === undefined)
      return { status: "pending" };
    return {
      status: "success",
      table: buildSections({
        manifests,
        enabled: new Set(
          modules.data.modules.filter((m) => m.enabled).map((m) => m.id),
        ),
        auth: {
          authenticated: auth.state === "active",
          developerMode,
          mode: auth.mode,
          permissions: auth.permissions,
        },
        params: params.data,
      }),
    };
  }, [
    auth,
    manifests,
    developerMode,
    modules.data,
    modules.error,
    modules.isSuccess,
    params.data,
    params.error,
  ]);
}
