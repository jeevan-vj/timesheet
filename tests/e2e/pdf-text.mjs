import zlib from "node:zlib";

function unescapePdfString(value) {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value[index + 1];
    index += 1;
    if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "b") out += "\b";
    else if (next === "f") out += "\f";
    else if (next === "(" || next === ")" || next === "\\") out += next;
    else if (next >= "0" && next <= "7") {
      let octal = next;
      for (let extra = 0; extra < 2; extra += 1) {
        const digit = value[index + 1];
        if (digit < "0" || digit > "7") break;
        octal += digit;
        index += 1;
      }
      out += String.fromCharCode(Number.parseInt(octal, 8));
    } else if (next !== undefined) out += next;
  }
  return out;
}

function hexToLatin1(hex) {
  if (hex.length % 2 !== 0) return "";
  let out = "";
  for (let index = 0; index < hex.length; index += 2) {
    out += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return out;
}

function stringsFromContent(source) {
  const found = [];
  const literal = /\((?:\\.|[^\\)])*\)/g;
  for (const match of source.matchAll(literal)) found.push(unescapePdfString(match[0].slice(1, -1)));
  const hex = /<([0-9A-Fa-f]+)>\s*Tj/g;
  for (const match of source.matchAll(hex)) found.push(hexToLatin1(match[1]));
  return found.join("\n");
}

function streamBody(buffer, start, end) {
  let slice = buffer.subarray(start, end);
  if (slice.length && slice[slice.length - 1] === 0x0a) slice = slice.subarray(0, slice.length - 1);
  if (slice.length && slice[slice.length - 1] === 0x0d) slice = slice.subarray(0, slice.length - 1);
  try {
    return zlib.inflateSync(slice);
  } catch {
    return slice;
  }
}

export function pdfText(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const parts = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const marker = buffer.indexOf("stream", cursor);
    if (marker < 0) break;
    let start = marker + "stream".length;
    if (buffer[start] === 0x0d && buffer[start + 1] === 0x0a) start += 2;
    else if (buffer[start] === 0x0a) start += 1;
    const end = buffer.indexOf("endstream", start);
    if (end < 0) break;
    parts.push(stringsFromContent(streamBody(buffer, start, end).toString("latin1")));
    cursor = end + "endstream".length;
  }
  return parts.join("\n");
}
