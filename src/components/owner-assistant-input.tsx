"use client";

import {
  formatWeekRange,
  ownerAssistantFormSubmissionSchema,
  rateCentsFromNzdText,
  shiftWeek,
  weekEnd,
  type OwnerAssistantFormSubmission,
  type OwnerAssistantGuidedInput,
} from "@cleantrack/core";
import { FormEvent, useState } from "react";

function validationMessage(path: PropertyKey | undefined): string {
  if (path === "email") return "Enter a valid email address or leave it blank.";
  if (path === "defaultRateCents") return "Enter an hourly rate from NZ$15.00 to NZ$250.00.";
  if (path === "rateCents") return "Enter an hourly override from NZ$15.00 to NZ$250.00, or leave it blank to inherit the contractor rate.";
  if (path === "contractorName") return "Choose a contractor.";
  if (path === "siteName") return "Choose a site.";
  if (path === "address") return "Keep the address under 240 characters.";
  return "Complete the required details before continuing.";
}

function Options({ options }: { options: Array<{ label: string; value: string }> }) {
  return <>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</>;
}

export function OwnerAssistantInput({
  busy,
  input,
  onSubmit,
}: {
  busy: boolean;
  input: OwnerAssistantGuidedInput;
  onSubmit: (form: OwnerAssistantFormSubmission) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [rate, setRate] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [weekStart, setWeekStart] = useState(input.operation === "get_remittance" ? input.weekStart : "");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    let candidate: unknown;
    if (input.operation === "create_contractor") {
      const defaultRateCents = rateCentsFromNzdText(rate);
      candidate = { operation: input.operation, name, email, phone, defaultRateCents };
    } else if (input.operation === "create_site") {
      candidate = { operation: input.operation, name, address };
    } else if (input.operation === "assign_site") {
      const parsedRate = rate.trim() ? rateCentsFromNzdText(rate) : null;
      candidate = { operation: input.operation, contractorName, siteName, rateCents: parsedRate };
    } else {
      candidate = { operation: input.operation, contractorName, weekStart };
    }
    const parsed = ownerAssistantFormSubmissionSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(validationMessage(parsed.error.issues[0]?.path[0]));
      return;
    }
    setError("");
    await onSubmit(parsed.data);
  }

  return <form className="assistant-input" onSubmit={(event) => void submit(event)}>
    <strong>{input.operation === "create_contractor" ? "Contractor details" : input.operation === "create_site" ? "Site details" : input.operation === "assign_site" ? "Assignment details" : "Remittance details"}</strong>
    {input.operation === "create_contractor" ? <>
      <label>Name<input maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Email <small>optional</small><input autoComplete="email" maxLength={254} type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Phone <small>optional</small><input autoComplete="tel" maxLength={40} type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
      <label>Hourly rate (NZD)<input inputMode="decimal" max={250} min={15} placeholder="32.50" required step="0.01" type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
    </> : null}
    {input.operation === "create_site" ? <>
      <label>Site name<input maxLength={100} required value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Address <small>optional</small><input maxLength={240} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    </> : null}
    {input.operation === "assign_site" ? <>
      <label>Contractor<select required value={contractorName} onChange={(event) => setContractorName(event.target.value)}><option value="">Choose a contractor</option><Options options={input.contractors} /></select></label>
      <label>Site<select required value={siteName} onChange={(event) => setSiteName(event.target.value)}><option value="">Choose a site</option><Options options={input.sites} /></select></label>
      <label>Hourly override <small>optional</small><input inputMode="decimal" max={250} min={15} placeholder="Leave blank to inherit" step="0.01" type="number" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
    </> : null}
    {input.operation === "get_remittance" ? <>
      <label>Contractor<select required value={contractorName} onChange={(event) => setContractorName(event.target.value)}><option value="">Choose a contractor</option><Options options={input.contractors} /></select></label>
      <fieldset className="assistant-week"><legend>Week</legend><button className="link-button" type="button" onClick={() => setWeekStart(shiftWeek(weekStart, -1))}>Previous</button><strong>{formatWeekRange(weekStart, weekEnd(weekStart))}</strong><button className="link-button" type="button" onClick={() => setWeekStart(shiftWeek(weekStart, 1))}>Next</button></fieldset>
    </> : null}
    {error ? <p className="alert" role="alert">{error}</p> : null}
    <button className="button" disabled={busy} type="submit">{busy ? "Checking…" : input.operation === "get_remittance" ? "Check remittance" : "Review details"}</button>
  </form>;
}
