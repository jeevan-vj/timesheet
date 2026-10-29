import {
  calculateEntryPayCents,
  formatDayHeading,
  formatMinutes,
  formatNzd,
  formatShiftTime,
  shiftStatusLabel,
  spokenNzd,
  type OwnerApprovalStatus,
  type OwnerEntry,
} from "@cleantrack/core";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { OwnerShiftMutationFailure, useOwnerShiftException } from "@/owner-mutations-client";
import {
  OWNER_SHIFT_ACTIONS_ENABLED,
  OWNER_SHIFT_ACTIONS_DISABLED_MESSAGE,
  ownerShiftActionsState,
  ownerShiftPaidMinutesError,
  type OwnerShiftAction,
} from "@/owner-mutations";
import {
  DestructiveButton,
  ListRow,
  PrimaryButton,
  SecondaryButton,
  Sheet,
  StatusPill,
  spacing,
  statusColors,
  theme,
  typeScale,
} from "@/ui";

const MINUTE_STEP = 15;

function stepMinutes(value: number, direction: 1 | -1): number {
  if (direction === 1) return Math.min(45, Math.floor(value / MINUTE_STEP) * MINUTE_STEP + MINUTE_STEP);
  return Math.max(0, Math.ceil(value / MINUTE_STEP) * MINUTE_STEP - MINUTE_STEP);
}

function initialPaidParts(entry: OwnerEntry | null): { hours: number; minutes: number } {
  const paidMinutes = entry && entry.paidMinutes > 0 ? entry.paidMinutes : 60;
  return { hours: Math.floor(paidMinutes / 60), minutes: paidMinutes % 60 };
}

