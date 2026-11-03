import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditSession } from "@/core/edit-sessions";
import { IpcErrorMessage } from "@/core/ipc-error";
import { Button, FormDialog, FormSheet, Loading } from "@/kit";
import {
  demoDraftCommit,
  demoDraftDiscard,
  demoDraftOpen,
  demoDraftWrite,
} from "@/lib/generated/commands";
import type { DemoDraftFields } from "@/lib/generated/DemoDraftFields";
import type { DemoSample } from "@/lib/generated/DemoSample";
import type { DemoSampleDraft } from "@/lib/generated/DemoSampleDraft";
import type { IpcError } from "@/lib/generated/IpcError";
import { demoKey } from "./queries";
import { createDraftWriter, sameDraft } from "./sample-draft-writer";
import { SampleFields } from "./sample-fields";
import { useDemoScope } from "./use-demo-scope";

export type SampleEditSession = {
  dirty: boolean;
  canSave: boolean;
  pending: boolean;
  flush: () => Promise<void>;
  save: () => Promise<void>;
  discard: () => Promise<void>;
};

export function SampleForm({
  userId,
  sample,
  onClose,
  onSession,
}: {
  userId: string;
  sample?: DemoSample;
  onClose: () => void;
  onSession?: (session: SampleEditSession | null) => void;
}) {
  const { t } = useTranslation();
  const editorId = useId();
  const query = useQuery<DemoSampleDraft, IpcError>({
    queryKey: [...demoKey(userId), "edit-draft", sample?.id ?? "new", editorId],
    queryFn: () => demoDraftOpen({ sampleId: sample?.id ?? null }),
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  if (query.isPending) return <Loading />;
  if (query.data && !query.isError)
    return (
      <DraftForm
        key={query.data.lease.sessionId}
        userId={userId}
        draft={query.data}
        onClose={onClose}
        onSession={onSession}
        reopen={async () => {
          await query.refetch();
        }}
      />
    );
  const Form = sample ? FormSheet : FormDialog;
  return (
    <Form
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t(sample ? "demo.edit" : "demo.create")}
      submitDisabled
      onSubmit={() => {}}
    >
      {query.isError ? (
        <>
          <IpcErrorMessage error={query.error} />
          <Button
            type="button"
            variant="outline"
            onClick={() => void query.refetch()}
          >
            {t("demo.refresh")}
          </Button>
        </>
      ) : (
        <Loading />
      )}
    </Form>
  );
}

function DraftForm({
  userId,
  draft,
  onClose,
  onSession,
  reopen,
}: {
  userId: string;
  draft: DemoSampleDraft;
  onClose: () => void;
  onSession?: (session: SampleEditSession | null) => void;
  reopen: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const isCurrent = useDemoScope(userId);
  const [recovering, setRecovering] = useState(draft.recovered);
  const [fields, setFields] = useState(
    draft.recovered ? draft.baseline : draft.fields,
  );
  const [writer] = useState(() =>
    createDraftWriter(draft.lease, draft.fields, (input) => {
      if (!isCurrent())
        return Promise.reject(new Error("Demo editor is no longer active"));
      return demoDraftWrite(input);
    }),
  );
  const [busy, setBusy] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [stored, setStored] = useState(draft.recovered);
  const [error, setError] = useState<IpcError | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const finishBusy = useRef(false);
  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const flush = useCallback(async () => {
    clearTimer();
    if (recovering || draft.conflict) return;
    if (mounted.current) setSavingDraft(true);
    try {
      await writer.flush();
      if (mounted.current) {
        setError(null);
        setStored(true);
      }
    } catch (failure) {
      if (mounted.current) setError(failure as IpcError);
      throw failure;
    } finally {
      if (mounted.current) setSavingDraft(false);
    }
  }, [clearTimer, draft.conflict, recovering, writer]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
    };
  }, [clearTimer]);
  const save = useCallback(async () => {
    if (finishBusy.current || recovering || draft.conflict) return;
    finishBusy.current = true;
    setBusy(true);
    try {
      await flush();
      if (!isCurrent()) return;
      await demoDraftCommit(writer.lease);
      if (!isCurrent()) return;
      writer.close();
      await client.invalidateQueries({
        queryKey: demoKey(userId),
        predicate: (query) => query.queryKey[2] !== "edit-draft",
      });
      onClose();
    } catch (failure) {
      if (mounted.current) setError(failure as IpcError);
      throw failure;
    } finally {
      finishBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [
    client,
    draft.conflict,
    flush,
    isCurrent,
    onClose,
    recovering,
    userId,
    writer,
  ]);
  const discard = useCallback(async () => {
    if (finishBusy.current) return;
    finishBusy.current = true;
    setBusy(true);
    clearTimer();
    try {
      await writer.settled().catch(() => {
        /* Discard is allowed after a rejected autosave; the lease still checks its acknowledged revision. */
      });
      if (!isCurrent()) return;
      await demoDraftDiscard(writer.lease);
      if (!isCurrent()) return;
      writer.close();
      onClose();
    } catch (failure) {
      if (mounted.current) setError(failure as IpcError);
      throw failure;
    } finally {
      finishBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [clearTimer, isCurrent, onClose, writer]);
  const dirty = recovering || !sameDraft(fields, draft.baseline);
  const canSave = !recovering && !draft.conflict;
  const pending = busy || savingDraft;
  useEditSession(`demo:${draft.lease.id}:${draft.lease.sessionId}`, {
    label: t(draft.sampleId ? "demo.edit" : "demo.create"),
    dirty,
    canSave,
    pending,
    flush,
    save,
    discard,
  });
  useEffect(() => {
    onSession?.({ dirty, canSave, pending, flush, save, discard });
    return () => onSession?.(null);
  }, [dirty, canSave, pending, discard, flush, onSession, save]);
  function change(next: DemoDraftFields) {
    setFields(next);
    writer.change(next);
    setStored(false);
    clearTimer();
    timer.current = setTimeout(() => {
      void flush().catch(() => {});
    }, 400);
  }
  async function finish() {
    if (finishBusy.current) return;
    finishBusy.current = true;
    setBusy(true);
    try {
      await flush();
      if (!isCurrent()) return;
      if (!dirty) {
        await demoDraftDiscard(writer.lease);
        writer.close();
      }
      onClose();
    } catch (failure) {
      setError(failure as IpcError);
    } finally {
      finishBusy.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function reset() {
    setBusy(true);
    clearTimer();
    try {
      await writer.settled().catch(() => {
        /* A rejected autosave retains the acknowledged revision for discard. */
      });
      if (!isCurrent()) return;
      await demoDraftDiscard(writer.lease);
      if (!isCurrent()) return;
      writer.close();
      await reopen();
    } catch (failure) {
      setError(failure as IpcError);
      setBusy(false);
    }
  }
  const Form = draft.sampleId ? FormSheet : FormDialog;
  return (
    <Form
      open
      onOpenChange={(open) => {
        if (!open) void finish();
      }}
      title={t(draft.sampleId ? "demo.edit" : "demo.create")}
      description={t("demo.formHint")}
      submitLabel={t("demo.save")}
      cancelLabel={t("demo.draft.keepClose")}
      pending={busy}
      submitDisabled={recovering || draft.conflict}
      onSubmit={() => save().catch(() => {})}
    >
      {recovering && (
        <section
          role="status"
          className="space-y-3 rounded-lg border border-border p-3"
        >
          <p>
            {t(draft.conflict ? "demo.draft.conflict" : "demo.draft.found")}
          </p>
          <div className="flex flex-wrap gap-2">
            {!draft.conflict && (
              <Button
                type="button"
                onClick={() => {
                  setFields(draft.fields);
                  setRecovering(false);
                }}
              >
                {t("demo.draft.restore")}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => void reset()}
            >
              {t("demo.draft.startFresh")}
            </Button>
          </div>
        </section>
      )}
      <fieldset
        disabled={busy || recovering || draft.conflict}
        className="flex flex-col gap-stack"
      >
        <SampleFields
          value={fields}
          onChange={change}
          editing={draft.sampleId !== null}
        />
      </fieldset>
      {!recovering && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p role="status">
            {t(
              savingDraft
                ? "demo.draft.saving"
                : stored
                  ? "demo.draft.saved"
                  : "demo.draft.pending",
            )}
          </p>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void discard().catch(() => {})}
            >
              {t("demo.draft.discard")}
            </Button>
          )}
        </div>
      )}
      {error && <IpcErrorMessage error={error} />}
    </Form>
  );
}
