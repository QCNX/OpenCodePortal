import * as http from 'http';

export function serializeHttpRequest(req: http.IncomingMessage, body: Buffer, path: string): Buffer {
  const method = req.method || 'GET';
  const lines: string[] = [`${method} ${path} HTTP/1.1`];

  // Copy headers (skip connection and transfer-encoding — hop-by-hop headers)
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase();
    if (lower === 'connection' || lower === 'transfer-encoding') continue;
    if (value) {
      const vals = Array.isArray(value) ? value : [value];
      for (const v of vals) {
        lines.push(`${key}: ${v}`);
      }
    }
  }

  lines.push(''); // empty line before body
  const headerBytes = Buffer.from(lines.join('\r\n') + '\r\n');
  return Buffer.concat([headerBytes, body]);
}

export interface ParsedResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

export function parseRawResponse(data: Buffer): ParsedResponse | null {
  const text = data.toString('utf8');
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd === -1) return null;

  const headerSection = text.substring(0, headerEnd);
  const body = data.subarray(headerEnd + 4);
  const lines = headerSection.split('\r\n');

  // Status line: "HTTP/1.1 200 OK"
  const statusParts = lines[0].split(' ');
  const statusCode = parseInt(statusParts[1] || '502', 10);
  const statusMessage = statusParts.slice(2).join(' ') || '';

  // Headers
  const headers: Record<string, string | string[]> = {};
  for (let i = 1; i < lines.length; i++) {
    const colon = lines[i].indexOf(':');
    if (colon > 0) {
      const key = lines[i].substring(0, colon).trim().toLowerCase();
      const value = lines[i].substring(colon + 1).trim();
      const existing = headers[key];
      if (existing === undefined) {
        headers[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        headers[key] = [existing, value];
      }
    }
  }

  return { statusCode, statusMessage, headers, body };
}
