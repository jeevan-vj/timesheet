import {
  contractorMayHoldPortalAccess,
  ownerEngagementLabel,
  ownerInvitationLabel,
  type OwnerContractor,
  type OwnerInvitation,
} from "@cleantrack/core";
import { useEffect, useState } from "react";
import { Share, StyleSheet, Text, TextInput, View } from "react-native";
import { OwnerTeamMutationFailure, useOwnerTeamMutation } from "@/owner-mutations-client";
import {
  ownerContractorFormPayload,
  type OwnerContractorFormDraft,
  type OwnerContractorFormField,
  type OwnerInvitationIssue,
  type OwnerTeamAction,
} from "@/owner-team";
import {
  Card,
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
import type { StatusPillLabel } from "@/ui/status-tone";

const EMPTY_DRAFT: OwnerContractorFormDraft = {
  name: "",
  email: "",
  phone: "",
  defaultRate: "",
};

function contractorDraft(contractor: OwnerContractor | null): OwnerContractorFormDraft {
  if (!contractor) return EMPTY_DRAFT;
  return {
    name: contractor.name,
    email: contractor.email,
    phone: contractor.phone,
    defaultRate: (contractor.defaultRateCents / 100).toFixed(2),
  };
}

export function OwnerContractorFormSheet({
  contractor,
  onClose,
  onSaved,
  visible,
}: {
  contractor: OwnerContractor | null;
  onClose: () => void;
  onSaved: (contractor: OwnerContractor) => void;
  visible: boolean;
}) {
  const mutation = useOwnerTeamMutation();
  const [draft, setDraft] = useState<OwnerContractorFormDraft>(EMPTY_DRAFT);
  const [fields, setFields] = useState<Partial<Record<OwnerContractorFormField, string>>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    setDraft(contractorDraft(contractor));
    setFields({});
    setError("");
    mutation.reset();
  }, [contractor, visible]);

  function update(field: OwnerContractorFormField, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setFields((current) => ({ ...current, [field]: undefined }));
  }

  async function save() {
    if (mutation.isPending) return;
    const parsed = ownerContractorFormPayload(draft);
    if (!parsed.ok) {
      setFields(parsed.fields);
      setError("");
      return;
    }
    setFields({});
    setError("");
    const action: OwnerTeamAction = contractor
      ? { kind: "update", contractorId: contractor.id, payload: parsed.payload }
      : { kind: "create", payload: parsed.payload };
    try {
      const result = await mutation.mutateAsync(action);
      if (!("contractor" in result.body)) throw new Error("invalid response");
      mutation.reset();
      onSaved(result.body.contractor);
    } catch (caught) {
      if (caught instanceof OwnerTeamMutationFailure) {
        setError(caught.detail.message);
        if (caught.detail.fields) setFields(caught.detail.fields);
        return;
      }
      setError("CleanTrack couldn't save this contractor. Try again.");
    }
  }

  return (
    <Sheet
      closeLabel={`Close ${contractor ? "edit" : "add"} contractor`}
      onClose={() => { if (!mutation.isPending) onClose(); }}
      title={contractor ? "Edit contractor" : "Add contractor"}
      visible={visible}
    >
      <Text style={styles.intro}>Contact details stay private to this business. The hourly rate is stored in whole cents.</Text>
      <FormField
        error={fields.name}
        label="Name"
        onChangeText={(value) => update("name", value)}
        value={draft.name}
      />
      <FormField
        autoCapitalize="none"
        error={fields.email}
        keyboardType="email-address"
        label="Email"
        onChangeText={(value) => update("email", value)}
        value={draft.email}
      />
      <FormField
        error={fields.phone}
        keyboardType="phone-pad"
        label="Phone"
        onChangeText={(value) => update("phone", value)}
        value={draft.phone}
      />
      <FormField
        error={fields.defaultRate}
        keyboardType="decimal-pad"
        label="Default hourly rate (NZD)"
        onChangeText={(value) => update("defaultRate", value)}
        placeholder="32.50"
        value={draft.defaultRate}
      />
      {error ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        accessibilityLabel={contractor ? "Save contractor changes" : "Add contractor"}
        busy={mutation.isPending}
        disabled={mutation.isPending}
        onPress={() => { void save(); }}
      >
        {mutation.isPending ? "Saving…" : contractor ? "Save changes" : "Add contractor"}
      </PrimaryButton>
    </Sheet>
  );
}

