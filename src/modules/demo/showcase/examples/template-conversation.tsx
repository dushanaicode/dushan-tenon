// showcase-example
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ConversationMessage,
  ConversationPage,
  type ConversationStatus,
  StreamText,
} from "@/kit";

export function TemplateConversationExample() {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<ConversationStatus>("idle");
  const [messages, setMessages] = useState<ConversationMessage[]>([
    {
      id: "intro",
      role: "assistant",
      parts: [
        {
          id: "intro-text",
          type: "text",
          text: t("showcase.templates.conversationIntro"),
        },
      ],
    },
  ]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-stack">
      <StreamText
        text={t("showcase.templates.streamSample")}
        isAnimating={false}
      />
      <ConversationPage
        title={t("showcase.templates.conversationTitle")}
        notice={t("showcase.templates.conversationBoundary")}
        messages={messages}
        status={status}
        activeMessageId={null}
        inputValue={input}
        onInputChange={setInput}
        onSubmit={() => {
          const id = String(messages.length);
          setMessages([
            ...messages,
            {
              id: `user-${id}`,
              role: "user",
              parts: [{ id: `input-${id}`, type: "text", text: input }],
            },
            {
              id: `reply-${id}`,
              role: "assistant",
              parts: [
                {
                  id: `answer-${id}`,
                  type: "text",
                  text: t("showcase.templates.conversationReply"),
                },
              ],
            },
          ]);
          setInput("");
          setStatus("succeeded");
        }}
        onStop={() => setStatus("cancelled")}
      />
    </div>
  );
}
