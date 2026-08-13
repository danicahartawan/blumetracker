export type Integration = {
  id: string; name: string; role: string; method: string; status: "ready" | "needs_auth" | "needs_details"; detail: string;
};

export const integrations: Integration[] = [
  { id:"gmail", name:"Gmail", role:"PO / order intake", method:"Gmail API + Pub/Sub watch", status:"ready", detail:"Codex Gmail connector is authenticated. Production requires Google OAuth and a renewable users.watch subscription." },
  { id:"netsuite", name:"NetSuite", role:"Order system of record", method:"SuiteTalk REST + OAuth 2.0", status:"needs_auth", detail:"Needs Blume NetSuite account ID, integration record, OAuth client, and sandbox role permissions." },
  { id:"typeform", name:"Typeform", role:"Warehouse request intake", method:"Webhook + Responses API", status:"needs_auth", detail:"Needs Typeform OAuth, form ID, and a signed webhook pointed at this app." },
  { id:"wrike", name:"Wrike", role:"Request/task tracking", method:"Wrike API v4 + webhooks", status:"needs_auth", detail:"Needs Wrike OAuth/token and the folder, space, or account scope containing warehouse requests." },
  { id:"s1c", name:"S1C / Stored", role:"Hold, release, fulfillment", method:"Signed webhook or scheduled API sync", status:"needs_details", detail:"Warehouse API documentation and credentials must come from Stored. Do not assume this is the unrelated S1Seven API." },
  { id:"sheets", name:"Google Sheets", role:"Human-facing audit view", method:"Sheets API values append/batchUpdate", status:"needs_auth", detail:"Needs a target spreadsheet ID and Google OAuth/service account access." },
];
