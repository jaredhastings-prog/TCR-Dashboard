const { slugFrom, mapCalendlySlug } = require("./_shared");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" },
    body: JSON.stringify(body),
  };
}

async function hsFetch(path, token, options = {}) {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${text.slice(0, 500)}`);
  }
  return await res.json();
}

async function calendlyFetch(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendly API ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

function dateFromIso(value) {
  return value ? String(value).slice(0, 10) : "";
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchCalendlyEvents(token, scope) {
  const startDate = "2025-11-01";
  const endDate = todayDate();
  const maxStart = new Date(`${endDate}T23:59:59.999Z`);
  maxStart.setFullYear(maxStart.getFullYear() + 1);

  const params = new URLSearchParams({
    ...scope,
    status: "active",
    count: "100",
    min_start_time: `${startDate}T00:00:00.000000Z`,
    max_start_time: maxStart.toISOString(),
    sort: "start_time:asc",
  });

  let url = `https://api.calendly.com/scheduled_events?${params.toString()}`;
  const events = [];

  while (url) {
    const data = await calendlyFetch(url, token);
    events.push(...(data.collection || []));
    url = data.pagination && data.pagination.next_page ? data.pagination.next_page : null;
  }

  return events;
}

async function fetchCalendlyCalls() {
  const token = process.env.CALENDLY_API_KEY;
  if (!token) return [];

  const me = await calendlyFetch("https://api.calendly.com/users/me", token);
  const userUri = me?.resource?.uri;
  const orgValue = me?.resource?.current_organization;
  const organizationUri = typeof orgValue === "string" ? orgValue : orgValue?.uri;
  if (!userUri) return [];

  let events = [];
  try {
    events = organizationUri
      ? await fetchCalendlyEvents(token, { organization: organizationUri })
      : await fetchCalendlyEvents(token, { user: userUri });
  } catch {
    events = await fetchCalendlyEvents(token, { user: userUri });
  }

  const calls = [];
  for (const event of events) {
    const eventSlug = slugFrom(event.name || "");
    const mapping = mapCalendlySlug(eventSlug);
    if (!mapping) continue;

    let inviteeName = "Unknown";
    let inviteeEmail = "";
    let bookingDate = dateFromIso(event.created_at);
    try {
      const uuid = event.uri.split("/").filter(Boolean).pop();
      const invitees = await calendlyFetch(`https://api.calendly.com/scheduled_events/${uuid}/invitees?count=1`, token);
      const invitee = invitees.collection && invitees.collection[0] ? invitees.collection[0] : null;
      inviteeName = invitee?.name || "Unknown";
      inviteeEmail = invitee?.email || "";
      bookingDate = dateFromIso(invitee?.created_at || event.created_at);
    } catch {}

    calls.push({
      id: event.uri,
      name: inviteeName,
      email: inviteeEmail,
      eventName: event.name || "Calendly Event",
      eventSlug,
      bookedDate: bookingDate,
      category: mapping.category,
      subCategory: mapping.subCategory,
      subSubCategory: mapping.subSubCategory,
    });
  }

  return calls;
}

function classifyStage(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("qualified")) return "Qualified Sales Lead";
  if (l.includes("closed won")) return "Closed Won";
  if (l.includes("closed lost")) return "Closed Lost";
  if (l.includes("void")) return "Voided";
  return "Unknown";
}

function normaliseMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dealMatchesCallName(callName, dealName) {
  const call = normaliseMatchText(callName);
  const deal = normaliseMatchText(dealName);
  if (!call || !deal) return false;
  if (call.length >= 4 && deal.includes(call)) return true;
  if (deal.length >= 4 && call.includes(deal)) return true;

  const callTokens = call.split(" ").filter(token => token.length >= 3);
  return callTokens.length > 0 && callTokens.every(token => deal.includes(token));
}

async function fetchHubSpotPropertyNames(objectType, token) {
  try {
    const data = await hsFetch(`/crm/v3/properties/${objectType}?archived=false`, token);
    return new Set((data.results || []).map(property => property.name).filter(Boolean));
  } catch {
    return null;
  }
}

function keepExistingProperties(names, propertyNames) {
  if (!propertyNames) return [];
  return names.filter(name => propertyNames.has(name));
}

function firstPropertyValue(properties, names) {
  for (const name of names || []) {
    const value = properties && properties[name];
    if (value !== undefined && value !== null && String(value).trim()) {
      return { name, value: String(value).trim() };
    }
  }
  return null;
}

function stageIsClosed(stage) {
  const metadata = stage.metadata || {};
  if (String(metadata.isClosed || "").toLowerCase() === "true") return true;
  const classified = classifyStage(stage.label);
  return classified === "Closed Won" || classified === "Closed Lost" || classified === "Voided";
}

