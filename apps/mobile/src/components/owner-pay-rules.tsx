import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { mobileFetch } from "@/api";
import { Card, PrimaryButton, SecondaryButton, SectionHeader, spacing, theme, typeScale } from "@/ui";

type PayRules = {
  holidayMode: "off" | "multiplier";
  holidayMultiplierBps: number | null;
  useNzPublicHolidays: boolean;
  weekendSaturdayMultiplierBps: number | null;
  weekendSundayMultiplierBps: number | null;
  overnightStartMinutes: number | null;
  overnightEndMinutes: number | null;
  overnightMultiplierBps: number | null;
};

type Holiday = { id: string; holidayDate: string; name: string };

const defaults: PayRules = { holidayMode: "off", holidayMultiplierBps: null, useNzPublicHolidays: false, weekendSaturdayMultiplierBps: null, weekendSundayMultiplierBps: null, overnightStartMinutes: null, overnightEndMinutes: null, overnightMultiplierBps: null };

function textNumber(value: number | null): string {
  return value == null ? "" : String(value);
}

function optionalNumber(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

async function json(path: string, init?: RequestInit) {
  const response = await mobileFetch(path, init);
  if (!response.ok) throw new Error("request_failed");
  return response.json();
}

export function OwnerPayRules() {
  const [rules, setRules] = useState(defaults);
  const [holidayMultiplier, setHolidayMultiplier] = useState("");
  const [saturday, setSaturday] = useState("");
  const [sunday, setSunday] = useState("");
  const [overnightStart, setOvernightStart] = useState("");
  const [overnightEnd, setOvernightEnd] = useState("");
  const [overnightMultiplier, setOvernightMultiplier] = useState("");
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayDate, setHolidayDate] = useState("");
  const [holidayName, setHolidayName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [next, holidayResponse] = await Promise.all([json("/api/business/pay-rules"), json("/api/business/holidays")]) as [PayRules, { holidays: Holiday[] }];
      setRules(next);
      setHolidayMultiplier(textNumber(next.holidayMultiplierBps));
      setSaturday(textNumber(next.weekendSaturdayMultiplierBps));
      setSunday(textNumber(next.weekendSundayMultiplierBps));
      setOvernightStart(textNumber(next.overnightStartMinutes));
      setOvernightEnd(textNumber(next.overnightEndMinutes));
      setOvernightMultiplier(textNumber(next.overnightMultiplierBps));
      setHolidays(holidayResponse.holidays);
    } catch {
      setMessage("Could not load pay rules.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setMessage("");
    const overnightEnabled = overnightStart.trim() !== "" || overnightEnd.trim() !== "" || overnightMultiplier.trim() !== "";
    const next: PayRules = {
      ...rules,
      holidayMultiplierBps: rules.holidayMode === "multiplier" ? optionalNumber(holidayMultiplier) : null,
      weekendSaturdayMultiplierBps: optionalNumber(saturday),
      weekendSundayMultiplierBps: optionalNumber(sunday),
      overnightStartMinutes: overnightEnabled ? optionalNumber(overnightStart) : null,
      overnightEndMinutes: overnightEnabled ? optionalNumber(overnightEnd) : null,
      overnightMultiplierBps: overnightEnabled ? optionalNumber(overnightMultiplier) : null,
    };
    try {
      setRules(await json("/api/business/pay-rules", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }) as PayRules);
      setMessage("Pay rules saved. Existing shifts were not changed.");
    } catch {
      setMessage("Check multiplier basis points and overnight minutes.");
    } finally {
      setBusy(false);
    }
  };

  const addHoliday = async () => {
    if (!holidayDate || !holidayName.trim()) return;
    setBusy(true);
    try {
      await json("/api/business/holidays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ holidayDate, name: holidayName }) });
      setHolidayDate("");
      setHolidayName("");
      await load();
      setMessage("Holiday added.");
    } catch {
      setMessage("Could not add that holiday.");
    } finally {
      setBusy(false);
    }
  };

  const removeHoliday = async (id: string) => {
    setBusy(true);
    try {
      await json(`/api/business/holidays/${id}`, { method: "DELETE" });
      await load();
      setMessage("Holiday removed.");
    } catch {
      setMessage("Could not remove that holiday.");
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.stack}>
    <SectionHeader>Pay rules</SectionHeader>
    <Card><View style={styles.stack}>
      <View style={styles.row}><Text style={styles.label}>Public holiday multiplier</Text><Switch value={rules.holidayMode === "multiplier"} onValueChange={(enabled) => setRules((value) => ({ ...value, holidayMode: enabled ? "multiplier" : "off" }))} /></View>
      {rules.holidayMode === "multiplier" ? <Field label="Holiday multiplier basis points" value={holidayMultiplier} onChangeText={setHolidayMultiplier} placeholder="15000 = 1.5x" /> : null}
      <View style={styles.row}><Text style={styles.label}>Use NZ public holidays</Text><Switch value={rules.useNzPublicHolidays} onValueChange={(value) => setRules((current) => ({ ...current, useNzPublicHolidays: value }))} /></View>
      <Field label="Saturday multiplier basis points" value={saturday} onChangeText={setSaturday} />
      <Field label="Sunday multiplier basis points" value={sunday} onChangeText={setSunday} />
      <Field label="Overnight start minutes" value={overnightStart} onChangeText={setOvernightStart} placeholder="1320 for 22:00" />
      <Field label="Overnight end minutes" value={overnightEnd} onChangeText={setOvernightEnd} placeholder="360 for 06:00" />
      <Field label="Overnight multiplier basis points" value={overnightMultiplier} onChangeText={setOvernightMultiplier} />
      <PrimaryButton accessibilityLabel="Save pay rules" busy={busy} disabled={busy} onPress={() => void save()}>Save pay rules</PrimaryButton>
    </View></Card>
    <SectionHeader>Owner holidays</SectionHeader>
    {holidays.map((holiday) => <Card key={holiday.id}><View style={styles.row}><View><Text style={styles.label}>{holiday.name}</Text><Text style={styles.sub}>{holiday.holidayDate}</Text></View><SecondaryButton accessibilityLabel={`Delete ${holiday.name}`} disabled={busy} onPress={() => void removeHoliday(holiday.id)}>Delete</SecondaryButton></View></Card>)}
    <Card><View style={styles.stack}><Field label="Holiday date (YYYY-MM-DD)" value={holidayDate} onChangeText={setHolidayDate} /><Field label="Holiday name" value={holidayName} onChangeText={setHolidayName} keyboard="default" /><SecondaryButton accessibilityLabel="Add owner holiday" disabled={busy || !holidayDate || !holidayName.trim()} onPress={() => void addHoliday()}>Add holiday</SecondaryButton></View></Card>
    {message ? <Text accessibilityRole="alert" style={styles.sub}>{message}</Text> : null}
  </View>;
}

function Field({ label, value, onChangeText, placeholder, keyboard = "number-pad" }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; keyboard?: "number-pad" | "default" }) {
  return <View style={styles.stack}><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} keyboardType={keyboard} placeholder={placeholder} placeholderTextColor={theme.muted} style={styles.input} value={value} onChangeText={onChangeText} /></View>;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  label: { color: theme.text, fontSize: typeScale.body, lineHeight: 22, fontWeight: "600" },
  sub: { color: theme.mutedHighContrast, fontSize: typeScale.subhead, lineHeight: 22 },
  input: { minHeight: theme.touchTarget, borderWidth: 1, borderColor: theme.muted, borderRadius: theme.radius, color: theme.text, paddingHorizontal: spacing.sm, fontSize: typeScale.body },
});