export function OwnerShiftSheet({
  approvalStatus,
  entry,
  onClose,
}: {
  approvalStatus: OwnerApprovalStatus;
  entry: OwnerEntry | null;
  onClose: () => void;
}) {
  const submitting = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentEntryId = useRef(entry?.id);
  currentEntryId.current = entry?.id;
  const mutation = useOwnerShiftException(() => {
    submitting.current = false;
    setIsSubmitting(false);
  });
  const initial = initialPaidParts(entry);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [editingHours, setEditingHours] = useState(false);
  const [confirmationAction, setConfirmationAction] = useState<OwnerShiftAction | null>(null);
  const [pendingAction, setPendingAction] = useState<OwnerShiftAction | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const next = initialPaidParts(entry);
    setHours(next.hours);
    setMinutes(next.minutes);
    setEditingHours(false);
    setConfirmationAction(null);
    setPendingAction(null);
    setLocalError(null);
    mutation.reset();
  }, [entry?.id]);

  if (!entry) {
    return <Sheet onClose={onClose} title="Shift actions" visible={false}>{null}</Sheet>;
  }

  const state = ownerShiftActionsState(entry, approvalStatus);
  const paidMinutes = hours * 60 + minutes;
  const paidMinutesError = ownerShiftPaidMinutesError(paidMinutes);
  const payCents = entry.paidMinutes > 0 && entry.rateCents > 0
    ? calculateEntryPayCents(entry.paidMinutes, entry.rateCents)
    : 0;
  const mutationMessage = mutation.error instanceof OwnerShiftMutationFailure
    ? mutation.error.detail.message
    : mutation.error instanceof Error
      ? mutation.error.message
      : null;
  const errorMessage = localError ?? mutationMessage;

  const canRun = (action: OwnerShiftAction) => OWNER_SHIFT_ACTIONS_ENABLED
    && !mutation.isPending
    && !isSubmitting
    && !submitting.current
    && state.actions.some((item) => item.action === action && item.enabled);

  const runAction = (action: OwnerShiftAction, confirmed = false) => {
    if (!canRun(action)) return;
    if ((action === "did_not_work" || action === "reset_pending") && !confirmed) {
      setEditingHours(false);
      setConfirmationAction(action);
      return;
    }
    setConfirmationAction(null);
    if (action === "change_hours") {
      setLocalError(null);
      mutation.reset();
      setEditingHours(true);
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    setPendingAction(action);
    setLocalError(null);
    mutation.reset();
    mutation.mutate(
      { entryId: entry.id, action },
      { onSuccess: () => { if (currentEntryId.current === entry.id) onClose(); } },
    );
  };

  const saveHours = () => {
    if (!canRun("change_hours")) return;
    if (paidMinutesError) {
      setLocalError(paidMinutesError);
      return;
    }
    submitting.current = true;
    setIsSubmitting(true);
    setPendingAction("change_hours");
    setLocalError(null);
    mutation.reset();
    mutation.mutate(
      { entryId: entry.id, action: "change_hours", paidMinutes },
      { onSuccess: () => { if (currentEntryId.current === entry.id) onClose(); } },
    );
  };

  return (
    <Sheet closeLabel="Close shift actions" onClose={onClose} title={entry.siteName} visible>
      <View style={styles.heading}>
        <StatusPill label={shiftStatusLabel(entry.occurrenceKind)} />
      </View>
      <ListRow
        accessibilityLabel={`Contractor, ${entry.contractorName}`}
        icon={{ ios: "person", android: "person", web: "person" }}
        title={entry.contractorName}
      />
      <ListRow
        accessibilityLabel={`${formatDayHeading(entry.workDate)}, ${formatShiftTime(entry)}`}
        icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }}
        subtitle={formatShiftTime(entry)}
        title={formatDayHeading(entry.workDate)}
      />
      <ListRow
        accessibilityLabel={`Paid hours ${formatMinutes(entry.paidMinutes)}, gross pay ${spokenNzd(payCents)}`}
        icon={{ ios: "dollarsign.circle", android: "payments", web: "payments" }}
        subtitle={`${formatMinutes(entry.paidMinutes)} · ${formatNzd(payCents)}`}
        title="Paid hours and gross pay"
      />

      {!OWNER_SHIFT_ACTIONS_ENABLED ? (
        <Text style={styles.notice}>{OWNER_SHIFT_ACTIONS_DISABLED_MESSAGE}</Text>
      ) : null}
      {state.reason ? <Text style={styles.notice}>{state.reason}</Text> : null}
      {errorMessage ? (
        <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>
          {errorMessage}
        </Text>
      ) : null}

      {confirmationAction == null ? state.actions.map((item) => {
        const disabled = !canRun(item.action);
        const accessibilityLabel = item.reason ? `${item.label}. ${item.reason}` : item.label;
        const common = {
          accessibilityLabel,
          busy: mutation.isPending && pendingAction === item.action,
          disabled,
          onPress: () => runAction(item.action),
        };
        if (item.action === "worked") {
          return <PrimaryButton key={item.action} {...common}>{item.label}</PrimaryButton>;
        }
        if (item.action === "did_not_work") {
          return <DestructiveButton key={item.action} {...common}>{item.label}</DestructiveButton>;
        }
        return <SecondaryButton key={item.action} {...common}>{item.label}</SecondaryButton>;
      }) : null}

      {confirmationAction && canRun(confirmationAction) ? (
        <View style={styles.editor}>
          <Text accessibilityRole="alert" style={styles.error}>
            {entry.contractorName} at {entry.siteName} on {formatDayHeading(entry.workDate)}.
            {confirmationAction === "did_not_work"
              ? " Mark as didn’t work? This sets paid time to 0 and gross pay to $0 for this day."
              : " Reset to pending? This replaces the current paid hours with scheduled hours for this day."}
          </Text>
          <SecondaryButton
            accessibilityLabel="Cancel paid-hours change"
            onPress={() => setConfirmationAction(null)}
          >
            Cancel
          </SecondaryButton>
          <DestructiveButton
            accessibilityLabel={confirmationAction === "did_not_work"
              ? "Confirm didn’t work and set paid time to zero"
              : "Confirm reset to pending and replace paid hours with scheduled hours"}
            onPress={() => runAction(confirmationAction, true)}
          >
            {confirmationAction === "did_not_work"
              ? "Confirm didn’t work — set paid time to zero"
              : "Confirm reset — replace paid hours"}
          </DestructiveButton>
        </View>
      ) : null}

      {editingHours && canRun("change_hours") ? (
        <View style={styles.editor}>
          <Text accessibilityRole="header" style={styles.editorTitle}>Change paid hours</Text>
          <View style={styles.stepperRow}>
            <Text style={styles.stepperLabel}>Hours</Text>
            <SecondaryButton
              accessibilityLabel="Decrease paid hours by one hour"
              disabled={mutation.isPending || hours === 0}
              onPress={() => setHours((value) => Math.max(0, value - 1))}
              style={styles.stepperButton}
            >
              −
            </SecondaryButton>
            <Text accessibilityLabel={`${hours} hours`} style={styles.stepperValue}>{hours}</Text>
            <SecondaryButton
              accessibilityLabel="Increase paid hours by one hour"
              disabled={mutation.isPending || hours === 23}
              onPress={() => setHours((value) => Math.min(23, value + 1))}
              style={styles.stepperButton}
            >
              +
            </SecondaryButton>
          </View>
          <View style={styles.stepperRow}>
            <Text style={styles.stepperLabel}>Minutes</Text>
            <SecondaryButton
              accessibilityLabel="Decrease paid minutes by 15 minutes"
              disabled={mutation.isPending || minutes === 0}
              onPress={() => setMinutes((value) => stepMinutes(value, -1))}
              style={styles.stepperButton}
            >
              −
            </SecondaryButton>
            <Text accessibilityLabel={`${minutes} minutes`} style={styles.stepperValue}>{minutes}</Text>
            <SecondaryButton
              accessibilityLabel="Increase paid minutes by 15 minutes"
              disabled={mutation.isPending || minutes >= 45}
              onPress={() => setMinutes((value) => stepMinutes(value, 1))}
              style={styles.stepperButton}
            >
              +
            </SecondaryButton>
          </View>
          <PrimaryButton
            accessibilityLabel={`Save ${hours} hours and ${minutes} minutes for this day only`}
            busy={mutation.isPending && pendingAction === "change_hours"}
            disabled={!canRun("change_hours") || paidMinutesError != null}
            onPress={saveHours}
          >
            Save hours for this day
          </PrimaryButton>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: "flex-start",
  },
  notice: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  error: {
    color: statusColors.danger,
    fontSize: typeScale.subhead,
    lineHeight: 22,
    fontWeight: "600",
  },
  editor: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  editorTitle: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontWeight: "700",
  },
  stepperRow: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  stepperLabel: {
    flex: 1,
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    fontWeight: "600",
  },
  stepperButton: {
    minWidth: theme.touchTarget,
    paddingHorizontal: spacing.sm,
  },
  stepperValue: {
    minWidth: 36,
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 22,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
});
