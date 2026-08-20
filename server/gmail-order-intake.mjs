import { parsePdfOrder, parseXlsxOrders, normalizeImportedOrder } from "./order-import.mjs";

const api = "https://gmail.googleapis.com/gmail/v1/users/me";
const decode = (data = "") => Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
const header = (message, name) => message.payload?.headers?.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || "";

async function gmail(fetchImpl, env, path) {
  const response = await fetchImpl(`${api}${path}`, { headers: { authorization: `Bearer ${env.GMAIL_ACCESS_TOKEN}`, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `Gmail request failed (${response.status}).`);
  return body;
}

function parts(payload, output = []) {
  if (!payload) return output;
  output.push(payload);
  for (const child of payload.parts || []) parts(child, output);
  return output;
}

export function classifyOrderEmail({ subject = "", body = "" }) {
  const content = `${subject}\n${body}`.toLowerCase();
  if (/sample|d2c|press kit|influencer|production lot|urgent sample/.test(content)) return { orderType: "sample_d2c", confidence: "high" };
  if (/wholesale|shopify b2b|invoice|payment received|commercial terms/.test(content)) return { orderType: "b2b_wholesale", confidence: "high" };
  if (/purchase order|\bpo\b|floor display|cases? of 6|bill of lading|\bbol\b|pickup/.test(content)) return { orderType: "direct_netsuite", confidence: "high" };
  return { orderType: "direct_netsuite", confidence: "low" };
}

function plainBody(message) {
  const candidates = parts(message.payload).filter((part) => part.mimeType === "text/plain" && part.body?.data);
  return candidates.map((part) => decode(part.body.data).toString("utf8")).join("\n").slice(0, 12000);
}

function orderFromEmail(message, classification) {
  const subject = header(message, "subject");
  const from = header(message, "from");
  const body = plainBody(message);
  const po = `${subject}\n${body}`.match(/(?:PO|purchase order)(?:\s*(?:#|number|no\.?))?\s*[:#-]?\s*([A-Z0-9-]{3,})/i)?.[1] || null;
  const customer = from.replace(/<.*$/, "").replace(/^"|"$/g, "").trim() || from.match(/<([^@>]+)/)?.[1] || "";
  const order = normalizeImportedOrder({ "PO #": po, Customer: customer, Memo: subject }, 0, "gmail", classification.orderType);
  order.gmailMessageId = message.id;
  order.gmailThreadId = message.threadId;
  order.intakeConfidence = classification.confidence;
  if (classification.confidence === "low") {
    order.workflowStatus = "Needs review";
    order.nextAction = "Confirm order type and required workflow";
  }
  return order;
}

function interventionFor(order, body, attachmentCount) {
  const missing = [];
  if (!order.poNumber) missing.push("PO number");
  if (!order.customer) missing.push("customer");
  if (!order.shipDate) missing.push("ship date");
  if (classificationNeedsConfirmation(order, body)) return "Reply to email · confirm order type/details";
  if (missing.length) return `Reply to email · confirm ${missing.join(", ")}`;
  if (!attachmentCount) return "Review email details before creating order";
  return order.orderType === "direct_netsuite" ? "Review customer rules and approve warehouse handoff" : order.orderType === "b2b_wholesale" ? "Confirm discount and payment before release" : "Verify sample SKU mapping before release";
}

function classificationNeedsConfirmation(order, body) {
  return order.intakeConfidence === "low" || /\b(?:please confirm|can you confirm|not sure|tbd|to be confirmed)\b/i.test(body);
}

function wrikeEvidence(body) {
  const url = body.match(/https?:\/\/(?:www\.)?wrike\.com\/[^\s)>]+/i)?.[0];
  if (url) return `Wrike request found: ${url}`;
  if (/\bwrike\b.{0,40}\b(?:request|task|submitted|ticket)\b/i.test(body)) return "Wrike request referenced in email";
  return "No Wrike request found in email";
}

async function attachmentBuffer(fetchImpl, env, messageId, part) {
  if (part.body?.data) return decode(part.body.data);
  const attachment = await gmail(fetchImpl, env, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(part.body.attachmentId)}`);
  return decode(attachment.data);
}

export async function scanGmailOrders({ env = process.env, fetchImpl = fetch, limit = 25 } = {}) {
  if (!env.GMAIL_ACCESS_TOKEN) throw new Error("Connect Nevan's Gmail account before scanning the inbox.");
  const query = env.GMAIL_ORDER_QUERY || (env.GMAIL_LABEL_ID ? `label:${env.GMAIL_LABEL_ID}` : "in:inbox has:attachment newer_than:14d");
  const listing = await gmail(fetchImpl, env, `/messages?q=${encodeURIComponent(query)}&maxResults=${Math.min(Math.max(limit, 1), 100)}`);
  const orders = [];
  for (const item of listing.messages || []) {
    const message = await gmail(fetchImpl, env, `/messages/${encodeURIComponent(item.id)}?format=full`);
    const body = plainBody(message);
    const classification = classifyOrderEmail({ subject: header(message, "subject"), body });
    const attachments = parts(message.payload).filter((part) => part.filename && /\.(xlsx?|pdf)$/i.test(part.filename));
    let extracted = [];
    for (const part of attachments) {
      const buffer = await attachmentBuffer(fetchImpl, env, message.id, part);
      if (/\.pdf$/i.test(part.filename)) extracted.push(...await parsePdfOrder(buffer, { env, fetchImpl, orderType: classification.orderType }));
      else extracted.push(...parseXlsxOrders(buffer, { orderType: classification.orderType }));
    }
    if (!extracted.length) extracted = [orderFromEmail(message, classification)];
    for (const order of extracted) {
      const enriched = { ...order, intakeConfidence: classification.confidence };
      const evidence = wrikeEvidence(body);
      orders.push({ ...enriched, gmailMessageId: message.id, gmailThreadId: message.threadId, source: "gmail", sourceSubject: header(message, "subject"), humanIntervention: interventionFor(enriched, body, attachments.length), notes: [order.memo, evidence].filter(Boolean).join(" · "), wrikeSubmitted: /Wrike request (?:found|referenced)/.test(evidence) ? "Referenced in email" : order.wrikeSubmitted });
    }
  }
  return { orders, query, scanned: listing.messages?.length || 0 };
}
