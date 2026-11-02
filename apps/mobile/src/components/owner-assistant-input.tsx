import type { OwnerAssistantFormSubmission, OwnerAssistantGuidedInput } from "@cleantrack/core";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ownerContractorFormPayload, rateCentsFromText, type OwnerContractorFormDraft } from "@/owner-team";
import { Card, PrimaryButton, spacing, statusColors, theme, typeScale } from "@/ui";
import { OwnerWeekPicker } from "@/components/owner-week-picker";

type Submit = (form: OwnerAssistantFormSubmission) => Promise<boolean>;

function Field({
  label,
  onChangeText,
  placeholder,
  value,
  keyboardType = "default",
}: {
  label: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  value: string;
  keyboardType?: "default" | "email-address" | "phone-pad" | "decimal-pad";
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      autoCapitalize={keyboardType === "email-address" ? "none" : "sentences"}
      keyboardType={keyboardType}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.mutedHighContrast}
      style={styles.input}
      value={value}
    />
  </View>;
}

function ChoiceGroup({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return <View style={styles.field}>
    <Text style={styles.label}>{label}</Text>
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = value === option.value;
        return <Pressable
          accessibilityLabel={`${label}: ${option.label}`}
          accessibilityRole="button"
          accessibilityState={{ selected }}
          key={option.value}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}
        >
          <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
        </Pressable>;
      })}
    </View>
  </View>;
}

function FormError({ children }: { children: string }) {
  return <Text accessibilityLiveRegion="polite" accessibilityRole="alert" selectable style={styles.error}>{children}</Text>;
}

function ContractorInput({ busy, onSubmit }: { busy: boolean; onSubmit: Submit }) {
  const [draft, setDraft] = useState<OwnerContractorFormDraft>({ name: "", email: "", phone: "", defaultRate: "" });
  const [error, setError] = useState("");
  const update = (field: keyof OwnerContractorFormDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError("");
  };
  const submit = async () => {
    const parsed = ownerContractorFormPayload(draft);
    if (!parsed.ok) {
      setError(Object.values(parsed.fields)[0] ?? "Check the contractor details.");
      return;
    }
    await onSubmit({ operation: "create_contractor", ...parsed.payload });
  };
  return <Card style={styles.card}>
    <Text style={styles.title}>Contractor details</Text>
    <Field label="Name" onChangeText={(value) => update("name", value)} value={draft.name} />
    <Field keyboardType="email-address" label="Email (optional)" onChangeText={(value) => update("email", value)} value={draft.email} />
    <Field keyboardType="phone-pad" label="Phone (optional)" onChangeText={(value) => update("phone", value)} value={draft.phone} />
    <Field keyboardType="decimal-pad" label="Hourly rate (NZD)" onChangeText={(value) => update("defaultRate", value)} placeholder="32.50" value={draft.defaultRate} />
    {error ? <FormError>{error}</FormError> : null}
    <PrimaryButton accessibilityLabel="Review contractor details" busy={busy} disabled={busy} onPress={() => { void submit(); }}>Review contractor</PrimaryButton>
  </Card>;
}

function SiteInput({ busy, onSubmit }: { busy: boolean; onSubmit: Submit }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 100 || address.trim().length > 240) {
      setError("Enter a site name and keep the address under 240 characters.");
      return;
    }
    await onSubmit({ operation: "create_site", name: trimmedName, address: address.trim() });
  };
  return <Card style={styles.card}>
    <Text style={styles.title}>Site details</Text>
    <Field label="Site name" onChangeText={(value) => { setName(value); setError(""); }} value={name} />
    <Field label="Address (optional)" onChangeText={(value) => { setAddress(value); setError(""); }} value={address} />
    {error ? <FormError>{error}</FormError> : null}
    <PrimaryButton accessibilityLabel="Review site details" busy={busy} disabled={busy} onPress={() => { void submit(); }}>Review site</PrimaryButton>
  </Card>;
}

