// Adapted from AI Elements conversation.tsx / message.tsx, ca8be600bfd01b3131f9bf6134b51602a71f4374.
// Copyright 2023 Vercel, Inc. Apache-2.0; see ../licenses/ai-elements.LICENSE and ../SOURCES.md.
// Changes: pure view types, controlled composer, instant scrolling, local kit and accessible states.
import { ArrowDown, Copy } from "lucide-react";
import {
  memo,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStickToBottom } from "use-stick-to-bottom";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Label } from "../ui/label";
import { PageHeader } from "../ui/page-header";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { StreamText } from "../ui/stream-text";
import { Textarea } from "../ui/textarea";

export type ConversationPart = {
  id: string;
  type: "text" | "reasoning";
  text: string;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  parts: readonly ConversationPart[];
};

export type ConversationStatus =
  | "idle"
  | "submitting"
  | "streaming"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export type ConversationPageProps = {
  messages: readonly ConversationMessage[];
  status: ConversationStatus;
  activeMessageId: string | null;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  title?: ReactNode;
  usage?: ReactNode;
  notice?: ReactNode;
  className?: string;
};

function Reasoning({
  part,
  isAnimating,
}: {
  part: ConversationPart;
  isAnimating: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0 rounded-md border p-panel">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {t("kit.conversation.reasoning")}
      </Button>
      <div id={id} hidden={!open}>
        <StreamText text={part.text} isAnimating={isAnimating} />
      </div>
    </div>
  );
}

const Message = memo(function Message({
  message,
  isAnimating,
}: {
  message: ConversationMessage;
  isAnimating: boolean;
}) {
  const { t } = useTranslation();
  const heading = useId();
  return (
    <li
      data-slot="conversation-message"
      aria-labelledby={heading}
      className={cn(
        "flex min-w-0 flex-col gap-stack rounded-lg p-panel text-body",
        message.role === "user"
          ? "bg-muted text-foreground"
          : "bg-card text-card-foreground",
      )}
    >
      <h2 id={heading} data-part="title" className="text-body font-semibold">
        {t(`kit.conversation.${message.role}`)}
      </h2>
      {message.parts.map((part) =>
        part.type === "reasoning" ? (
          <Reasoning key={part.id} part={part} isAnimating={isAnimating} />
        ) : (
          <StreamText
            key={part.id}
            text={part.text}
            isAnimating={isAnimating}
          />
        ),
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                message.parts.map((part) => part.text).join(""),
              );
              toast(t("kit.conversation.copied"));
            } catch {
              toast(t("kit.conversation.copyFailed"));
            }
          }}
        >
          <Copy aria-hidden="true" />
          {t("kit.conversation.copy")}
        </Button>
      </div>
    </li>
  );
});

export function ConversationPage({
  messages,
  status,
  activeMessageId,
  inputValue,
  onInputChange,
  onSubmit,
  onStop,
  title,
  usage,
  notice,
  className,
}: ConversationPageProps) {
  const { t } = useTranslation();
  const busy = ["submitting", "streaming", "cancelling"].includes(status);
  const inputId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const stop = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const wasBusy = useRef(busy);
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: "instant",
    });

  useEffect(() => {
    if (wasBusy.current && !busy && document.activeElement === stop.current) {
      input.current?.focus({ preventScroll: true });
    }
    wasBusy.current = busy;
  }, [busy]);

  return (
    <div
      data-slot="conversation-page"
      data-status={status}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col gap-stack",
        className,
      )}
    >
      {title !== undefined && <PageHeader title={title} />}
      <ScrollArea
        region="content"
        ref={scrollRef}
        className="min-h-0 flex-1"
        aria-live="off"
        data-slot="conversation-scroll"
      >
        <div ref={contentRef}>
          {messages.length === 0 ? (
            <EmptyState title={t("kit.conversation.empty")} />
          ) : (
            <ol className="flex min-w-0 list-none flex-col gap-stack">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  isAnimating={busy && message.id === activeMessageId}
                />
              ))}
            </ol>
          )}
        </div>
      </ScrollArea>
      <div className="flex flex-wrap items-center gap-stack text-body">
        <div aria-hidden="true" className="flex items-center gap-2">
          {busy && <Spinner />}
          {t(`kit.conversation.${status}`)}
        </div>
        <p
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {t(
            `kit.conversation.${status === "streaming" ? "submitting" : status}`,
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={isAtBottom}
          onClick={() => void scrollToBottom("instant")}
        >
          <ArrowDown aria-hidden="true" />
          {t("kit.conversation.toBottom")}
        </Button>
      </div>
      {usage !== undefined && (
        <div data-part="usage" className="text-body text-muted-foreground">
          {usage}
        </div>
      )}
      {notice !== undefined && (
        <div data-part="notice" className="text-body">
          {notice}
        </div>
      )}
      <form
        className="flex flex-col gap-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !composing.current && inputValue.trim()) onSubmit();
        }}
      >
        <Label htmlFor={inputId}>{t("kit.conversation.input")}</Label>
        <Textarea
          id={inputId}
          ref={input}
          className="max-h-48 min-h-16 resize-none"
          value={inputValue}
          readOnly={busy}
          onChange={(event) => onInputChange(event.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.defaultPrevented ||
              event.repeat ||
              composing.current ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            ) {
              return;
            }
            event.preventDefault();
            if (!busy && inputValue.trim()) onSubmit();
          }}
        />
        <div className="flex gap-stack">
          <Button type="submit" disabled={busy || !inputValue.trim()}>
            {t("kit.conversation.send")}
          </Button>
          <Button
            ref={stop}
            type="button"
            variant="outline"
            disabled={!busy}
            onClick={onStop}
          >
            {t("kit.conversation.stop")}
          </Button>
        </div>
      </form>
    </div>
  );
}
