import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useIpcErrorToast } from "@/core/use-ipc-toast";
import { emitWindowEvent } from "@/core/window-events";
import { toast } from "@/kit";
import {
  appWindowClose,
  appWindowCloseDecide,
  appWindowEditDecide,
  appWindowMinimize,
  appWindowStartDragging,
  appWindowToggleMaximize,
  appWindowWatch,
} from "@/lib/generated/commands";
import type { IpcError } from "@/lib/generated/IpcError";
import type { Titlebar } from "@/lib/generated/Titlebar";
import type { WindowCloseDecision } from "@/lib/generated/WindowCloseDecision";
import type { WindowEvent } from "@/lib/generated/WindowEvent";
import { Channel } from "@/lib/ipc/invoke";
import { CloseAskDialog } from "./close-ask-dialog";
import { isWindowDragGesture } from "./drag-region";

interface WindowChrome {
  titlebar: Titlebar;
  platform: "windows" | "macos" | "linux";
  maximized: boolean;
  focused: boolean;
  pending: boolean;
  minimize: () => void;
  toggleMaximize: () => void;
  close: () => void;
}

const WindowChromeContext = createContext<WindowChrome | null>(null);

export function useWindowChrome() {
  const value = useContext(WindowChromeContext);
  if (!value) throw new Error("useWindowChrome requires WindowChromeProvider");
  return value;
}

export function WindowChromeProvider({
  titlebar,
  platform,
  children,
}: {
  titlebar: Titlebar;
  platform: "windows" | "macos" | "linux";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const showError = useIpcErrorToast();
  const [state, setState] = useState({ maximized: false, focused: true });
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [closeAsk, setCloseAsk] = useState<{ trayAvailable: boolean } | null>(
    null,
  );
  const asking = useRef(false);
  const [deciding, setDeciding] = useState(false);
  const decisionBusy = useRef(false);
  const [error, setError] = useState<IpcError | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const requestedCloseFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    if (platform === "macos" && titlebar === "hidden")
      root.dataset.macTitlebar = "overlay";
    else delete root.dataset.macTitlebar;
    return () => {
      delete root.dataset.macTitlebar;
    };
  }, [titlebar, platform]);
  const reportDragError = useEffectEvent(showError);
  useEffect(() => {
    if (platform !== "macos" || titlebar !== "hidden") return;
    const drag = (event: MouseEvent) => {
      if (!isWindowDragGesture(event)) return;
      event.preventDefault();
      // Match the custom titlebar controls: double-click maximizes/restores,
      // while the first press hands movement to Cocoa's native drag loop.
      const action =
        event.detail === 2 ? appWindowToggleMaximize : appWindowStartDragging;
      void action().catch((error: IpcError) => reportDragError(error));
    };
    document.addEventListener("mousedown", drag);
    return () => document.removeEventListener("mousedown", drag);
  }, [titlebar, platform]);
  const receive = useEffectEvent((event: WindowEvent) => {
    if (event.type === "moved") {
      if (event.x <= -30000 || event.y <= -30000) return;
      emitWindowEvent("tenon:window-moved", {
        ...event,
        x: event.x / window.devicePixelRatio,
        y: event.y / window.devicePixelRatio,
      });
    } else if (event.type === "state") {
      setState({ maximized: event.maximized, focused: event.focused });
    } else if (event.type === "files_changed") {
      emitWindowEvent("tenon:files-changed", event);
    } else if (event.type === "close_edit") {
      const claimed = emitWindowEvent("tenon:edit-close", event);
      // Login/error pages have no editor provider. Acknowledge without clearing
      // host state: known dirty or pending edits must still reject the exit.
      if (!claimed)
        void appWindowEditDecide({
          requestId: event.requestId,
          proceed: true,
        }).catch(showError);
    } else if (!asking.current) {
      asking.current = true;
      returnFocus.current =
        requestedCloseFocus.current ??
        (document.activeElement as HTMLElement | null);
      setCloseAsk({ trayAvailable: event.trayAvailable });
    }
  });
  const reportWatchError = useEffectEvent(showError);
  useEffect(() => {
    let active = true;
    const channel = new Channel<WindowEvent>((event) => {
      if (active) receive(event);
    });
    void appWindowWatch(channel).catch((error: IpcError) => {
      if (active) reportWatchError(error);
    });
    // 宿主在新订阅、重载或销毁时释放旧通道；旧回调不再更新 React。
    return () => {
      active = false;
    };
  }, []);

  async function run(command: () => Promise<null>) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await command();
    } catch (error) {
      showError(error as IpcError);
    } finally {
      busy.current = false;
      setPending(false);
      requestedCloseFocus.current = null;
    }
  }

  function dismiss() {
    asking.current = false;
    setCloseAsk(null);
    setError(null);
  }

  async function decide(input: WindowCloseDecision) {
    if (decisionBusy.current) return;
    decisionBusy.current = true;
    setDeciding(true);
    setError(null);
    try {
      await appWindowCloseDecide(input);
      dismiss();
    } catch (error) {
      const failure = error as IpcError;
      if (failure.code === "app.lifecycle.closing") dismiss();
      else if (failure.code === "app.input.invalid") {
        dismiss();
        toast.error(t("shell.window.ask.expired"));
      } else setError(failure);
    } finally {
      decisionBusy.current = false;
      setDeciding(false);
    }
  }

  return (
    <WindowChromeContext
      value={{
        titlebar,
        platform,
        ...state,
        pending,
        minimize: () => {
          void run(appWindowMinimize);
        },
        toggleMaximize: () => {
          void run(appWindowToggleMaximize);
        },
        close: () => {
          if (busy.current) return;
          requestedCloseFocus.current =
            document.activeElement as HTMLElement | null;
          void run(appWindowClose);
        },
      }}
    >
      {children}
      {closeAsk && (
        <CloseAskDialog
          trayAvailable={closeAsk.trayAvailable}
          pending={deciding}
          error={error}
          returnFocus={returnFocus.current}
          onCancel={dismiss}
          onConfirm={(input) => {
            void decide(input);
          }}
        />
      )}
    </WindowChromeContext>
  );
}
