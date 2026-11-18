import {
  formatDayHeading,
  formatShiftTime,
  shiftStatusLabel,
  type PortalShiftSubmission,
} from "@cleantrack/core/portal";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { ContractorShiftMutationFailure, useContractorShiftStatus } from "@/contractor-shift-client";
import {
  CONTRACTOR_SHIFT_ACTIONS,
  CONTRACTOR_SHIFT_MESSAGES,
  contractorShiftEditor,
  contractorShiftPaidMinutesError,
  type ContractorShiftAction,
} from "@/contractor-shift";
import { useOnline } from "@/online";
import {
  DestructiveButton,
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

function initialPaidParts(shift: PortalShiftSubmission | null): { hours: number; minutes: number } {
  const paidMinutes = shift && shift.paidMinutes > 0 ? shift.paidMinutes : 60;
  return { hours: Math.floor(paidMinutes / 60), minutes: paidMinutes % 60 };
}

export function ContractorShiftSheet({
  shift,
  onClose,
  onShift,
}: {
  shift: PortalShiftSubmission | null;
  onClose: () => void;
  onShift: (shift: PortalShiftSubmission) => void;
}) {
  const online = useOnline();
  const mutation = useContractorShiftStatus();
  const initial = initialPaidParts(shift);
  const [hours, setHours] = useState(initial.hours);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [reason, setReason] = useState(shift?.reason ?? "");
  const [editingHours, setEditingHours] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ContractorShiftAction | null>(null);

  useEffect(() => {
    const next = initialPaidParts(shift);
    setHours(next.hours);
    setMinutes(next.minutes);
    setReason(shift?.reason ?? "");
    setEditingHours(false);
    setFailure(null);
    setPendingAction(null);
    mutation.reset();
  }, [shift?.id]);

  if (!shift) return <Sheet onClose={onClose} title="Shift status" visible={false}>{null}</Sheet>;

  const editor = contractorShiftEditor(shift);
  const status = shiftStatusLabel(shift.occurrenceKind);
  const paidMinutes = hours * 60 + minutes;
  const paidMinutesError = editingHours ? contractorShiftPaidMinutesError(paidMinutes) : null;
  const busy = mutation.isPending;

  const fail = (message: string) => {
    setFailure(message);
    setPendingAction(null);
  };

  const submit = (action: ContractorShiftAction, paid?: number, note?: string) => {
    if (busy || editor.mode !== "edit") return;
    if (!online) {
      fail(CONTRACTOR_SHIFT_MESSAGES.offline);
      return;
    }
    setFailure(null);
    setPendingAction(action);
    mutation.mutate(
      { entryId: shift.id, action, paidMinutes: paid, reason: note },
      {
        onSuccess: (next) => {
          if (next.id !== shift.id) return;
          const parts = initialPaidParts(next);
          setHours(parts.hours);
          setMinutes(parts.minutes);
          setReason(next.reason);
          setPendingAction(null);
          setEditingHours(false);
          onShift(next);
        },
        onError: (error) => {
          setPendingAction(null);
          fail(error instanceof ContractorShiftMutationFailure ? error.detail.message : CONTRACTOR_SHIFT_MESSAGES.unavailable);
        },
      },
    );
  };

  const saveHours = () => {
    if (paidMinutesError) {
      fail(paidMinutesError);
      return;
    }
    submit("different_hours", paidMinutes, reason);
  };

  return (
    <Sheet closeLabel="Close shift status" onClose={onClose} title={shift.siteName} visible>
      <Text style={styles.meta}>{formatDayHeading(shift.workDate)}</Text>
      <Text style={styles.meta}>{formatShiftTime(shift)}</Text>
      <View style={styles.statusRow}>
        <Text style={styles.statusLabel}>Current status</Text>
        <StatusPill label={status} />
      </View>
      {shift.reason ? <Text style={styles.meta}>{shift.reason}</Text> : null}
      {editor.mode !== "edit" ? <Text accessibilityRole="alert" style={styles.notice}>{editor.message}</Text> : null}
      {failure ? <Text accessibilityRole="alert" style={styles.error}>{failure}</Text> : null}
      {busy ? <Text accessibilityLiveRegion="polite" style={styles.notice}>Saving…</Text> : null}
      {editor.mode === "edit" && !editingHours ? CONTRACTOR_SHIFT_ACTIONS.map((item) => {
        const Button = item.action === "absent" ? DestructiveButton : item.action === "worked_as_scheduled" ? PrimaryButton : SecondaryButton;
        const saving = busy && pendingAction === item.action;
        return (
          <Button
            accessibilityLabel={saving ? `Saving ${item.label}` : item.label}
            busy={saving}
            disabled={busy}
            key={item.action}
            onPress={() => {
              if (item.action === "different_hours") {
                setFailure(null);
                setEditingHours(true);
                return;
              }
              submit(item.action);
            }}
          >
            {saving ? "Saving…" : item.label}
          </Button>
        );
      }) : null}
      {editor.mode === "edit" && editingHours ? (
        <View style={styles.editor}>
          <Text style={styles.editorTitle}>Hours for this day</Text>
          <View style={styles.stepperRow}>
            <Text style={styles.stepperLabel}>Hours</Text>
            <SecondaryButton accessibilityLabel="Decrease hours" disabled={busy || hours === 0} onPress={() => setHours((value) => Math.max(0, value - 1))} style={styles.stepperButton}>−</SecondaryButton>
            <Text style={styles.stepperValue}>{hours}</Text>
            <SecondaryButton accessibilityLabel="Increase hours" disabled={busy || hours === 23} onPress={() => setHours((value) => Math.min(23, value + 1))} style={styles.stepperButton}>+</SecondaryButton>
          </View>
          <View style={styles.stepperRow}>
            <Text style={styles.stepperLabel}>Minutes</Text>
            <SecondaryButton accessibilityLabel="Decrease minutes" disabled={busy || minutes === 0} onPress={() => setMinutes((value) => stepMinutes(value, -1))} style={styles.stepperButton}>−</SecondaryButton>
            <Text style={styles.stepperValue}>{String(minutes).padStart(2, "0")}</Text>
            <SecondaryButton accessibilityLabel="Increase minutes" disabled={busy || minutes >= 45} onPress={() => setMinutes((value) => stepMinutes(value, 1))} style={styles.stepperButton}>+</SecondaryButton>
          </View>
          <TextInput
            accessibilityLabel="Reason for these hours, optional"
            editable={!busy}
            maxLength={200}
            onChangeText={setReason}
            placeholder="Optional reason"
            placeholderTextColor={theme.muted}
            style={styles.input}
            value={reason}
          />
          {paidMinutesError ? <Text accessibilityRole="alert" style={styles.error}>{paidMinutesError}</Text> : null}
          <PrimaryButton
            accessibilityLabel={busy ? "Saving different hours" : "Save different hours"}
            busy={busy && pendingAction === "different_hours"}
            disabled={busy || paidMinutesError != null}
            onPress={saveHours}
          >
            {busy && pendingAction === "different_hours" ? "Saving…" : "Save different hours"}
          </PrimaryButton>
          <SecondaryButton accessibilityLabel="Back to shift status" disabled={busy} onPress={() => setEditingHours(false)}>
            Back
          </SecondaryButton>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  meta: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    flexShrink: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    minHeight: theme.touchTarget,
  },
  statusLabel: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontWeight: "700",
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
  },
  editorTitle: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 24,
    fontWeight: "700",
  },
  input: {
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.muted,
    borderRadius: theme.radius,
    color: theme.text,
    paddingHorizontal: spacing.sm,
    fontSize: typeScale.body,
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
