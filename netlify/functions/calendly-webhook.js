const { createHmac } = require("crypto");
const { slugFrom, mapCalendlySlug } = require("./_shared");

const HUBSPOT_API_BASE = "https://api.hubapi.com";

// Maps Calendly host names to HubSpot owner full names.
const CALENDLY_HOST_TO_HUBSPOT_NAME = {
  "Jared Hastings":     "Jared Hastings",
  "Jay Hedley":         "Jay Hedley",
  "Joseph Scott":       "Joseph Scott",
  "Madeleine Robinson": "Madeleine Robinson",
};

function verifySignature(rawBody, signatureHeader, secret) {
  if (!secret) return true;
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map(p => p.split("=")));
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", secret)
    .update(`${parts.t}.${rawBody}`)
    .digest("hex");
  return expected === parts.v1;
}

async function getHubSpotOwnerIdByName(apiKey, name) {
  const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/owners?limit=100`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const owner of data.results || []) {
    const fullName = [owner.firstName, owner.lastName].filter(Boolean).join(" ");
    if (fullName.toLowerCase() === name.toLowerCase()) return owner.id;
  }
  return null;
}

async function getSalesPipelineStage(apiKey) {
  const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/pipelines/deals`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const pipeline of data.results || []) {
    if (pipeline.label.toLowerCase().includes("sales pipeline") ||
        pipeline.label.toLowerCase() === "sales pipeline") {
      for (const stage of pipeline.stages || []) {
        if (stage.label.toLowerCase().includes("call booked")) {
          return { pipelineId: pipeline.id, stageId: stage.id, pipelineLabel: pipeline.label, stageLabel: stage.label };
        }
      }
    }
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const hubspotKey = process.env.HUBSPOT_ACCESS_TOKEN;
  const webhookSecret = process.env.CALENDLY_WEBHOOK_SECRET;

  if (!hubspotKey) {
    console.error("HUBSPOT_ACCESS_TOKEN not configured");
    return { statusCode: 500, body: "HubSpot API key not configured" };
  }

  const rawBody = event.body || "";
  if (!verifySignature(rawBody, event.headers["calendly-webhook-signature"], webhookSecret)) {
    return { statusCode: 401, body: "Invalid webhook signature" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  if (payload.event !== "invitee.created") {
    return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: "Not invitee.created" }) };
  }

  // Calendly payload structure (confirmed from live logs):
  // payload.payload contains the invitee directly, with scheduled_event embedded as an object
  const p = payload.payload || {};
  const scheduledEvent = p.scheduled_event || {};

  // Invitee name and tracking are at the top level of p
  const inviteeName = p.name || "Unknown";
  const utmSource = p.tracking?.utm_source || null;

  // Event name is on the scheduled_event object
  const eventName = scheduledEvent.name || "";
  const eventSlug = slugFrom(eventName);

  console.log(`Calendly booking — invitee: "${inviteeName}", event: "${eventName}", slug: "${eventSlug}"`);

  const mapped = mapCalendlySlug(eventSlug);
  if (!mapped) {
    console.log(`Untracked event slug "${eventSlug}" — skipping HubSpot deal creation`);
    return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: `Event not tracked: ${eventSlug}` }) };
  }

  // Start time → close date
  const closeDate = scheduledEvent.start_time
    ? new Date(scheduledEvent.start_time).toISOString().split("T")[0]
    : null;

  // Host from event_memberships
  const hostName = (scheduledEvent.event_memberships || [])[0]?.user_name || null;
  const hubspotOwnerName = hostName ? CALENDLY_HOST_TO_HUBSPOT_NAME[hostName] : null;
  const ownerId = hubspotOwnerName
    ? await getHubSpotOwnerIdByName(hubspotKey, hubspotOwnerName)
    : null;

  console.log(`Host: "${hostName}", HubSpot owner resolved: ${ownerId ? "yes" : "no"}`);

  // Resolve Sales Pipeline + "Call Booked" stage
  const pipelineStage = await getSalesPipelineStage(hubspotKey);
  if (!pipelineStage) {
    console.error('Could not find "Sales Pipeline" with "Call Booked" stage in HubSpot');
    return { statusCode: 502, body: 'HubSpot pipeline/stage not found. Check /api/hubspot-pipeline-debug.' };
  }

  const properties = {
    dealname: `${inviteeName} - ${eventName}`,
    pipeline: pipelineStage.pipelineId,
    dealstage: pipelineStage.stageId,
    ...(closeDate ? { closedate: closeDate } : {}),
    ...(ownerId ? { hubspot_owner_id: String(ownerId) } : {}),
    description: [
      `Calendly event: ${eventName}`,
      `Category: ${mapped.category}${mapped.subCategory ? ` › ${mapped.subCategory}` : ""}`,
      utmSource ? `UTM source: ${utmSource}` : null,
      hostName ? `Calendly host: ${hostName}` : null,
    ].filter(Boolean).join("\n"),
  };

  const createRes = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hubspotKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.error("HubSpot deal creation failed:", errText);
    return { statusCode: 502, body: `HubSpot error: ${errText}` };
  }

  const deal = await createRes.json();
  console.log(`HubSpot deal created — id: ${deal.id}, name: "${inviteeName}", stage: "${pipelineStage.stageLabel}"`);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      dealId: deal.id,
      dealName: inviteeName,
      category: mapped.category,
      pipeline: pipelineStage.pipelineLabel,
      stage: pipelineStage.stageLabel,
    }),
  };
};
