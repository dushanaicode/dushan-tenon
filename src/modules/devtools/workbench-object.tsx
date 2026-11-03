import type { ObjectViewProps, ResolvedObject } from "@/core/contracts/module";
import type { ObjectRef } from "@/core/contracts/workbench";
import { i18n } from "@/core/i18n";
import { devtoolsJobGet } from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import { JobView } from "./job-detail-page";
import { jobUnavailable } from "./use-job-detail";

export async function resolveJob(
  ref: ObjectRef,
): Promise<ResolvedObject | null> {
  try {
    const job = await devtoolsJobGet({ id: ref.id });
    return {
      ref,
      title: `${i18n.t(`jobs.kinds.${job.kind}`)} · ${job.id}`,
      iconId: "jobs",
    };
  } catch (error) {
    if (jobUnavailable(error as IpcError)) return null;
    throw error;
  }
}

export function WorkbenchJobObject({ object, onUnavailable }: ObjectViewProps) {
  return (
    <JobView
      key={object.ref.id}
      id={object.ref.id}
      onUnavailable={onUnavailable}
    />
  );
}
