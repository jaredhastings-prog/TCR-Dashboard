// Debug endpoint — shows all HubSpot deal pipelines and their stages.
// Use this to confirm the exact stage names available in your HubSpot account.
// GET /api/hubspot-pipeline-debug?secret=YOUR_SETUP_SECRET

exports.handler = async (event) => {
  const setupSecret = process.env.SETUP_SECRET;
  if (setupSecret && event.queryStringParameters?.secret !== setupSecret) {
    return { statusCode: 403, body: "Forbidden — pass ?secret=YOUR_SETUP_SECRET" };
  }

  const hubspotKey = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!hubspotKey) {
    return { statusCode: 500, body: "HUBSPOT_ACCESS_TOKEN not configured" };
  }

  const res = await fetch("https://api.hubapi.com/crm/v3/pipelines/deals", {
    headers: { Authorization: `Bearer ${hubspotKey}` },
  });

  if (!res.ok) {
    return { statusCode: 502, body: `HubSpot error: ${await res.text()}` };
  }

  const data = await res.json();
  const pipelines = (data.results || []).map(p => ({
    pipeline_id: p.id,
    pipeline_label: p.label,
    stages: (p.stages || [])
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(s => ({ stage_id: s.id, stage_label: s.label })),
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(pipelines, null, 2),
  };
};
