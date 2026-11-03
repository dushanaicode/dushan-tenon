import {
  Component,
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { LazyComponent } from "@/core/contracts/module";
import { ErrorView, Loading } from "@/kit";

const components = new WeakMap<
  LazyComponent,
  { Component: LazyExoticComponent<ComponentType>; id: number }
>();
let nextId = 0;

function createComponent(factory: LazyComponent) {
  const entry = { Component: lazy(factory), id: nextId++ };
  components.set(factory, entry);
  return entry;
}

export function LoadingContent() {
  const { t } = useTranslation();
  return <Loading size="page" label={t("settings.initializing")} />;
}

class LoadBoundary extends Component<
  { children: ReactNode; onRetry: () => void },
  { traceId: string | null }
> {
  state: { traceId: string | null } = { traceId: null };

  static getDerivedStateFromError() {
    return { traceId: crypto.randomUUID() };
  }

  componentDidCatch(error: unknown) {
    console.error("Content loading failed", {
      error,
      traceId: this.state.traceId,
    });
  }

  render() {
    return this.state.traceId ? (
      <LoadFailure traceId={this.state.traceId} onRetry={this.props.onRetry} />
    ) : (
      this.props.children
    );
  }
}

function LoadFailure({
  traceId,
  onRetry,
}: {
  traceId: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ErrorView
      message={t("settings.loadFailed")}
      detail={t("error.traceId", { traceId })}
      onRetry={onRetry}
      retryLabel={t("settings.retry")}
    />
  );
}

export function LazyContent({
  factory,
  fallback = <LoadingContent />,
}: {
  factory: LazyComponent;
  fallback?: ReactNode;
}) {
  const [, retry] = useState(0);
  const entry = components.get(factory) ?? createComponent(factory);
  return (
    <LoadBoundary
      key={entry.id}
      onRetry={() => {
        createComponent(factory);
        retry((attempt) => attempt + 1);
      }}
    >
      <Suspense fallback={fallback}>
        <entry.Component />
      </Suspense>
    </LoadBoundary>
  );
}
