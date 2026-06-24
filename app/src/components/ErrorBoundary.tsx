import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--color-bg)" }}>
          <div className="max-w-md w-full mx-4 p-6 rounded-xl border text-center" style={{ backgroundColor: "var(--color-card)", borderColor: "var(--color-border)" }}>
            <AlertTriangle className="w-10 h-10 mx-auto mb-4" style={{ color: "var(--color-accent)" }} />
            <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--color-text-heading)" }}>
              Произошла ошибка
            </h2>
            <p className="text-sm mb-4" style={{ color: "var(--color-text-muted)" }}>
              {this.state.error?.message || "Не удалось загрузить страницу"}
            </p>
            <button
              onClick={this.handleReset}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              <RefreshCw className="w-4 h-4" />
              Попробовать снова
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
