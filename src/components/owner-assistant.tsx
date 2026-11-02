"use client";

import {
  ownerAssistantConfirmResponseSchema,
  ownerAssistantTurnResponseSchema,
  type OwnerAssistantHistoryMessage,
  type OwnerAssistantTurnResponse,
} from "@cleantrack/core";
import { FormEvent, useState } from "react";

type ChatItem = { id: string; role: "user" | "assistant"; text: string; modelHistory: boolean; result?: OwnerAssistantTurnResponse };

async function post(path: string, body: unknown) {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error("The assistant could not complete that request. Please try again.");
  return data;
}

function money(cents: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100);
}

export function OwnerAssistant({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<ChatItem[]>([{ id: "welcome", role: "assistant", modelHistory: true, text: "I can prepare contractors, sites and assignments, or verify a weekly remittance. I’ll always show changes before saving." }]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    const history: OwnerAssistantHistoryMessage[] = items.filter((item) => item.modelHistory).slice(-8).map((item) => ({ role: item.role, content: item.text }));
    setItems((current) => [...current, { id: crypto.randomUUID(), role: "user", modelHistory: true, text: message }]);
    setDraft(""); setBusy(true);
    try {
      const result = ownerAssistantTurnResponseSchema.parse(await post("/api/owner-assistant/turn", { message, history }));
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", modelHistory: result.kind === "message", text: result.message, result }]);
    } catch (error) {
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", modelHistory: false, text: error instanceof Error ? error.message : "The assistant is unavailable." }]);
    } finally { setBusy(false); }
  }

  async function confirm(token: string, itemId: string) {
    setBusy(true);
    try {
      const receipt = ownerAssistantConfirmResponseSchema.parse(await post("/api/owner-assistant/confirm", { token }));
      setItems((current) => current.map((item) => item.id === itemId ? { ...item, result: undefined } : item).concat({ id: crypto.randomUUID(), role: "assistant", modelHistory: false, text: receipt.message }));
      onChanged();
    } catch (error) {
      setItems((current) => [...current, { id: crypto.randomUUID(), role: "assistant", modelHistory: false, text: error instanceof Error ? error.message : "The change was not saved." }]);
    } finally { setBusy(false); }
  }

  return <section className="assistant-panel" aria-labelledby="owner-assistant-title">
    <div><p className="eyebrow">Owner assistant</p><h2 id="owner-assistant-title">Ask CleanTrack</h2><p className="muted">AI prepares the request; CleanTrack verifies names, totals and permissions.</p></div>
    <div className="assistant-transcript" aria-live="polite">
      {items.map((item) => <div className={`assistant-message ${item.role}`} key={item.id}>
        <p>{item.text}</p>
        {item.result?.kind === "preview" ? <div className="assistant-result">
          <strong>{item.result.confirmation.title}</strong>
          <dl>{item.result.confirmation.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>
          <div className="assistant-actions"><button className="button" disabled={busy} onClick={() => { const result = item.result; if (result?.kind === "preview") void confirm(result.confirmation.token, item.id); }}>Confirm & save</button><button className="button secondary" disabled={busy} onClick={() => setItems((current) => current.map((row) => row.id === item.id ? { ...row, result: undefined } : row))}>Cancel</button></div>
        </div> : null}
        {item.result?.kind === "remittance" ? <div className="assistant-result">
          <strong>{item.result.verification.status === "verified" ? "Verified remittance" : "Remittance review"}</strong><p>{item.result.verification.detail}</p>
          <dl>{item.result.remittance.lines.map((line) => <div key={`${line.workDate}-${line.siteName}`}><dt>{line.workDate} · {line.siteName}</dt><dd>{line.paidMinutes} min · {money(line.payCents)}</dd></div>)}<div><dt>Total</dt><dd>{item.result.remittance.paidMinutes} min · {money(item.result.remittance.payCents)}</dd></div></dl>
          <a className="button" href={`/api/contractors/${encodeURIComponent(item.result.remittance.contractorId)}/remittance?week=${item.result.remittance.weekStart}`}>Download PDF</a>
        </div> : null}
      </div>)}
      {busy ? <p className="assistant-thinking" role="status">Checking CleanTrack…</p> : null}
    </div>
    <form className="assistant-composer" onSubmit={(event) => void submit(event)}><label className="sr-only" htmlFor="assistant-message">Message</label><input id="assistant-message" maxLength={500} placeholder="e.g. Show Ana’s remittance for last week" value={draft} onChange={(event) => setDraft(event.target.value)} /><button className="button" disabled={busy || !draft.trim()} type="submit">Send</button></form>
  </section>;
}
