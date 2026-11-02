// Original wrapper; dependency licenses and source references: ../SOURCES.md.
import { cjk } from "@streamdown/cjk";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type Components, defaultRehypePlugins, Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";

export type StreamTextProps = {
  text: string;
  isAnimating: boolean;
  className?: string;
};

function copyableUrl(href: string | undefined): href is string {
  if (!href || !/^https?:\/\//i.test(href) || /[\p{Cc}\\]/u.test(href)) {
    return false;
  }
  try {
    const url = new URL(href);
    return url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

const components: Components = {
  a: function CopyLink({ children, href }) {
    const { t } = useTranslation();
    if (!copyableUrl(href)) return <span>{children}</span>;
    return (
      <span>
        {children}{" "}
        <Button
          type="button"
          variant="link"
          className="h-auto whitespace-normal px-1 py-0"
          aria-label={`${t("kit.streamText.copyLink")}: ${href}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(href);
              toast(t("kit.conversation.copied"));
            } catch {
              toast(t("kit.conversation.copyFailed"));
            }
          }}
        >
          {t("kit.streamText.copyLink")}
        </Button>
      </span>
    );
  },
  img: function BlockedImage({ alt }) {
    const { t } = useTranslation();
    return (
      <span className="text-muted-foreground">
        [{t("kit.streamText.imageBlocked")}
        {alt ? `: ${alt}` : ""}]
      </span>
    );
  },
  pre: ({ children }) => (
    <ScrollArea
      axis="both"
      className="max-h-100 rounded-md border border-border bg-muted p-panel"
    >
      <pre>{children}</pre>
    </ScrollArea>
  ),
  code: ({ children }) => <code>{children}</code>,
  inlineCode: ({ children }) => <code>{children}</code>,
  strong: ({ children }) => <strong>{children}</strong>,
  table: ({ children }) => (
    <ScrollArea axis="both" className="kit-stream-table">
      <table>{children}</table>
    </ScrollArea>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children }) => <th>{children}</th>,
  td: ({ children }) => <td>{children}</td>,
};

const plugins = { cjk };
const rehypePlugins = [
  defaultRehypePlugins.sanitize,
  defaultRehypePlugins.harden,
];
const remarkRehypeOptions = { allowDangerousHtml: false };

export function StreamText({ text, isAnimating, className }: StreamTextProps) {
  return (
    <div data-slot="stream-text" className={cn("kit-stream-text", className)}>
      <Streamdown
        mode="streaming"
        isAnimating={isAnimating}
        animated={false}
        plugins={plugins}
        rehypePlugins={rehypePlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        skipHtml
        controls={false}
        components={components}
      >
        {text}
      </Streamdown>
    </div>
  );
}