function AssignmentInput({ busy, input, onSubmit }: { busy: boolean; input: Extract<OwnerAssistantGuidedInput, { operation: "assign_site" }>; onSubmit: Submit }) {
  const [contractorName, setContractorName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");
  const submit = async () => {
    const rateCents = rate.trim() ? rateCentsFromText(rate) : null;
    if (!contractorName || !siteName) {
      setError("Choose both a contractor and a site.");
      return;
    }
    if (rate.trim() && rateCents == null) {
      setError("Enter an hourly override from NZ$15.00 to NZ$250.00, or leave it blank to inherit the contractor rate.");
      return;
    }
    await onSubmit({ operation: "assign_site", contractorName, siteName, rateCents });
  };
  return <Card style={styles.card}>
    <Text style={styles.title}>Assignment details</Text>
    <ChoiceGroup label="Contractor" onChange={(value) => { setContractorName(value); setError(""); }} options={input.contractors} value={contractorName} />
    <ChoiceGroup label="Site" onChange={(value) => { setSiteName(value); setError(""); }} options={input.sites} value={siteName} />
    <Field keyboardType="decimal-pad" label="Hourly override (optional)" onChangeText={(value) => { setRate(value); setError(""); }} placeholder="Leave blank to inherit" value={rate} />
    {error ? <FormError>{error}</FormError> : null}
    <PrimaryButton accessibilityLabel="Review assignment details" busy={busy} disabled={busy} onPress={() => { void submit(); }}>Review assignment</PrimaryButton>
  </Card>;
}

function RemittanceInput({ busy, input, onSubmit }: { busy: boolean; input: Extract<OwnerAssistantGuidedInput, { operation: "get_remittance" }>; onSubmit: Submit }) {
  const [contractorName, setContractorName] = useState("");
  const [weekStart, setWeekStart] = useState(input.weekStart);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!contractorName) {
      setError("Choose a contractor to continue.");
      return;
    }
    await onSubmit({ operation: "get_remittance", contractorName, weekStart });
  };
  return <Card style={styles.card}>
    <Text style={styles.title}>Remittance details</Text>
    <ChoiceGroup label="Contractor" onChange={(value) => { setContractorName(value); setError(""); }} options={input.contractors} value={contractorName} />
    <Text style={styles.label}>Week</Text>
    <OwnerWeekPicker onChange={setWeekStart} weekStart={weekStart} />
    {error ? <FormError>{error}</FormError> : null}
    <PrimaryButton accessibilityLabel="Check remittance" busy={busy} disabled={busy} onPress={() => { void submit(); }}>Check remittance</PrimaryButton>
  </Card>;
}

export function OwnerAssistantInput({
  busy,
  input,
  onSubmit,
}: {
  busy: boolean;
  input: OwnerAssistantGuidedInput;
  onSubmit: Submit;
}) {
  if (input.operation === "create_contractor") return <ContractorInput busy={busy} onSubmit={onSubmit} />;
  if (input.operation === "create_site") return <SiteInput busy={busy} onSubmit={onSubmit} />;
  if (input.operation === "assign_site") return <AssignmentInput busy={busy} input={input} onSubmit={onSubmit} />;
  return <RemittanceInput busy={busy} input={input} onSubmit={onSubmit} />;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surfaceRaised },
  title: { color: theme.text, fontSize: typeScale.body, fontWeight: "700" },
  field: { gap: spacing.xs },
  label: { color: theme.mutedHighContrast, fontSize: typeScale.subhead, fontWeight: "700" },
  input: {
    backgroundColor: theme.surface,
    borderColor: statusColors.neutral,
    borderRadius: theme.radius,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    color: theme.text,
    fontSize: typeScale.body,
    minHeight: theme.touchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  choice: {
    backgroundColor: theme.surface,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: statusColors.neutral,
    minHeight: theme.touchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  choiceSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
  choiceText: { color: theme.text, fontSize: typeScale.subhead, fontWeight: "700" },
  choiceTextSelected: { color: theme.accentText },
  pressed: { opacity: 0.72 },
  error: { color: statusColors.danger, fontSize: typeScale.subhead, lineHeight: 20 },
});
