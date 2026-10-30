import {
  formatMinutes,
  formatNzd,
  formatWeekRange,
  ownerWeekTotals,
  spokenNzd,
  type OwnerDashboard,
} from "@cleantrack/core";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { OwnerWeekApprovalFailure, useOwnerWeekApproval } from "@/week-approval-client";
import {
  DestructiveButton,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  StatTile,
  spacing,
  theme,
  typeScale,
} from "@/ui";

export function OwnerWeekApproval({
  data,
  onRefresh,
}: {
  data: Pick<OwnerDashboard, "approval" | "summary" | "weekEnd" | "weekStart">;
  onRefresh: () => Promise<unknown>;
}) {
  const mutation = useOwnerWeekApproval();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const totals = ownerWeekTotals(data.summary);
  const approved = data.approval.status === "approved";
  const action = approved ? "reopen" : "approve";

  const open = () => {
    mutation.reset();
    setMessage("");
    setVisible(true);
  };

  const confirm = async () => {
    if (mutation.isPending) return;
    setMessage("");
    try {
      await mutation.mutateAsync(action === "approve"
        ? {
            action,
            weekStart: data.weekStart,
            expectedPaidMinutes: totals.paidMinutes,
            expectedPayCents: totals.payCents,
          }
        : { action, weekStart: data.weekStart });
      setVisible(false);
    } catch (error) {
      const detail = error instanceof OwnerWeekApprovalFailure
        ? error.detail
        : { code: "unavailable", message: "CleanTrack couldn't update this week. Try again." };
      setMessage(detail.message);
      if (detail.code === "stale_week" || detail.code === "week_locked" || detail.code === "week_not_approved") {
        await onRefresh();
      }
    }
  };

  return (
    <>
      {approved ? (
        <SecondaryButton accessibilityLabel="Reopen week" onPress={open}>Reopen week</SecondaryButton>
      ) : (
        <PrimaryButton accessibilityLabel="Approve week" onPress={open}>Approve week</PrimaryButton>
      )}
      <Sheet
        closeLabel={`Cancel ${action} week`}
        onClose={() => {
          if (!mutation.isPending) setVisible(false);
        }}
        title={approved ? "Reopen this week?" : "Approve this week?"}
        visible={visible}
      >
        <Text style={styles.range}>{formatWeekRange(data.weekStart, data.weekEnd)}</Text>
        <View style={styles.stats}>
          <StatTile label="Paid hours" value={formatMinutes(totals.paidMinutes)} />
          <StatTile accessibilityLabel={spokenNzd(totals.payCents)} label="Gross pay" value={formatNzd(totals.payCents)} />
        </View>
        <Text style={styles.detail}>
          {approved
            ? "Reopening unlocks this week so shifts can be changed again."
            : "Approval locks this week. Confirm only after reviewing these exact totals."}
        </Text>
        {message ? <Text accessibilityRole="alert" style={styles.error}>{message}</Text> : null}
        {approved ? (
          <DestructiveButton
            accessibilityLabel={mutation.isPending ? "Reopening week" : "Confirm reopen week"}
            busy={mutation.isPending}
            disabled={mutation.isPending}
            onPress={() => void confirm()}
          >
            {mutation.isPending ? "Reopening…" : "Confirm reopen"}
          </DestructiveButton>
        ) : (
          <PrimaryButton
            accessibilityLabel={mutation.isPending ? "Approving week" : "Confirm approve week"}
            busy={mutation.isPending}
            disabled={mutation.isPending}
            onPress={() => void confirm()}
          >
            {mutation.isPending ? "Approving…" : "Confirm approval"}
          </PrimaryButton>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  range: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 25,
    fontWeight: "700",
  },
  stats: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  detail: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  error: {
    color: theme.text,
    backgroundColor: theme.surfaceRaised,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    padding: spacing.sm,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
});
