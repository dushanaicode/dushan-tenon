import type { DemoDraftFields } from "@/lib/generated/DemoDraftFields";
import type { DemoDraftLease } from "@/lib/generated/DemoDraftLease";
import type { DemoDraftSaved } from "@/lib/generated/DemoDraftSaved";
import type { DemoDraftWrite } from "@/lib/generated/DemoDraftWrite";

export function sameDraft(a: DemoDraftFields, b: DemoDraftFields) {
  return a.code === b.code && a.title === b.title && a.note === b.note;
}

/** One editor owns one lease. Coalesce changes while retaining acknowledged revisions. */
export function createDraftWriter(
  initialLease: DemoDraftLease,
  initialFields: DemoDraftFields,
  write: (input: DemoDraftWrite) => Promise<DemoDraftSaved>,
) {
  let lease = initialLease;
  let fields = initialFields;
  let saved = initialFields;
  let running: Promise<void> | null = null;
  let closed = false;
  return {
    get lease() {
      return lease;
    },
    get pending() {
      return !sameDraft(fields, saved);
    },
    settled() {
      return running ?? Promise.resolve();
    },
    change(next: DemoDraftFields) {
      fields = next;
    },
    close() {
      closed = true;
    },
    flush(): Promise<void> {
      if (running) return running;
      if (closed || sameDraft(fields, saved)) return Promise.resolve();
      running = (async () => {
        while (!closed && !sameDraft(fields, saved)) {
          const current = fields;
          const receipt = await write({ lease, fields: current });
          lease = { ...lease, revision: receipt.revision };
          saved = current;
        }
      })().finally(() => {
        running = null;
      });
      return running;
    },
  };
}
