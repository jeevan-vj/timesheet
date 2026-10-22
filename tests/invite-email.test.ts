import { describe, expect, it, vi } from "vitest";
import { contractorInviteEmail, createEmailSender } from "../src/lib/invite-email";

const message = contractorInviteEmail({ to: "sam@example.test", businessName: "A & <B>", acceptUrl: "https://app.example.test/invite/token?a=1&b=2", expiresAt: new Date("2026-10-29T00:00:00Z") });

describe("invite email", () => {
  it("renders plain text and escaped HTML", () => {
    expect(message.text).toContain("A & <B>");
    expect(message.text).toContain("/invite/token");
    expect(message.html).toContain("A &amp; &lt;B&gt;");
    expect(message.html).toContain("a=1&amp;b=2");
    expect(message.html).not.toContain("<B>");
  });

  it("sends Resend requests without exposing secrets on failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private token", { status: 401 }));
    const sender = createEmailSender({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "secret-value", EMAIL_FROM: "CleanTrack <noreply@example.test>", APP_BASE_URL: "https://app.example.test" }, fetcher);
    await expect(sender.send(message)).rejects.toThrow("email_delivery_failed");
    expect(fetcher).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer secret-value" }) }));
    const [, request] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toMatchObject({ from: "CleanTrack <noreply@example.test>", to: ["sam@example.test"], subject: message.subject, text: message.text, html: message.html });
    await expect(sender.send(message)).rejects.not.toThrow(/secret-value|private token|sam@example/);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("uses Mailpit JSON only on loopback and disables unknown providers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const sender = createEmailSender({ EMAIL_PROVIDER: "mailpit", MAILPIT_URL: "http://127.0.0.1:8025", APP_BASE_URL: "http://localhost:3000", EMAIL_FROM: "noreply@example.test" }, fetcher);
    await sender.send(message);
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:8025/api/v1/send", expect.objectContaining({ method: "POST" }));
    const [, request] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(request?.body))).toMatchObject({ From: { Email: "noreply@example.test" }, To: [{ Email: "sam@example.test" }], Subject: message.subject, Text: message.text, HTML: message.html });
    expect(() => createEmailSender({ EMAIL_PROVIDER: "mailpit", MAILPIT_URL: "https://mail.example.com", APP_BASE_URL: "https://app.example.com", EMAIL_FROM: "noreply@example.test" })).toThrow("email_not_configured");
    expect(() => createEmailSender({ EMAIL_PROVIDER: "unknown" })).toThrow("email_not_configured");
  });

  it("rejects missing or malformed application URLs during configuration preflight", () => {
    for (const appBaseUrl of [undefined, "not a URL", "javascript:alert(1)"]) {
      expect(() => createEmailSender({
        EMAIL_PROVIDER: "resend",
        RESEND_API_KEY: "synthetic-key",
        EMAIL_FROM: "noreply@example.test",
        APP_BASE_URL: appBaseUrl,
      })).toThrow("email_not_configured");
    }
    expect(() => createEmailSender({
      EMAIL_PROVIDER: "mailpit",
      MAILPIT_URL: "not a URL",
      APP_BASE_URL: "http://localhost:3000",
      EMAIL_FROM: "noreply@example.test",
    })).toThrow("email_not_configured");
  });
});
