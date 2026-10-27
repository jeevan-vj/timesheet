import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { RELEASE_SHA: "test", BETTER_AUTH_URL: "https://app.example.test", EMAIL_FROM: "CleanTrack <invites@jnok.co.nz>" },
}));

import { decideTransport } from "../src/lib/mail-transport";
import { EMAIL_TIMEOUT_MS, RESEND_EMAILS_URL, sendEmail, type SendEmailInput } from "../src/lib/mailer";
import { OPERATIONAL_EVENT_KEYS, operationalEventPayload, reportOperationalEvent } from "../src/lib/report-server-error";
import type { SmtpByteStream } from "../src/lib/smtp-dev";

const message: SendEmailInput = {
  to: "cleaner@example.test",
  subject: "Northwind invited you to CleanTrack",
  html: "<p>Hi Aroha,</p><p><a href=\"https://app.example.test/invite#token-secret\">Accept invitation</a></p>",
  text: "Accept invitation: https://app.example.test/invite#token-secret",
  idempotencyKey: "invite/inv-1/1",
  replyTo: "office@example.test",
  kind: "invitation",
};

const configured = { apiKey: "resend-test-key", from: "CleanTrack <invites@jnok.co.nz>" };

function loggedText(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map((call: readonly unknown[]) => String(call[0])).join("\n");
}

describe("sendEmail", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not call fetch when the key or sender is missing and logs only the allow-listed event", async () => {
    const fetchImpl = vi.fn();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail(message, { apiKey: "", from: configured.from }, fetchImpl)).resolves.toEqual({ status: "not_configured" });
    await expect(sendEmail(message, { apiKey: "key", from: "  " }, fetchImpl)).resolves.toEqual({ status: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const logged = loggedText(spy);
    expect(JSON.parse(spy.mock.calls[0]?.[0] as string)).toEqual({ event: "email_not_configured", kind: "invitation" });
    expect(logged).not.toContain("token-secret");
    expect(logged).not.toContain("cleaner@example.test");
    expect(logged).not.toContain("resend-test-key");
    spy.mockRestore();
  });

  it("posts one Resend request with the sender, recipient, reply-to, and idempotency key", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "email_123" }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail(message, configured, fetchImpl)).resolves.toEqual({ status: "sent", id: "email_123" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RESEND_EMAILS_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer resend-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Idempotency-Key"]).toBe("invite/inv-1/1");
    expect(JSON.parse(String(init.body))).toEqual({
      from: "CleanTrack <invites@jnok.co.nz>",
      to: ["cleaner@example.test"],
      reply_to: "office@example.test",
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("keeps the invite when Resend fails and does not log the response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret-body token-secret cleaner@example.test", { status: 422 }));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail(message, configured, fetchImpl)).resolves.toEqual({ status: "failed", httpStatus: 422 });
    const logged = loggedText(spy);
    expect(logged).toContain("\"httpStatus\":422");
    expect(logged).not.toContain("secret-body");
    expect(logged).not.toContain("token-secret");
    expect(logged).not.toContain("cleaner@example.test");
    expect(logged).not.toContain("resend-test-key");
    spy.mockRestore();
  });

  it("delivers smtp-dev to a loopback inbox and refuses it in production", async () => {
    const writes: string[] = [];
    const replies = ["220 mailpit\r\n", "250-mailpit\r\n250 ok\r\n", "250 ok\r\n", "250 ok\r\n", "354 go\r\n", "250 queued\r\n", "221 bye\r\n"];
    const openSmtp = vi.fn(async (): Promise<SmtpByteStream> => ({
      read: async () => {
        const next = replies.shift();
        return next ? new TextEncoder().encode(next) : null;
      },
      write: async (chunk) => { writes.push(new TextDecoder().decode(chunk)); },
      close: async () => undefined,
    }));
    const fetchImpl = vi.fn();
    const dev = { ...configured, transport: "smtp-dev", smtpHost: "127.0.0.1", smtpPort: 1025, production: false };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendEmail(message, dev, fetchImpl, openSmtp)).resolves.toEqual({ status: "sent", id: "smtp-dev" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(writes.join("")).toContain("MAIL FROM:<invites@jnok.co.nz>");
    expect(writes.join("")).toContain("RCPT TO:<cleaner@example.test>");
    expect(writes.join("")).toContain("invite#token-secret");
    expect(loggedText(spy)).toBe("");

    const refused = { ...dev, production: true };
    await expect(sendEmail(message, refused, fetchImpl, openSmtp)).resolves.toEqual({ status: "failed", httpStatus: 0 });
    await expect(sendEmail(message, { ...dev, smtpHost: "smtp.example.test" }, fetchImpl, openSmtp)).resolves.toEqual({ status: "failed", httpStatus: 0 });
    expect(openSmtp).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({ event: "email_dev_transport_refused", kind: "invitation" });
    const logged = loggedText(spy);
    expect(logged).not.toContain("token-secret");
    expect(logged).not.toContain("cleaner@example.test");
    expect(logged).not.toContain("resend-test-key");
    expect(decideTransport({ ...dev, production: false })).toBe("smtp-dev");
    expect(decideTransport({ ...dev, production: true })).toBe("refused");
    expect(decideTransport(configured)).toBe("resend");
    spy.mockRestore();
  });

  it("aborts the request after 5 seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      });
    }));
    const pending = sendEmail(message, configured, fetchImpl);
    await vi.advanceTimersByTimeAsync(EMAIL_TIMEOUT_MS - 1);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const stillPending = await Promise.race([pending.then(() => "done"), Promise.resolve("pending")]);
    expect(stillPending).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ status: "failed", httpStatus: 0 });
  });
});

describe("operational event allow-list", () => {
  it("copies only event, kind, and httpStatus", () => {
    const noisy = { kind: "invitation" as const, httpStatus: 503, email: "cleaner@example.test", token: "token-secret" };
    const payload = operationalEventPayload("email_send_failed", noisy);
    expect(payload).toEqual({ event: "email_send_failed", kind: "invitation", httpStatus: 503 });
    expect(Object.keys(payload).every((key) => (OPERATIONAL_EVENT_KEYS as readonly string[]).includes(key))).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("token-secret");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    reportOperationalEvent("email_not_configured", { kind: "invitation" });
    expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual({ event: "email_not_configured", kind: "invitation" });
    spy.mockRestore();
  });
});
