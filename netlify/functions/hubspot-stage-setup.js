// Setup endpoint — adds a stage to the HubSpot "Sales Pipeline".
//
// Dry run (default, shows what WOULD change, makes no changes):
//   GET /api/hubspot-stage-setup?secret=YOUR_SETUP_SECRET&label=Brochure%20Download
// Apply (creates the stage):
//   GET /api/hubspot-stage-setup?secret=YOUR_SETUP_SECRET&label=Brochure%20Download&apply=true
//
// Optional params:
//   order=N     displayOrder for the new stage (default: 0, i.e. first)
//   closed=true mark as a closed stage (default: open)
//
// The token stays in Netlify; this endpoint never returns it.

const HUBSPOT_API_BASE = "https://api.hubapi.com";

async function hs(path, key, options = {}) {
  const res = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  return { ok: res.ok, status: res.status, json, text };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};

  const setupSecret = process.env.SETUP_SECRET;
  if (setupSecret && q.secret !== setupSecret) {
    return { statusCode: 403, body: "Forbidden — pass ?secret=YOUR_SETUP_SECRET" };
  }

  const hubspotKey = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!hubspotKey) {
    return { statusCode: 500, body: "HUBSPOT_ACCESS_TOKEN not configured" };
  }

  const label = (q.label || "Brochure Download").trim();
  const apply = q.apply === "true";
  const isClosed = q.closed === "true";
  const displayOrder = Number.isFinite(Number(q.order)) ? Number(q.order) : 0;

  const json = (statusCode, body) => ({
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body, null, 2),
  });

  // 1. Find the Sales Pipeline
  const pipesRes = await hs("/crm/v3/pipelines/deals", hubspotKey);
  if (!pipesRes.ok) return json(502, { error: "Could not read pipelines", status: pipesRes.status, detail: pipesRes.json || pipesRes.text });

  const pipeline = (pipesRes.json.results || []).find(p => String(p.label).toLowerCase() === "sales pipeline")
    || (pipesRes.json.results || [])[0];
  if (!pipeline) return json(404, { error: "No deal pipeline found" });

  const currentStages = (pipeline.stages || [])
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map(s => ({ id: s.id, label: s.label, displayOrder: s.displayOrder }));

  // 2. Idempotency — don't create a duplicate
  const existing = currentStages.find(s => s.label.toLowerCase() === label.toLowerCase());
  if (existing) {
    return json(200, {
      status: "already_exists",
      pipeline: pipeline.label,
      stage: existing,
      currentStages,
    });
  }

  const plannedStage = {
    label,
    displayOrder,
    metadata: { isClosed: String(isClosed), probability: isClosed ? "1.0" : "0.1" },
  };

  // 3. Dry run unless ?apply=true
  if (!apply) {
    return json(200, {
      status: "dry_run",
      message: "No changes made. Add &apply=true to create this stage.",
      pipeline: pipeline.label,
      wouldCreate: plannedStage,
      currentStages,
    });
  }

  // 4. Create the stage
  const createRes = await hs(`/crm/v3/pipelines/deals/${pipeline.id}/stages`, hubspotKey, {
    method: "POST",
    body: JSON.stringify(plannedStage),
  });

  if (!createRes.ok) {
    return json(createRes.status === 403 ? 403 : 502, {
      status: "error",
      error: "Stage creation failed",
      hubspotStatus: createRes.status,
      detail: createRes.json || createRes.text,
      hint: createRes.status === 403
        ? "The HubSpot private app token is missing pipeline-write scope. In HubSpot: Settings → Integrations → Private Apps → your app → Scopes → enable 'crm.schemas.deals.write' (or CRM > Deals write / pipeline management), then retry."
        : undefined,
    });
  }

  // 5. Read back the pipeline to confirm
  const confirmRes = await hs("/crm/v3/pipelines/deals", hubspotKey);
  const confirmedPipeline = confirmRes.ok
    ? (confirmRes.json.results || []).find(p => p.id === pipeline.id)
    : null;
  const confirmedStages = confirmedPipeline
    ? (confirmedPipeline.stages || []).sort((a, b) => a.displayOrder - b.displayOrder).map(s => ({ id: s.id, label: s.label, displayOrder: s.displayOrder }))
    : null;

  return json(200, {
    status: "created",
    pipeline: pipeline.label,
    created: createRes.json,
    stagesNow: confirmedStages,
  });
};
