import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { refreshAuth } from "@/core/auth";
import { IpcErrorMessage } from "@/core/ipc-error";
import {
  accountSessionLock,
  accountSessionTouch,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";

export function ActivityTracker({ minutes }: { minutes: number }) {
  const client = useQueryClient();
  const touch = useMutation<null, IpcError>({
    mutationFn: accountSessionTouch,
    gcTime: 0,
  });
  const lock = useMutation<null, IpcError>({
    mutationFn: accountSessionLock,
    onSuccess: () => refreshAuth(client),
    gcTime: 0,
  });
  const { mutate: touchSession } = touch;
  const { mutate: lockSession } = lock;
  useEffect(() => {
    let lastTouch = Date.now();
    let timer = window.setTimeout(() => lockSession(), minutes * 60_000);
    function activity() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lockSession(), minutes * 60_000);
      const now = Date.now();
      if (now - lastTouch >= 30_000) {
        lastTouch = now;
        touchSession();
      }
    }
    for (const event of ["pointerdown", "keydown", "wheel"])
      window.addEventListener(event, activity, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of ["pointerdown", "keydown", "wheel"])
        window.removeEventListener(event, activity);
    };
  }, [minutes, touchSession, lockSession]);
  const error = lock.error ?? touch.error;
  return error ? <IpcErrorMessage error={error} /> : null;
}
