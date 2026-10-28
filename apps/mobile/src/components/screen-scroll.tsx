import type { ReactNode } from "react";
import { Screen } from "@/ui/screen";

type ScreenScrollProps = {
  title: string;
  testID: string;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
};

export function ScreenScroll(props: ScreenScrollProps) {
  return <Screen {...props} />;
}
