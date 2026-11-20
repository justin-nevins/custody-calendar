/// <reference path="../pb_data/types.d.ts" />
// Outgoing mail goes through ForwardEmail's HTTPS API instead of SMTP: the droplet's host blocks outbound SMTP
// ports (25, 465, 587), while port 443 is open. Every PocketBase mail (sign-in codes, the routes' notifications,
// the dashboard's test mail) passes through this hook. With no FORWARDEMAIL_API_KEY in the environment the hook
// steps aside and PocketBase's SMTP settings are used, which is what the local tests do.
onMailerSend((e) => {
  const key = $os.getenv("FORWARDEMAIL_API_KEY");
  if (!key) return e.next();
  const m = e.message;
  const addr = (a) => (a && a.name ? `"${String(a.name).replace(/"/g, "")}" <${a.address}>` : a ? a.address : "");
  const list = (arr) => (arr || []).map(addr).filter(Boolean).join(", ");
  const b64 = (s) => {
    const T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let out = "", i = 0;
    const bytes = []; for (const ch of unescape(encodeURIComponent(s))) bytes.push(ch.charCodeAt(0));
    while (i < bytes.length) { const a = bytes[i++], b = i < bytes.length ? bytes[i++] : NaN, c = i < bytes.length ? bytes[i++] : NaN; const n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += T[(n >> 18) & 63] + T[(n >> 12) & 63] + (isNaN(b) ? "=" : T[(n >> 6) & 63]) + (isNaN(c) ? "=" : T[n & 63]); }
    return out;
  };
  const body = { from: addr(m.from), to: list(m.to), subject: m.subject || "" };
  if (m.html) body.html = m.html;
  if (m.text) body.text = m.text;
  if (m.cc && m.cc.length) body.cc = list(m.cc);
  if (m.bcc && m.bcc.length) body.bcc = list(m.bcc);
  const res = $http.send({
    url: "https://api.forwardemail.net/v1/emails",
    method: "POST",
    headers: { "Authorization": "Basic " + b64(key + ":"), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeout: 30,
  });
  if (res.statusCode >= 300) throw new Error(`Mail could not be sent (ForwardEmail answered ${res.statusCode}): ${String(res.raw || "").slice(0, 200)}`);
  // handled: do not call e.next(), so PocketBase does not also try SMTP
});
