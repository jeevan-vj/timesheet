"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

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

const defaults: PayRules = {
  holidayMode: "off",
  holidayMultiplierBps: null,
  useNzPublicHolidays: false,
  weekendSaturdayMultiplierBps: null,
  weekendSundayMultiplierBps: null,
  overnightStartMinutes: null,
  overnightEndMinutes: null,
  overnightMultiplierBps: null,
};

function timeValue(minutes: number | null): string {
  if (minutes == null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeMinutes(value: string): number | null {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function optionalInteger(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  return text ? Number(text) : null;
}

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  if (response.status === 401) window.location.assign("/sign-in");
  if (!response.ok) throw new Error("request_failed");
  return response.json();
}

export function PayRulesSettings() {
  const [rules, setRules] = useState<PayRules>(defaults);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [nextRules, nextHolidays] = await Promise.all([
        api("/api/business/pay-rules"),
        api("/api/business/holidays"),
      ]) as [PayRules, { holidays: Holiday[] }];
      setRules(nextRules);
      setHolidays(nextHolidays.holidays);
    } catch {
      setMessage("Could not load pay rules.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveRules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const overnightEnabled = form.get("overnightEnabled") === "on";
    const next: PayRules = {
      holidayMode: form.get("holidayMode") === "multiplier" ? "multiplier" : "off",
      holidayMultiplierBps: form.get("holidayMode") === "multiplier" ? optionalInteger(form.get("holidayMultiplierBps")) : null,
      useNzPublicHolidays: form.get("useNzPublicHolidays") === "on",
      weekendSaturdayMultiplierBps: optionalInteger(form.get("weekendSaturdayMultiplierBps")),
      weekendSundayMultiplierBps: optionalInteger(form.get("weekendSundayMultiplierBps")),
      overnightStartMinutes: overnightEnabled ? timeMinutes(String(form.get("overnightStart") ?? "")) : null,
      overnightEndMinutes: overnightEnabled ? timeMinutes(String(form.get("overnightEnd") ?? "")) : null,
      overnightMultiplierBps: overnightEnabled ? optionalInteger(form.get("overnightMultiplierBps")) : null,
    };
    setBusy(true);
    setMessage("");
    try {
      setRules(await api("/api/business/pay-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) }) as PayRules);
      setMessage("Pay rules saved. Existing shifts were not changed.");
    } catch {
      setMessage("Check multipliers are whole basis points from 10000 to 30000 and complete the overnight window.");
    } finally {
      setBusy(false);
    }
  }

  async function addHoliday(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      await api("/api/business/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ holidayDate: values.get("holidayDate"), name: values.get("name") }) });
      form.reset();
      await load();
      setMessage("Holiday added.");
    } catch {
      setMessage("That holiday could not be added. Check the date is not already listed.");
    } finally {
      setBusy(false);
    }
  }

  async function removeHoliday(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/business/holidays/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
      setMessage("Holiday removed.");
    } catch {
      setMessage("That holiday could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const overnightEnabled = rules.overnightStartMinutes != null;
  return <section className="setup" id="pay-rules"><div><p className="eyebrow">Optional pay settings</p><h2>Pay rules</h2><p className="muted">Rules apply when a shift is saved. Existing shift snapshots stay unchanged.</p></div><div className="setup-grid">
    <article className="setup-card"><div className="setup-title"><h3>Loadings</h3></div><form className="mini-form" key={JSON.stringify(rules)} onSubmit={saveRules}>
      <label>Public holidays<select name="holidayMode" defaultValue={rules.holidayMode}><option value="off">Off</option><option value="multiplier">Multiplier</option></select></label>
      <label>Holiday multiplier (basis points)<input name="holidayMultiplierBps" type="number" min="10000" max="30000" step="1" defaultValue={rules.holidayMultiplierBps ?? ""} placeholder="15000 = 1.5x" /></label>
      <label><input name="useNzPublicHolidays" type="checkbox" defaultChecked={rules.useNzPublicHolidays} /> Use NZ public holiday calendar</label>
      <label>Saturday multiplier (optional)<input name="weekendSaturdayMultiplierBps" type="number" min="10000" max="30000" step="1" defaultValue={rules.weekendSaturdayMultiplierBps ?? ""} /></label>
      <label>Sunday multiplier (optional)<input name="weekendSundayMultiplierBps" type="number" min="10000" max="30000" step="1" defaultValue={rules.weekendSundayMultiplierBps ?? ""} /></label>
      <label><input name="overnightEnabled" type="checkbox" defaultChecked={overnightEnabled} /> Enable overnight loading</label>
      <label>Overnight starts<input name="overnightStart" type="time" defaultValue={timeValue(rules.overnightStartMinutes)} /></label>
      <label>Overnight ends<input name="overnightEnd" type="time" defaultValue={timeValue(rules.overnightEndMinutes)} /></label>
      <label>Overnight multiplier (basis points)<input name="overnightMultiplierBps" type="number" min="10000" max="30000" step="1" defaultValue={rules.overnightMultiplierBps ?? ""} /></label>
      <button className="button small" disabled={busy}>Save pay rules</button>
    </form></article>
    <article className="setup-card"><div className="setup-title"><h3>Owner holidays</h3><span>{holidays.length}</span></div><div className="compact-list">
      {holidays.map((holiday) => <div className="compact-row" key={holiday.id}><span><strong>{holiday.name}</strong><small>{holiday.holidayDate}</small></span><button className="button tiny secondary" type="button" disabled={busy} onClick={() => void removeHoliday(holiday.id)}>Delete</button></div>)}
      <form className="mini-form" onSubmit={addHoliday}><label>Date<input name="holidayDate" type="date" required /></label><label>Name<input name="name" maxLength={100} required /></label><button className="button small" disabled={busy}>Add holiday</button></form>
    </div></article>
  </div>{message ? <p role="status" className="notice">{message}</p> : null}</section>;
}
