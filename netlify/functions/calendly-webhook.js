const { createHmac } = require("crypto");
const { slugFrom, mapCalendlySlug } = require("./_shared");

const HUBSPOT_API_BASE = "https://api.hubapi.com";

// Maps Calendly host names (as returned by assigned_to) to HubSpot owner full names.
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
  if (!res.ok) {
    console.error("HubSpot pipelines API error:", res.status, await res.text());
    return null;
  }
  const data = await res.json();

  console.log("HubSpot pipelines found:", JSON.stringify(
    (data.results || []).map(p => ({
      id: p.id,
      label: p.label,
      stages: (p.stages || []).map(s => ({ id: s.id, label: s.label })),
    }))
  ));

  for (const pipeline of data.results || []) {
    if (pipeline.label.toLowerCase().includes("sales")) {
      for (const stage of pipeline.stages || []) {
        if (stage.label.toLowerCase().includes("call booked") ||
            stage.label.toLowerCase().includes("call booked")) {
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
  const signatureHeader = event.headers["calendly-webhook-signature"];

  if (!verifySignature(rawBody, signatureHeader, webhookSecret)) {
    return { statusCode: 401, body: "Invalid webhook signature" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  console.log("Calendly webhook received — event type:", payload.event);

  if (payload.event !== "invitee.created") {
    return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: "Not invitee.created" }) };
  }

  const { event_type, event: scheduledEvent, invitee } = payload.payload || {};

  // Use the slug directly from Calendly if available, fall back to deriving from name
  const directSlug = event_type?.slug || null;
  const derivedSlug = slugFrom(event_type?.name || "");
  const eventSlug = directSlug || derivedSlug;

  console.log(`Calendly event slug: "${eventSlug}" (direct: "${directSlug}", derived: "${derivedSlug}")`);

  const mapped = mapCalendlySlug(eventSlug) || mapCalendlySlug(derivedSlug);
  if (!mapped) {
    console.log(`Untracked Calendly event — slug: "${eventSlug}", name: "${event_type?.name}" — skipping HubSpot deal creation`);
    return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: `Event not tracked: ${eventSlug}` }) };
  }

  const inviteeName = invitee?.name || "Unknown";
  const startTime = scheduledEvent?.start_time;
  const closeDate = startTime ? new Date(startTime).toISOString().split("T")[0] : null;
  const utmSource = invitee?.tracking?.utm_source || null;

  console.log(`Processing booking — name: "${inviteeName}", event: "${eventSlug}", date: ${closeDate}, utm: ${utmSource}`);

  // Map Calendly host → HubSpot owner ID
  const hostName = (scheduledEvent?.assigned_to || [])[0] || null;
  const hubspotOwnerName = hostName ? CALENDLY_HOST_TO_HUBSPOT_NAME[hostName] : null;
  const ownerId = hubspotOwnerName
    ? await getHubSpotOwnerIdByName(hubspotKey, hubspotOwnerName)
    : null;

  if (hostName && !ownerId) {
    console.warn(`Could not resolve HubSpot owner for Calendly host: "${hostName}"`);
  }

  // Resolve Sales Pipeline + "Call Booked" stage IDs
  const pipelineStage = await getSalesPipelineStage(hubspotKey);
  if (!pipelineStage) {
    console.error('Could not find Sales Pipeline with a "Call Booked" stage — check /api/hubspot-pipeline-debug for available pipelines and stages');
    return {
      statusCode: 502,
      body: 'Could not find "Call Booked" stage in HubSpot Sales Pipeline. Visit /api/hubspot-pipeline-debug to see available stages.',
    };
  }

  console.log(`Using pipeline: "${pipelineStage.pipelineLabel}", stage: "${pipelineStage.stageLabel}"`);

  const properties = {
    dealname: inviteeName,
    pipeline: pipelineStage.pipelineId,
    dealstage: pipelineStage.stageId,
    ...(closeDate ? { closedate: closeDate } : {}),
    ...(ownerId ? { hubspot_owner_id: String(ownerId) } : {}),
    description: [
      `Calendly event: ${event_type?.name || eventSlug}`,
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
  console.log(`HubSpot deal created — id: ${deal.id}, name: "${inviteeName}", pipeline: "${pipelineStage.pipelineLabel}", stage: "${pipelineStage.stageLabel}"`);

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