function FormField({
  autoCapitalize = "sentences",
  error,
  keyboardType = "default",
  label,
  onChangeText,
  placeholder,
  value,
}: {
  autoCapitalize?: "none" | "sentences";
  error?: string;
  keyboardType?: "default" | "email-address" | "phone-pad" | "decimal-pad";
  label: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityState={{ disabled: false }}
        autoCapitalize={autoCapitalize}
        keyboardType={keyboardType}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.mutedHighContrast}
        style={[styles.input, error && styles.inputError]}
        value={value}
      />
      {error ? <Text accessibilityRole="alert" style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

export function OwnerInvitationActions({
  contractor,
  invitation,
}: {
  contractor: OwnerContractor;
  invitation: OwnerInvitation;
}) {
  const mutation = useOwnerTeamMutation();
  const [confirm, setConfirm] = useState<"invite" | "resend" | "revoke" | null>(null);
  const [issued, setIssued] = useState<OwnerInvitationIssue | null>(null);
  const [currentInvitation, setCurrentInvitation] = useState(invitation);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const eligible = contractorMayHoldPortalAccess(contractor.engagementStatus) && contractor.email.trim() !== "";
  const canIssue = (currentInvitation.state === "none" || currentInvitation.state === "revoked") && eligible;
  const canManagePending = currentInvitation.state === "pending" || currentInvitation.state === "expired";

  useEffect(() => {
    setCurrentInvitation(invitation);
  }, [invitation]);

  async function mutate(kind: "invite" | "resend" | "revoke") {
    if (mutation.isPending) return;
    setError("");
    setNotice("");
    try {
      const result = await mutation.mutateAsync({ kind, contractorId: contractor.id });
      setConfirm(null);
      if ("invitation" in result.body) setCurrentInvitation(result.body.invitation);
      if (kind === "revoke") {
        setIssued(null);
        setNotice("Invitation revoked.");
      } else if ("inviteLink" in result.body) {
        const next = result.body;
        setIssued(next.delivery === "email" ? null : next);
        setNotice(next.delivery === "email"
          ? "Invitation email sent."
          : next.delivery === "link_only"
            ? "Email delivery is not configured. Share the one-time link privately."
            : "Email could not be sent. Share the one-time link privately.");
      }
      mutation.reset();
    } catch (caught) {
      setError(caught instanceof OwnerTeamMutationFailure
        ? caught.detail.message
        : "CleanTrack couldn't update this invitation. Try again.");
    }
  }

  async function shareInvite() {
    if (!issued) return;
    try {
      await Share.share({ message: issued.inviteLink, title: "CleanTrack invitation" });
      setNotice("Invitation link opened in the share sheet.");
    } catch {
      setError("The share sheet could not open. Try again.");
    }
  }

  const status = ownerInvitationLabel(currentInvitation.state) as StatusPillLabel;
  return (
    <Card>
      <Text style={styles.sectionTitle}>Portal invitation</Text>
      <StatusPill label={status} />
      {currentInvitation.expiresAt && canManagePending ? <Text style={styles.muted}>Expires {currentInvitation.expiresAt.slice(0, 10)}</Text> : null}
      {!contractor.email.trim() && contractorMayHoldPortalAccess(contractor.engagementStatus) ? (
        <Text style={styles.muted}>Add an email address before sending an invitation.</Text>
      ) : null}
      {!contractorMayHoldPortalAccess(contractor.engagementStatus) ? (
        <Text style={styles.muted}>Only invited or active contractors can receive portal access.</Text>
      ) : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        {canIssue ? (
          <PrimaryButton accessibilityLabel={`Invite ${contractor.name}`} disabled={mutation.isPending} onPress={() => setConfirm("invite")}>
            Invite contractor
          </PrimaryButton>
        ) : null}
        {canManagePending ? (
          <SecondaryButton accessibilityLabel={`Resend invitation to ${contractor.name}`} disabled={mutation.isPending} onPress={() => setConfirm("resend")}>
            Resend invitation
          </SecondaryButton>
        ) : null}
        {canManagePending ? (
          <DestructiveButton accessibilityLabel={`Revoke invitation for ${contractor.name}`} disabled={mutation.isPending} onPress={() => setConfirm("revoke")}>
            Revoke invitation
          </DestructiveButton>
        ) : null}
        {issued ? (
          <PrimaryButton accessibilityLabel={`Share invitation link for ${contractor.name}`} onPress={() => { void shareInvite(); }}>
            Share invite link
          </PrimaryButton>
        ) : null}
      </View>
      <InvitationConfirmation
        action={confirm}
        busy={mutation.isPending}
        contractorName={contractor.name}
        onCancel={() => { if (!mutation.isPending) setConfirm(null); }}
        onConfirm={() => { if (confirm) void mutate(confirm); }}
      />
    </Card>
  );
}

function InvitationConfirmation({
  action,
  busy,
  contractorName,
  onCancel,
  onConfirm,
}: {
  action: "invite" | "resend" | "revoke" | null;
  busy: boolean;
  contractorName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (action == null) return null;
  const verb = action === "resend" ? "Resend" : action === "revoke" ? "Revoke" : "Send";
  return (
    <Sheet closeLabel="Close invitation confirmation" onClose={onCancel} title={`${verb} invitation?`} visible>
      <Text style={styles.body}>
        {action === "revoke"
          ? `${contractorName} will no longer be able to use the pending invitation.`
          : `${contractorName} will receive a link to their CleanTrack portal.`}
      </Text>
      {action === "revoke" ? (
        <DestructiveButton accessibilityLabel={`Confirm revoke invitation for ${contractorName}`} busy={busy} disabled={busy} onPress={onConfirm}>
          {busy ? "Revoking…" : "Revoke invitation"}
        </DestructiveButton>
      ) : (
        <PrimaryButton accessibilityLabel={`Confirm ${verb.toLowerCase()} invitation to ${contractorName}`} busy={busy} disabled={busy} onPress={onConfirm}>
          {busy ? "Sending…" : `${verb} invitation`}
        </PrimaryButton>
      )}
    </Sheet>
  );
}

export function OwnerContractorLifecycleActions({
  contractor,
  onEdit,
  onArchived,
}: {
  contractor: OwnerContractor;
  onEdit: () => void;
  onArchived: () => void;
}) {
  const mutation = useOwnerTeamMutation();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [error, setError] = useState("");

  async function changeLifecycle(kind: "archive" | "restore") {
    if (mutation.isPending) return;
    setError("");
    try {
      await mutation.mutateAsync({ kind, contractorId: contractor.id });
      mutation.reset();
      setConfirmArchive(false);
      if (kind === "archive") onArchived();
    } catch (caught) {
      setError(caught instanceof OwnerTeamMutationFailure
        ? caught.detail.message
        : `CleanTrack couldn't ${kind} this contractor. Try again.`);
    }
  }

  const archived = contractor.engagementStatus === "archived";
  return (
    <Card>
      <Text style={styles.sectionTitle}>Manage contractor</Text>
      <StatusPill label={ownerEngagementLabel(contractor.engagementStatus) as StatusPillLabel} />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        <SecondaryButton accessibilityLabel={`Edit ${contractor.name}`} disabled={mutation.isPending} onPress={onEdit}>
          Edit details
        </SecondaryButton>
        {archived ? (
          <PrimaryButton accessibilityLabel={`Restore ${contractor.name}`} busy={mutation.isPending} disabled={mutation.isPending} onPress={() => { void changeLifecycle("restore"); }}>
            {mutation.isPending ? "Restoring…" : "Restore contractor"}
          </PrimaryButton>
        ) : (
          <DestructiveButton accessibilityLabel={`Archive ${contractor.name}`} disabled={mutation.isPending} onPress={() => setConfirmArchive(true)}>
            Archive contractor
          </DestructiveButton>
        )}
      </View>
      {confirmArchive ? (
        <Sheet closeLabel="Close archive confirmation" onClose={() => { if (!mutation.isPending) setConfirmArchive(false); }} title="Archive contractor?" visible>
          <Text style={styles.body}>{contractor.name} will be removed from new scheduling. Historical shifts and pay will stay unchanged.</Text>
          <DestructiveButton accessibilityLabel={`Confirm archive ${contractor.name}`} busy={mutation.isPending} disabled={mutation.isPending} onPress={() => { void changeLifecycle("archive"); }}>
            {mutation.isPending ? "Archiving…" : "Archive contractor"}
          </DestructiveButton>
        </Sheet>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  intro: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  field: {
    gap: spacing.xs,
  },
  label: {
    color: theme.text,
    fontSize: typeScale.subhead,
    lineHeight: 22,
    fontWeight: "700",
  },
  input: {
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.muted,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    backgroundColor: theme.surface,
    color: theme.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typeScale.body,
  },
  inputError: {
    borderColor: statusColors.danger,
  },
  fieldError: {
    color: statusColors.danger,
    fontSize: typeScale.caption,
    lineHeight: 18,
  },
  error: {
    color: statusColors.danger,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  notice: {
    color: statusColors.success,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  muted: {
    color: theme.mutedHighContrast,
    fontSize: typeScale.subhead,
    lineHeight: 22,
  },
  sectionTitle: {
    color: theme.text,
    fontSize: typeScale.title,
    lineHeight: 28,
    fontWeight: "700",
  },
  body: {
    color: theme.text,
    fontSize: typeScale.body,
    lineHeight: 25,
  },
  actions: {
    gap: spacing.sm,
  },
});
