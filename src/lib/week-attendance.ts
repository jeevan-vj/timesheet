import { useRef, useState } from "react";
import { summarizeWeek } from "@/lib/payroll";
import { summarizeWeekBySite } from "@/lib/week-rollup";
import {
  entriesAfterException,
  entryIdFromExceptionUrl,
  markWorkedRequests,
  projectEntries,
  resetScheduledRequests,
  scheduledMinutesForEntry,
  type WeekGridEntry,
} from "@/lib/week-grid";

type Send = (url: string, body?: unknown, method?: string) => Promise<void>;

export type AttendanceToast = {
  message: string;
  onUndo?: () => void;
};

type AssignmentMinutes = {
  contractorId: string;
  siteId: string;
  schedule: { paidMinutes: number } | null;
};

const EMPTY_ENTRIES: WeekGridEntry[] = [];

export function attendanceSuccessMessage(count: number) {
  return count === 1 ? "Marked as worked." : `Marked ${count} days as worked.`;
}

export function displayWeekTotals(entries: WeekGridEntry[]) {
  const contractors = summarizeWeek(entries.map((entry) => ({
    contractorId: entry.contractorId,
    contractorName: entry.contractorName,
    paidMinutes: entry.paidMinutes,
    rateCents: entry.rateCents,
  })));
  const sites = summarizeWeekBySite(entries);
  return {
    contractors,
    sites,
    totalMinutes: contractors.reduce((sum, row) => sum + row.paidMinutes, 0),
    totalPay: contractors.reduce((sum, row) => sum + row.payCents, 0),
  };
}

async function sendAll(
  requests: Array<{ url: string; body: unknown }>,
  send: Send,
  cancelled?: () => boolean,
) {
  for (const request of requests) {
    if (cancelled?.()) return;
    await send(request.url, request.body);
  }
}

type MarkWorkedInput = {
  ids: string[];
  previous: WeekGridEntry[];
  send: Send;
  reload: () => Promise<void>;
  publish: (entries: WeekGridEntry[]) => void;
  notify: (toast: AttendanceToast | null) => void;
  fail: (error: unknown) => void;
  stillCurrent: () => boolean;
};

function publishIfCurrent(input: MarkWorkedInput, entries: WeekGridEntry[]) {
  if (input.stillCurrent()) input.publish(entries);
}

async function recoverMarkedWorked(
  error: unknown,
  cancelled: boolean,
  input: MarkWorkedInput,
  sendUndo: () => Promise<void>,
) {
  if (!cancelled) {
    publishIfCurrent(input, input.previous);
    if (input.stillCurrent()) input.notify(null);
    input.fail(error);
    await input.reload();
    return;
  }
  try {
    await sendUndo();
  } catch (undoError) {
    input.fail(undoError);
  }
  await input.reload();
}

export async function commitMarkedWorked(input: MarkWorkedInput) {
  if (input.ids.length === 0) return;
  const signal = { cancelled: false };
  let settled = false;
  let undoTask: Promise<void> | null = null;
  const sendUndo = () => {
    if (undoTask) return undoTask;
    publishIfCurrent(input, input.previous);
    undoTask = sendAll(resetScheduledRequests(input.ids), input.send);
    return undoTask;
  };
  publishIfCurrent(input, projectEntries(input.previous, input.ids, { kind: "confirm_worked" }));
  input.notify({
    message: attendanceSuccessMessage(input.ids.length),
    onUndo: () => {
      signal.cancelled = true;
      publishIfCurrent(input, input.previous);
      if (input.stillCurrent()) input.notify({ message: "Reverted to scheduled." });
      if (!settled) return;
      void sendUndo().then(() => input.reload()).catch((error: unknown) => input.fail(error));
    },
  });
  try {
    await sendAll(markWorkedRequests(input.ids), input.send, () => signal.cancelled);
    settled = true;
    if (signal.cancelled) await sendUndo();
    await input.reload();
  } catch (error) {
    settled = true;
    await recoverMarkedWorked(error, signal.cancelled, input, sendUndo);
  }
}

export async function commitException(input: {
  previous: WeekGridEntry[];
  next: WeekGridEntry[];
  request: { url: string; body: unknown };
  send: Send;
  reload: () => Promise<void>;
  publish: (entries: WeekGridEntry[]) => void;
  stillCurrent: () => boolean;
}) {
  if (input.stillCurrent()) input.publish(input.next);
  try {
    await input.send(input.request.url, input.request.body);
    await input.reload();
  } catch (error) {
    if (input.stillCurrent()) input.publish(input.previous);
    throw error;
  }
}

export function useWeekAttendance(input: {
  serverEntries: WeekGridEntry[] | undefined;
  assignments: AssignmentMinutes[] | undefined;
  weekStart: string | undefined;
  reload: () => Promise<void>;
  announce: (message: string) => void;
  onError: (error: unknown) => void;
  send: Send;
}) {
  const serverEntries = input.serverEntries ?? EMPTY_ENTRIES;
  const [entries, setEntries] = useState(serverEntries);
  const [seenEntries, setSeenEntries] = useState(serverEntries);
  const [seenWeek, setSeenWeek] = useState(input.weekStart);
  const [toast, setToast] = useState<AttendanceToast | null>(null);
  const entriesRef = useRef(entries);
  const generation = useRef(0);
  const live = useRef(input);
  const assignmentsRef = useRef(input.assignments ?? []);
  if (serverEntries !== seenEntries) {
    setSeenEntries(serverEntries);
    setEntries(serverEntries);
  }
  if (input.weekStart !== seenWeek) {
    setSeenWeek(input.weekStart);
    setToast(null);
    generation.current += 1;
  }
  entriesRef.current = entries;
  assignmentsRef.current = input.assignments ?? [];
  live.current = input;

  function publish(next: WeekGridEntry[], ticket: number) {
    entriesRef.current = next;
    if (generation.current === ticket) setEntries(next);
  }

  async function applyException(url: string, body: unknown) {
    const ticket = generation.current;
    const previous = entriesRef.current;
    const entryId = entryIdFromExceptionUrl(url) ?? "";
    const scheduledMinutes = scheduledMinutesForEntry(previous, assignmentsRef.current, entryId);
    const next = entriesAfterException(previous, scheduledMinutes, url, body) ?? previous;
    const current = () => generation.current === ticket;
    try {
      await commitException({
        previous,
        next,
        request: { url, body },
        send: (url, body, method) => live.current.send(url, body, method),
        reload: () => live.current.reload(),
        publish: (rows) => publish(rows, ticket),
        stillCurrent: current,
      });
      if (current()) live.current.announce("Timesheet updated.");
    } catch (error) {
      live.current.onError(error);
      throw error;
    }
  }

  function markWorked(ids: string[]) {
    const ticket = generation.current;
    const current = () => generation.current === ticket;
    return commitMarkedWorked({
      ids,
      previous: entriesRef.current,
      send: (url, body, method) => live.current.send(url, body, method),
      reload: () => live.current.reload(),
      publish: (rows) => publish(rows, ticket),
      notify: (next) => { if (current()) setToast(next); },
      fail: (error) => live.current.onError(error),
      stillCurrent: current,
    });
  }

  return { entries, toast, dismissToast: () => setToast(null), applyException, markWorked };
}
