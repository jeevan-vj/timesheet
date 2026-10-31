import type { PortalRemittanceTarget } from "@cleantrack/core/portal";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { contractorRemittanceMessage, type ContractorRemittanceTarget } from "@/contractor-remittance";
import { shareContractorRemittance } from "@/contractor-remittance-native";
import { SecondaryButton, spacing, statusColors, typeScale } from "@/ui";

export function ContractorRemittanceActions({
  remittances,
  weekStart,
  weekEnd,
}: {
  remittances: PortalRemittanceTarget[];
  weekStart: string;
  weekEnd: string;
}) {
  const [busyBusiness, setBusyBusiness] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const download = async (remittance: PortalRemittanceTarget) => {
    if (busyBusiness) return;
    setBusyBusiness(remittance.businessId);
    setError(null);
    const target: ContractorRemittanceTarget = { ...remittance, weekStart, weekEnd };
    try {
      await shareContractorRemittance(target);
    } catch (reason) {
      setError(reason);
    } finally {
      setBusyBusiness(null);
    }
  };

  if (remittances.length === 0) return null;
  const copy = error ? contractorRemittanceMessage(error) : null;
  return (
    <View style={styles.stack}>
      {remittances.map((remittance) => {
        const label = remittances.length === 1
          ? "View or download remittance PDF"
          : `View or download ${remittance.businessName} remittance PDF`;
        return (
          <SecondaryButton
            accessibilityLabel={label}
            busy={busyBusiness === remittance.businessId}
            disabled={busyBusiness != null}
            key={remittance.businessId}
            onPress={() => { void download(remittance); }}
          >
            {busyBusiness === remittance.businessId ? "Preparing PDF…" : label}
          </SecondaryButton>
        );
      })}
      {copy ? <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.error}>{copy.title}. {copy.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.xs },
  error: { color: statusColors.danger, fontSize: typeScale.subhead, lineHeight: 22 },
});
