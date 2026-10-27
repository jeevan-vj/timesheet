import { type ErrorBoundaryProps } from "expo-router";
import { Component, type ErrorInfo, type ReactNode, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { ScreenError } from "@/components/screen-error";
import { reportScreenError } from "@/report-screen-error";
import { theme } from "@/theme";

export function RouteErrorBoundary({
  error,
  retry,
  componentStack,
}: ErrorBoundaryProps & { componentStack?: string | null }) {
  return (
    <View style={styles.fill}>
      <ScreenError componentStack={componentStack} error={error} retry={retry} />
    </View>
  );
}

type BoundaryState = {
  error: Error | null;
  componentStack: string;
};

function toScreenError(value: unknown): Error {
  if (value instanceof Error) return value;
  const message = typeof value === "string" && value.trim() ? value.trim() : "Error";
  return new Error(message);
}

export class ScreenErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: toScreenError(error), componentStack: "" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportScreenError(error);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  retry = (): Promise<void> => {
    this.setState({ error: null, componentStack: "" });
    return Promise.resolve();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <RouteErrorBoundary
          componentStack={this.state.componentStack}
          error={this.state.error}
          retry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    reportScreenError(error);
  }, [error]);
  return <RouteErrorBoundary error={error} retry={retry} />;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: theme.background,
  },
});
