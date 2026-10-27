import { mailboxAddress } from "@/lib/mail-transport";
import { singleLine } from "@/lib/email-templates/text";

export type SmtpByteStream = {
  read: () => Promise<Uint8Array | null>;
  write: (chunk: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
};

export type SmtpMail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type SmtpReader = {
  stream: SmtpByteStream;
  pending: string;
  deadline: number;
};

const encoder = new TextEncoder();

export async function deliverSmtp(message: SmtpMail, open: () => Promise<SmtpByteStream>, deadline = Date.now() + 5_000): Promise<void> {
  const from = mailboxAddress(message.from);
  const to = mailboxAddress(message.to);
  if (!from || !to) throw new Error("smtp_failed");
  const stream = await open();
  const reader: SmtpReader = { stream, pending: "", deadline };
  try {
    await expectCode(reader, 220);
    await command(reader, "EHLO cleantrack", 250);
    await command(reader, `MAIL FROM:<${from}>`, 250);
    await command(reader, `RCPT TO:<${to}>`, 250);
    await command(reader, "DATA", 354);
    await stream.write(encoder.encode(smtpPayload(message, to)));
    await expectCode(reader, 250);
    await command(reader, "QUIT", 221);
  } finally {
    await stream.close().catch(() => undefined);
  }
}

export async function openCloudflareSmtp(host: string, port: number): Promise<SmtpByteStream> {
  const specifier = ["cloudflare:", "sockets"].join("");
  const sockets = await import(specifier) as {
    connect: (address: { hostname: string; port: number }) => {
      readable: ReadableStream<Uint8Array>;
      writable: WritableStream<Uint8Array>;
    };
  };
  const socket = sockets.connect({ hostname: host, port });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  return {
    read: async () => {
      const next = await reader.read();
      return next.done ? null : next.value;
    },
    write: async (chunk) => {
      await writer.write(chunk);
    },
    close: async () => {
      await writer.close().catch(() => undefined);
      await reader.cancel().catch(() => undefined);
    },
  };
}

async function command(reader: SmtpReader, line: string, expected: number): Promise<void> {
  await writeLine(reader.stream, line);
  await expectCode(reader, expected);
}

async function expectCode(reader: SmtpReader, expected: number): Promise<void> {
  if (await replyCode(reader) !== expected) throw new Error("smtp_failed");
}

async function replyCode(reader: SmtpReader): Promise<number> {
  for (;;) {
    const line = nextLine(reader);
    if (line === null) {
      await pull(reader);
      continue;
    }
    if (/^\d{3} /.test(line)) return Number(line.slice(0, 3));
    if (/^\d{3}-/.test(line) || line === "") continue;
    throw new Error("smtp_failed");
  }
}

function nextLine(reader: SmtpReader): string | null {
  const index = reader.pending.indexOf("\n");
  if (index < 0) return null;
  const line = reader.pending.slice(0, index).replace(/\r$/, "");
  reader.pending = reader.pending.slice(index + 1);
  return line;
}

async function pull(reader: SmtpReader): Promise<void> {
  if (Date.now() > reader.deadline) throw new Error("smtp_failed");
  const chunk = await reader.stream.read();
  if (!chunk) throw new Error("smtp_failed");
  reader.pending += new TextDecoder().decode(chunk);
  if (reader.pending.length > 65_536) throw new Error("smtp_failed");
}

async function writeLine(stream: SmtpByteStream, line: string): Promise<void> {
  await stream.write(encoder.encode(`${line}\r\n`));
}

function smtpPayload(message: SmtpMail, to: string): string {
  const boundary = `ct-${crypto.randomUUID()}`;
  const lines = [
    `From: ${headerValue(message.from)}`,
    `To: ${to}`,
    `Subject: ${headerValue(message.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    dotStuff(message.html),
    `--${boundary}--`,
    "",
    ".",
    "",
  ];
  return lines.join("\r\n");
}

function headerValue(value: string): string {
  const clean = singleLine(value);
  if (/^[\u0020-\u007E]*$/.test(clean)) return clean;
  const bytes = new TextEncoder().encode(clean);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

function dotStuff(value: string): string {
  return value.replaceAll("\r\n", "\n").split("\n").map((line) => (line.startsWith(".") ? `.${line}` : line)).join("\r\n");
}
