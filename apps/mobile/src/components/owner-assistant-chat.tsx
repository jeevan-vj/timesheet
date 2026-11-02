import {
  formatMinutes,
  formatNzd,
  type OwnerAssistantFormSubmission,
  type OwnerAssistantHistoryMessage,
  type OwnerAssistantTurnResponse,
} from "@cleantrack/core";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { confirmOwnerAssistantChange, sendOwnerAssistantTurn } from "@/owner-assistant-client";
import { OwnerAssistantInput } from "@/components/owner-assistant-input";
import { Card, PrimaryButton, SecondaryButton, spacing, statusColors, theme, typeScale } from "@/ui";

type ChatItem = { id: string; role: "user" | "assistant"; text: string; modelHistory: boolean; result?: OwnerAssistantTurnResponse };

function formSummary(form: OwnerAssistantFormSubmission): string {
  if (form.operation === "create_contractor") return "Review contractor details";
  if (form.operation === "create_site") return "Review site details";
  if (form.operation === "assign_site") return "Review assignment details";
  return "Check remittance details";
}

export function OwnerAssistantChat() {
  const queryClient = useQueryClient();
  const sequence = useRef(0);
  const nextId = () => `chat-${Date.now()}-${sequence.current += 1}`;
  const [items, setItems] = useState<ChatItem[]>([{ id: "welcome", role: "assistant", modelHistory: true, text: "I can prepare contractors, sites and assignments, or verify a weekly remittance. I’ll show every change before saving." }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    const history: OwnerAssistantHistoryMessage[] = items.filter((item) => item.modelHistory).slice(-8).map((item) => ({ role: item.role, content: item.text }));
    setItems((current) => [...current, { id: nextId(), role: "user", modelHistory: true, text: message }]);
    setDraft(""); setBusy(true);
    try {
      const result = await sendOwnerAssistantTurn(message, history);
      setItems((current) => [...current, { id: nextId(), role: "assistant", modelHistory: result.kind === "message", text: result.message, result }]);
    } catch (error) {
      setItems((current) => [...current, { id: nextId(), role: "assistant", modelHistory: false, text: error instanceof Error ? error.message : "The assistant is unavailable." }]);
    } finally { setBusy(false); }
  }

  async function submitInput(itemId: string, form: OwnerAssistantFormSubmission): Promise<boolean> {
    if (busy) return false;
    const message = formSummary(form);
    const history: OwnerAssistantHistoryMessage[] = items.filter((item) => item.modelHistory).slice(-8).map((item) => ({ role: item.role, content: item.text }));
    setItems((current) => [...current, { id: nextId(), role: "user", modelHistory: false, text: message }]);
    setBusy(true);
    try {
      const result = await sendOwnerAssistantTurn(message, history, form);
      setItems((current) => current
        .map((item) => item.id === itemId ? { ...item, result: undefined } : item)
        .concat({ id: nextId(), role: "assistant", modelHistory: result.kind === "message", text: result.message, result }));
      return true;
    } catch (error) {
      setItems((current) => [...current, { id: nextId(), role: "assistant", modelHistory: false, text: error instanceof Error ? error.message : "The assistant is unavailable." }]);
      return false;
    } finally { setBusy(false); }
  }

  async function confirm(token: string, itemId: string) {
    setBusy(true);
    try {
      const receipt = await confirmOwnerAssistantChange(token);
      setItems((current) => current.map((item) => item.id === itemId ? { ...item, result: undefined } : item).concat({ id: nextId(), role: "assistant", modelHistory: false, text: receipt.message }));
      await queryClient.invalidateQueries();
    } catch (error) {
      setItems((current) => [...current, { id: nextId(), role: "assistant", modelHistory: false, text: error instanceof Error ? error.message : "The change was not saved." }]);
    } finally { setBusy(false); }
  }

  return <View style={styles.layout}>
    <Text style={styles.intro}>AI prepares the request; CleanTrack checks owner access, records and pay totals.</Text>
    {items.map((item) => <View key={item.id} style={[styles.message, item.role === "user" ? styles.userMessage : styles.assistantMessage]}>
      <Text style={[styles.messageText, item.role === "user" && styles.userText]}>{item.text}</Text>
      {item.result?.kind === "input" ? <OwnerAssistantInput busy={busy} input={item.result.input} onSubmit={(form) => submitInput(item.id, form)} /> : null}
      {item.result?.kind === "preview" ? <Card style={styles.result}>
        <Text style={styles.resultTitle}>{item.result.confirmation.title}</Text>
        {item.result.confirmation.details.map((detail) => <View key={detail.label} style={styles.detail}><Text style={styles.detailLabel}>{detail.label}</Text><Text style={styles.detailValue}>{detail.value}</Text></View>)}
        <PrimaryButton accessibilityLabel="Confirm and save assistant change" busy={busy} disabled={busy} onPress={() => { const result = item.result; if (result?.kind === "preview") void confirm(result.confirmation.token, item.id); }}>Confirm & save</PrimaryButton>
        <SecondaryButton accessibilityLabel="Cancel assistant change" disabled={busy} onPress={() => setItems((current) => current.map((row) => row.id === item.id ? { ...row, result: undefined } : row))}>Cancel</SecondaryButton>
      </Card> : null}
      {item.result?.kind === "remittance" ? <Card style={styles.result}>
        <Text style={styles.resultTitle}>{item.result.verification.status === "verified" ? "Verified remittance" : "Remittance review"}</Text>
        <Text style={styles.detailLabel}>{item.result.verification.detail}</Text>
        {item.result.remittance.lines.map((line) => <View key={`${line.workDate}-${line.siteName}`} style={styles.detail}><Text style={styles.detailLabel}>{line.workDate}{"\n"}{line.siteName}</Text><Text style={styles.detailValue}>{formatMinutes(line.paidMinutes)}{"\n"}{formatNzd(line.payCents)}</Text></View>)}
        <View style={[styles.detail, styles.total]}><Text style={styles.resultTitle}>Total</Text><Text style={styles.resultTitle}>{formatMinutes(item.result.remittance.paidMinutes)} · {formatNzd(item.result.remittance.payCents)}</Text></View>
      </Card> : null}
    </View>)}
    {busy ? <Text accessibilityRole="text" style={styles.checking}>Checking CleanTrack…</Text> : null}
    <Card style={styles.composer}><TextInput accessibilityLabel="Message CleanTrack assistant" editable={!busy} maxLength={500} multiline onChangeText={setDraft} placeholder="Show Ana's remittance for last week" placeholderTextColor={theme.mutedHighContrast} style={styles.input} value={draft} /><PrimaryButton accessibilityLabel="Send message" disabled={busy || !draft.trim()} onPress={() => void send()}>Send</PrimaryButton></Card>
  </View>;
}

const styles = StyleSheet.create({
  layout: { gap: spacing.sm }, intro: { color: theme.mutedHighContrast, fontSize: typeScale.subhead, lineHeight: 21 },
  message: { borderRadius: theme.radius, gap: spacing.sm, maxWidth: "94%", padding: spacing.md },
  assistantMessage: { alignSelf: "flex-start", backgroundColor: theme.surface }, userMessage: { alignSelf: "flex-end", backgroundColor: theme.accent },
  messageText: { color: theme.text, fontSize: typeScale.body, lineHeight: 24 }, userText: { color: theme.accentText },
  result: { backgroundColor: theme.surfaceRaised }, resultTitle: { color: theme.text, fontSize: typeScale.body, fontWeight: "700" },
  detail: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" }, detailLabel: { color: theme.mutedHighContrast, flex: 1, fontSize: typeScale.subhead }, detailValue: { color: theme.text, flex: 1, fontSize: typeScale.subhead, fontWeight: "700", textAlign: "right" },
  total: { borderTopColor: statusColors.neutral, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.sm },
  checking: { color: theme.mutedHighContrast, fontSize: typeScale.subhead }, composer: { marginTop: spacing.sm },
  input: { color: theme.text, fontSize: typeScale.body, minHeight: 88, textAlignVertical: "top" },
});