function sourceLooksLikeCalendly(value) {
  const text = normaliseMatchText(value);
  return text.includes("calendly") || text.includes("discovery call") || text.includes("booked call") || text.includes("call booking");
}

function inferDiscoveryCallSource(deal, calls, sourcePropertyNames) {
  const directSource = firstPropertyValue(deal.rawProperties, sourcePropertyNames);
  if (directSource && sourceLooksLikeCalendly(directSource.value)) {
    return `HubSpot: ${directSource.value}`;
  }

  const matchedCall = (calls || []).find(call => dealMatchesCallName(call.name, deal.dealName));
  if (matchedCall) {
    return matchedCall.bookedDate
      ? `Calendly match: ${matchedCall.eventName} (${matchedCall.bookedDate})`
      : `Calendly match: ${matchedCall.eventName}`;
  }

  return "No Calendly match";
}

async function fetchActiveDeals(calls = []) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return [];

  const [pipelines, owners, dealPropertyNames] = await Promise.all([
    hsFetch("/crm/v3/pipelines/deals", token),
    hsFetch("/crm/v3/owners?limit=100", token),
    fetchHubSpotPropertyNames("deals", token),
  ]);

  const pipeline = (pipelines.results || []).find(p => String(p.label).toLowerCase() === "sales pipeline") || (pipelines.results || [])[0];
  if (!pipeline) return [];

  const stageLabels = {};
  const openStageIds = [];
  for (const stage of pipeline.stages || []) {
    stageLabels[stage.id] = stage.label;
    if (!stageIsClosed(stage)) openStageIds.push(stage.id);
  }
  if (!openStageIds.length) return [];

  const ownerMap = {};
  for (const owner of owners.results || []) {
    ownerMap[owner.id] = [owner.firstName, owner.lastName].filter(Boolean).join(" ") || owner.email || owner.id;
  }

  const descriptionCandidates = keepExistingProperties(["description", "deal_description", "product"], dealPropertyNames);
  const sourceCandidates = keepExistingProperties([
    "discovery_call_source",
    "discovery_source",
    "calendly_source",
    "calendly_event",
    "calendly_event_name",
    "calendly_booking",
    "hs_analytics_source",
    "hs_analytics_source_data_1",
    "hs_analytics_source_data_2",
    "hs_latest_source",
    "hs_latest_source_data_1",
    "hs_latest_source_data_2",
    "hs_object_source",
    "hs_object_source_label",
    "hs_object_source_detail_1",
    "hs_object_source_detail_2",
  ], dealPropertyNames);
  const discoveredCalendlyProperties = dealPropertyNames
    ? Array.from(dealPropertyNames).filter(name => /calendly|discovery/i.test(name)).slice(0, 25)
    : [];
  const properties = Array.from(new Set([
    "dealname",
    "amount",
    "dealstage",
    "pipeline",
    "hubspot_owner_id",
    "closedate",
    "createdate",
    ...descriptionCandidates,
    ...sourceCandidates,
    ...discoveredCalendlyProperties,
  ]));

  const data = await hsFetch("/crm/v3/objects/deals/search", token, {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{
        filters: [
          { propertyName: "pipeline", operator: "EQ", value: pipeline.id },
          { propertyName: "dealstage", operator: "IN", values: openStageIds },
        ],
      }],
      properties,
      sorts: ["closedate"],
      limit: 100,
    }),
  });
  const sourcePropertyNames = Array.from(new Set([...sourceCandidates, ...discoveredCalendlyProperties]));

  return (data.results || []).map(deal => {
    const p = deal.properties || {};
    const description = firstPropertyValue(p, descriptionCandidates);
    const activeDeal = {
      id: deal.id,
      dealName: p.dealname || "Untitled deal",
      dealOwner: ownerMap[p.hubspot_owner_id] || "Unknown",
      dealDescription: description ? description.value : (p.dealname || "Untitled deal"),
      dealValue: Number(p.amount || 0),
      expectedCloseDate: p.closedate || "",
      rawProperties: p,
    };

    return {
      id: activeDeal.id,
      dealOwner: activeDeal.dealOwner,
      dealDescription: activeDeal.dealDescription,
      dealValue: activeDeal.dealValue,
      expectedCloseDate: activeDeal.expectedCloseDate,
      discoveryCallSource: inferDiscoveryCallSource(activeDeal, calls, sourcePropertyNames),
    };
  });
}

exports.handler = async () => {
  try {
    const [calls] = await Promise.all([
      fetchCalendlyCalls().catch(() => []),
    ]);
    const activeDeals = await fetchActiveDeals(calls);
    return json(200, { activeDeals });
  } catch (err) {
    return json(500, { error: err.message, activeDeals: [] });
  }
};
