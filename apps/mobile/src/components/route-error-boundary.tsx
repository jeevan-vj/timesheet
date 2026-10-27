import { type ErrorBoundaryProps } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { ScreenError } from "@/components/screen-error";
import { reportScreenError } from "@/report-screen-error";
import { theme } from "@/theme";

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.fill}>
      <ScreenError error={error} retry={retry} />
    </View>
  );
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
