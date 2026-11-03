import { type QueryClient, queryOptions } from "@tanstack/react-query";
import {
  demoOverviewGet,
  demoSampleGet,
  demoSampleList,
} from "@/lib/generated/commands";
import type { DemoListInput } from "@/lib/generated/DemoListInput";
import type { DemoOverview } from "@/lib/generated/DemoOverview";
import type { DemoSample } from "@/lib/generated/DemoSample";
import type { IpcError } from "@/lib/generated/IpcError";
import type { JobSubmitted } from "@/lib/generated/JobSubmitted";
import type { Page } from "@/lib/generated/Page";

export const demoKey = (userId: string) => ["demo", userId] as const;

export const overviewQuery = (userId: string) =>
  queryOptions<DemoOverview, IpcError>({
    queryKey: [...demoKey(userId), "overview"],
    queryFn: demoOverviewGet,
    retry: false,
  });

export const samplesQuery = (userId: string, input: DemoListInput) =>
  queryOptions<Page<DemoSample>, IpcError>({
    queryKey: [...demoKey(userId), "samples", input],
    queryFn: () => demoSampleList(input),
    retry: false,
  });

export const sampleQuery = (userId: string, id: string) =>
  queryOptions<DemoSample, IpcError>({
    queryKey: [...demoKey(userId), "sample", id],
    queryFn: () => demoSampleGet({ id }),
    retry: false,
  });

// Only IDs returned by submissions in this app session; no persisted job history.
export const submittedJobsQuery = (userId: string) =>
  queryOptions<string[]>({
    queryKey: [...demoKey(userId), "submitted-jobs"],
    queryFn: () => [],
    initialData: [],
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });

export function rememberJob(
  client: QueryClient,
  userId: string,
  submitted: JobSubmitted,
) {
  client.setQueryData<string[]>(
    submittedJobsQuery(userId).queryKey,
    (ids = []) => [...ids, submitted.jobId],
  );
  return submitted;
}
