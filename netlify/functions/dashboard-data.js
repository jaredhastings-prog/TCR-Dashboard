const { getStore } = require("@netlify/blobs");
const { getRange, slugFrom, mapCalendlySlug, normaliseProduct, groupCount, groupSum, emptyData } = require("./_shared");

const HUBSPOT_ACTIVE_DEALS_START_DATE = "2025-01-01";
const CALENDLY_LINK_URL_CONTAINS = [
  "calendly",
  "madeleine-thecoachingroom/",
  "jay-hedley-thecoachingroom/",
  "jared-thecoachingroom/",
  "joseph-thecoachingroom/",
  "joseph-scott-thecoachingroom/",
];

async function calendlyFetch(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Calendly API ${res.status}: ${text.slice(0, 300)}`);
  }
  return await res.json();
}

async function fetchCalendlyEvents(token, scope, range) {
  const maxStart = new Date(`${range.endDate}T23:59:59.999Z`);
  maxStart.setFullYear(maxStart.getFullYear() + 1);

  const params = new URLSearchParams({
    ...scope,
    status: "active",
    count: "100",
    min_start_time: `${range.startDate}T00:00:00.000000Z`,
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

function dateFromIso(value) {
  return value ? String(value).slice(0, 10) : "";
}

function isDateInRange(date, range) {
  return date >= range.startDate && date <= range.endDate;
}

function dedupeKey(call) {
  return [
    call.name,
    call.eventSlug,
    call.teamMember,
  ].map(value => String(value || "").trim().toLowerCase()).join("|");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function normaliseUtmKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function valueFromObjectByKeys(object, keys) {
  if (!object || typeof object !== "object") return "";
  const wanted = new Set(keys.map(normaliseUtmKey));
  for (const [key, value] of Object.entries(object)) {
    if (wanted.has(normaliseUtmKey(key)) && value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function answerFromInviteeQuestions(invitee, keys) {
  const answers = invitee && Array.isArray(invitee.questions_and_answers) ? invitee.questions_and_answers : [];
  const wanted = new Set(keys.map(normaliseUtmKey));

  for (const item of answers) {
    const label = firstNonEmpty(item.question, item.name, item.label, item.key);
    const answer = firstNonEmpty(item.answer, item.value, item.response);
    if (wanted.has(normaliseUtmKey(label)) && answer) return answer;
  }

  return "";
}

function extractCalendlyUtms(invitee = {}) {
  const tracking = invitee && typeof invitee.tracking === "object" ? invitee.tracking : {};
  return {
    source: firstNonEmpty(
      valueFromObjectByKeys(tracking, ["utm_source", "UTM_Source", "utmSource", "source"]),
      valueFromObjectByKeys(invitee, ["utm_source", "UTM_Source", "utmSource", "source"]),
      answerFromInviteeQuestions(invitee, ["UTM_Source", "utm_source", "utm source"])
    ),
    medium: firstNonEmpty(
      valueFromObjectByKeys(tracking, ["utm_medium", "UTM_Medium", "utmMedium", "medium"]),
      valueFromObjectByKeys(invitee, ["utm_medium", "UTM_Medium", "utmMedium", "medium"]),
      answerFromInviteeQuestions(invitee, ["UTM_Medium", "utm_medium", "utm medium"])
    ),
    content: firstNonEmpty(
      valueFromObjectByKeys(tracking, ["utm_content", "UTM_Content", "utmContent", "content"]),
      valueFromObjectByKeys(invitee, ["utm_content", "UTM_Content", "utmContent", "content"]),
      answerFromInviteeQuestions(invitee, ["UTM_Content", "utm_content", "utm content"])
    ),
  };
}

async function fetchCalendlyCalls(range, warnings = []) {
  const token = process.env.CALENDLY_API_KEY;
  if (!token) return { calls: [], meta: { totalEventsSeen: 0, includedAllowedEvents: 0, excludedUnmapped: 0, excludedOutsideBookingRange: 0, excludedDuplicateBookings: 0 } };

  const me = await calendlyFetch("https://api.calendly.com/users/me", token);
  const userUri = me && me.resource && me.resource.uri ? me.resource.uri : null;
  if (!userUri) throw new Error("Calendly user URI not found from /users/me");

  const orgValue = me.resource.current_organization;
  const organizationUri = typeof orgValue === "string" ? orgValue : orgValue && orgValue.uri ? orgValue.uri : null;
  let events = [];
  let scope = "user";

  if (organizationUri) {
    try {
      // V10: mapped sales-call links live across multiple team members.
      // Query the Calendly org first so Madeleine/Jay/team links are visible.
      events = await fetchCalendlyEvents(token, { organization: organizationUri }, range);
      scope = "organization";
    } catch (err) {
      warnings.push("Calendly organization lookup failed; using current Calendly user only. The token may need Owner/Admin access.");
      events = await fetchCalendlyEvents(token, { user: userUri }, range);
    }
  } else {
    warnings.push("Calendly token has no current organization; using current Calendly user only.");
    events = await fetchCalendlyEvents(token, { user: userUri }, range);
  }

  const calls = [];
  const meta = { totalEventsSeen: events.length, includedAllowedEvents: 0, excludedUnmapped: 0, excludedOutsideBookingRange: 0, excludedDuplicateBookings: 0, scope, dateBasis: "invitee_created_at" };

  // V12: only include the exact Calendly event names approved by TCR.
  // Event memberships preserve the assigned host for round-robin bookings.
  const mappedEvents = [];
  for (const event of events) {
    const eventSlug = slugFrom(event.name || "");
    const mapping = mapCalendlySlug(eventSlug);
    if (!mapping) {
      meta.excludedUnmapped += 1;
      continue;
    }
    mappedEvents.push({ event, eventSlug, mapping });
  }

  // Invitee lookups are one API call per event; running them serially made
  // load time grow with total bookings. Fetch in parallel batches instead
  // (Calendly allows well above this rate).
  const INVITEE_CONCURRENCY = 10;
  const processed = [];
  for (let i = 0; i < mappedEvents.length; i += INVITEE_CONCURRENCY) {
    const chunk = mappedEvents.slice(i, i + INVITEE_CONCURRENCY);
    processed.push(...await Promise.all(chunk.map(async ({ event, eventSlug, mapping }) => {
      let inviteeName = "Unknown";
      let bookingDate = dateFromIso(event.created_at);
      let utm = { source: "", medium: "", content: "" };
      try {
        const uuid = event.uri.split("/").filter(Boolean).pop();
        const invitees = await calendlyFetch(`https://api.calendly.com/scheduled_events/${uuid}/invitees?count=1`, token);
        const invitee = invitees.collection && invitees.collection[0] ? invitees.collection[0] : null;
        inviteeName = invitee && invitee.name ? invitee.name : "Unknown";
        bookingDate = dateFromIso(invitee && invitee.created_at ? invitee.created_at : event.created_at);
        utm = extractCalendlyUtms(invitee || {});
      } catch {}
      return { event, eventSlug, mapping, inviteeName, bookingDate, utm };
    })));
  }

  for (const { event, eventSlug, mapping, inviteeName, bookingDate, utm } of processed) {
    if (!isDateInRange(bookingDate, range)) {
      meta.excludedOutsideBookingRange += 1;
      continue;
    }

    meta.includedAllowedEvents += 1;

    calls.push({
      id: event.uri,
      name: inviteeName,
      date: bookingDate,
      bookedDate: bookingDate,
      scheduledDate: dateFromIso(event.start_time),
      teamMember: Array.from(new Set((event.event_memberships || []).map(m => m.user_name).filter(Boolean))).join(", ") || me.resource.name || "Calendly",
      eventName: event.name || "Calendly Event",
      eventSlug,
      category: mapping.category,
      subCategory: mapping.subCategory,
      subSubCategory: mapping.subSubCategory,
      source: utm.source,
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmContent: utm.content,
      matchType: mapping.matchType,
    });
  }

  calls.sort((a, b) => String(a.bookedDate || "").localeCompare(String(b.bookedDate || "")) || String(a.scheduledDate || "").localeCompare(String(b.scheduledDate || "")));

  const uniqueCalls = [];
  const seenKeys = new Set();
  for (const call of calls) {
    const key = dedupeKey(call);
    if (seenKeys.has(key)) {
      meta.excludedDuplicateBookings += 1;
      meta.includedAllowedEvents -= 1;
      continue;
    }
    seenKeys.add(key);
    uniqueCalls.push(call);
  }

  return { calls: uniqueCalls, meta };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function hsFetch(path, token, options = {}) {
  // HubSpot's search API has a strict per-second limit; retry on 429/5xx with
  // backoff (honouring Retry-After) so a burst of parallel searches doesn't
  // drop data.
  const maxAttempts = 4;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://api.hubapi.com${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (res.ok) return await res.json();

    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * attempt;
      await sleep(waitMs);
      continue;
    }

    const text = await res.text();
    throw new Error(`HubSpot API ${res.status}: ${text.slice(0, 500)}`);
  }
}

async function hsSearchAll(path, token, body) {
  const results = [];
  let after;

  do {
    const page = await hsFetch(path, token, {
      method: "POST",
      body: JSON.stringify({ ...body, ...(after ? { after } : {}) }),
    });
    results.push(...(page.results || []));
    after = page.paging && page.paging.next ? page.paging.next.after : null;
  } while (after);

  return results;
}

function classifyStage(label) {
  const l = String(label || "").toLowerCase();
  // Won/Lost first so the new short stage names ("Won", "Lost") are caught
  // as well as the legacy "Closed Won"/"Closed Lost".
  if (l.includes("won")) return "Closed Won";
  if (l.includes("lost")) return "Closed Lost";
  if (l.includes("no show") || l.includes("no-show")) return "No Show";
  if (l.includes("void")) return "Voided";
  if (l.includes("qualified")) return "Qualified Sales Lead";
  // Otherwise preserve the real stage label (Call Booked, Following Up, …)
  // so the Deals-by-Stage breakdown reflects the actual funnel.
  return label ? String(label) : "Unknown";
}

async function fetchHubSpotDeals(range) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return [];

  const pipelines = await hsFetch("/crm/v3/pipelines/deals", token);
  const pipeline = (pipelines.results || []).find(p => String(p.label).toLowerCase() === "sales pipeline") || (pipelines.results || [])[0];
  if (!pipeline) return [];

  const stageLabels = {};
  for (const s of pipeline.stages || []) stageLabels[s.id] = s.label;

  const owners = await hsFetch("/crm/v3/owners?limit=100", token);
  const ownerMap = {};
  for (const o of owners.results || []) ownerMap[o.id] = [o.firstName, o.lastName].filter(Boolean).join(" ") || o.email || o.id;

  // Only request the outcome-reason property if it exists, so accounts that
  // haven't created it yet don't get a 400 from the search API.
  const dealPropertyNames = await fetchHubSpotPropertyNames("deals", token);
  const outcomeReasonProps = keepExistingProperties(["outcome_reason"], dealPropertyNames);

  // V9: Report HubSpot deals by close date.
  // This keeps monthly reporting aligned to when deals are won/lost/voided.
  const body = {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: pipeline.id },
        { propertyName: "closedate", operator: "GTE", value: `${range.startDate}T00:00:00.000Z` },
        { propertyName: "closedate", operator: "LTE", value: `${range.endDate}T23:59:59.999Z` }
      ],
    }],
    properties: ["dealname", "amount", "dealstage", "pipeline", "hubspot_owner_id", "closedate", "createdate", "product", ...outcomeReasonProps],
    limit: 100,
  };

  const results = await hsSearchAll("/crm/v3/objects/deals/search", token, body);

  return results.map(d => {
    const p = d.properties || {};
    const stageLabel = stageLabels[p.dealstage] || p.dealstage || "Unknown";
    return {
      id: d.id,
      dealName: p.dealname || "Untitled deal",
      stage: classifyStage(stageLabel),
      stageLabel,
      amount: Number(p.amount || 0),
      owner: ownerMap[p.hubspot_owner_id] || "Unknown",
      product: normaliseProduct(p.product || p.dealname || ""),
      outcomeReason: p.outcome_reason || "",
      closeDate: p.closedate || undefined,
      createDate: p.createdate || undefined,
    };
  });
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
  if (!callTokens.length) return false;
  return callTokens.every(token => deal.includes(token));
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

async function fetchHubSpotActiveDeals(calls = []) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  if (!token) return [];

  const [pipelines, owners, dealPropertyNames] = await Promise.all([
    hsFetch("/crm/v3/pipelines/deals", token),
    hsFetch("/crm/v3/owners?limit=100", token),
    fetchHubSpotPropertyNames("deals", token),
  ]);

  const pipeline = (pipelines.results || []).find(p => String(p.label).toLowerCase() === "sales pipeline") || (pipelines.results || [])[0];
  if (!pipeline) return [];

  const openStageIds = [];
  const stageLabelMap = {};
  for (const stage of pipeline.stages || []) {
    stageLabelMap[stage.id] = stage.label;
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
  // Accountability properties — only requested if they exist in the account,
  // so the dashboard keeps working before the HubSpot setup is done.
  const accountabilityProps = keepExistingProperties(
    ["next_step", "next_step_due_date", "lead_source"],
    dealPropertyNames
  );
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
    ...accountabilityProps,
  ]));

  const results = await hsSearchAll("/crm/v3/objects/deals/search", token, {
    filterGroups: [{
      filters: [
        { propertyName: "pipeline", operator: "EQ", value: pipeline.id },
        { propertyName: "dealstage", operator: "IN", values: openStageIds },
        { propertyName: "createdate", operator: "GTE", value: `${HUBSPOT_ACTIVE_DEALS_START_DATE}T00:00:00.000Z` },
      ],
    }],
    properties,
    sorts: ["closedate"],
    limit: 100,
  });
  const sourcePropertyNames = Array.from(new Set([...sourceCandidates, ...discoveredCalendlyProperties]));

  return results.map(deal => {
    const p = deal.properties || {};
    const description = firstPropertyValue(p, descriptionCandidates);
    const activeDeal = {
      id: deal.id,
      dealName: p.dealname || "Untitled deal",
      dealOwner: ownerMap[p.hubspot_owner_id] || "Unknown",
      dealDescription: description ? description.value : (p.dealname || "Untitled deal"),
      dealValue: Number(p.amount || 0),
      createdDate: p.createdate || "",
      expectedCloseDate: p.closedate || "",
      rawProperties: p,
    };

    return {
      id: activeDeal.id,
      dealOwner: activeDeal.dealOwner,
      dealDescription: activeDeal.dealDescription,
      dealValue: activeDeal.dealValue,
      createdDate: activeDeal.createdDate,
      expectedCloseDate: activeDeal.expectedCloseDate,
      stage: stageLabelMap[p.dealstage] || "",
      nextStep: p.next_step || "",
      nextStepDueDate: p.next_step_due_date || "",
      leadSource: p.lead_source || "",
      discoveryCallSource: inferDiscoveryCallSource(activeDeal, calls, sourcePropertyNames),
    };
  });
}

async function fetchHubSpotCallSalesMatches(calls) {
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const totalCalls = (calls || []).length;
  if (!token || !totalCalls) {
    return { totalCalls, matchedCalls: 0, unmatchedCalls: totalCalls, conversionRate: 0, matches: [] };
  }

  // One deal search per unique invitee name, in parallel batches — these
  // were previously awaited one at a time.
  const uniqueQueries = Array.from(new Set(
    calls.map(call => String(call.name || "").trim()).filter(Boolean).map(q => q.toLowerCase())
  ));
  const cache = new Map();
  // HubSpot search allows only a few requests per second per account; keep the
  // batch small so parallel searches don't trip the secondly rate limit.
  const SEARCH_CONCURRENCY = 3;
  for (let i = 0; i < uniqueQueries.length; i += SEARCH_CONCURRENCY) {
    const chunk = uniqueQueries.slice(i, i + SEARCH_CONCURRENCY);
    await Promise.all(chunk.map(async query => {
      const body = {
        query,
        properties: ["dealname", "amount", "dealstage", "createdate", "closedate"],
        limit: 10,
      };
      const data = await hsFetch("/crm/v3/objects/deals/search", token, { method: "POST", body: JSON.stringify(body) }).catch(() => ({ results: [] }));
      cache.set(query, data);
    }));
  }

  const matches = [];
  for (const call of calls) {
    const query = String(call.name || "").trim().toLowerCase();
    const data = query ? cache.get(query) : null;
    if (!data) continue;
    const matchedDeal = (data.results || []).find(deal => dealMatchesCallName(call.name, deal.properties && deal.properties.dealname));
    if (matchedDeal) {
      matches.push({
        callId: call.id,
        callName: call.name,
        dealId: matchedDeal.id,
        dealName: matchedDeal.properties && matchedDeal.properties.dealname ? matchedDeal.properties.dealname : "Untitled deal",
        amount: Number(matchedDeal.properties && matchedDeal.properties.amount || 0),
        dealStage: matchedDeal.properties && matchedDeal.properties.dealstage ? matchedDeal.properties.dealstage : undefined,
      });
    }
  }

  const matchedCalls = matches.length;
  return {
    totalCalls,
    matchedCalls,
    unmatchedCalls: Math.max(totalCalls - matchedCalls, 0),
    conversionRate: totalCalls ? Number(((matchedCalls / totalCalls) * 100).toFixed(1)) : 0,
    matches,
  };
}

async function fetchGa4PageMetrics(_range, options = {}) {
  const propertyId = normaliseGa4PropertyId(firstEnv("GA4_PROPERTY_ID", "GOOGLE_ANALYTICS_PROPERTY_ID", "GA_PROPERTY_ID"));
  if (!propertyId) throw new Error("GA4_PROPERTY_ID not found");

  const accessToken = await getGoogleAccessToken();
  const includeDebug = Boolean(options.debug);

  const pageReport = await ga4RunReport(propertyId, accessToken, {
    dateRanges: [{ startDate: _range.startDate, endDate: _range.endDate }],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "activeUsers" },
      { name: "screenPageViewsPerUser" },
      { name: "eventCount" },
      { name: "bounceRate" },
    ],
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: "100",
  });

  const pages = (pageReport.rows || []).map(row => {
    const metrics = row.metricValues || [];
    return {
      page: row.dimensionValues && row.dimensionValues[0] ? row.dimensionValues[0].value : "(not set)",
      views: Number(metrics[0]?.value || 0),
      activeUsers: Number(metrics[1]?.value || 0),
      viewsPerActiveUser: Number(metrics[2]?.value || 0),
      eventCount: Number(metrics[3]?.value || 0),
      bounceRate: Number(metrics[4]?.value || 0) * 100,
      outboundCalendlyClicks: 0,
      outboundKajabiClicks: 0,
      brochureDownloads: 0,
    };
  });

  const pageMap = new Map(pages.map(page => [page.page, page]));

  const [calendlyClicks, kajabiClicks] = await Promise.all([
    fetchGa4OutboundClicks(propertyId, accessToken, _range, {
      label: "Calendly",
      linkContainsAny: CALENDLY_LINK_URL_CONTAINS,
      eventNameMode: "exactClick",
      includeDebug,
    }),
    fetchGa4OutboundClicks(propertyId, accessToken, _range, {
      label: "Kajabi",
      linkContainsAny: ["kajabi.com"],
      eventNameMode: "exactClick",
      includeDebug,
    }),
  ]);

  for (const row of calendlyClicks.rows) {
    const page = pageMap.get(row.page) || { page: row.page, views: 0, activeUsers: 0, viewsPerActiveUser: 0, eventCount: 0, bounceRate: 0, outboundCalendlyClicks: 0, outboundKajabiClicks: 0, brochureDownloads: 0 };
    page.outboundCalendlyClicks += row.clicks;
    pageMap.set(row.page, page);
  }

  for (const row of kajabiClicks.rows) {
    const page = pageMap.get(row.page) || { page: row.page, views: 0, activeUsers: 0, viewsPerActiveUser: 0, eventCount: 0, bounceRate: 0, outboundCalendlyClicks: 0, outboundKajabiClicks: 0, brochureDownloads: 0 };
    page.outboundKajabiClicks += row.clicks;
    pageMap.set(row.page, page);
  }

  const resultPages = Array.from(pageMap.values()).sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
  return {
    pages: resultPages,
    debug: includeDebug ? {
      outboundClicks: {
        calendly: calendlyClicks.debug,
        kajabi: kajabiClicks.debug,
      },
      finalTotals: {
        outboundCalendlyClicks: resultPages.reduce((t, p) => t + Number(p.outboundCalendlyClicks || 0), 0),
        outboundKajabiClicks: resultPages.reduce((t, p) => t + Number(p.outboundKajabiClicks || 0), 0),
      },
    } : null,
  };
}

function normaliseGa4PropertyId(value) {
  return String(value || "").trim().replace(/^properties\//, "");
}

function firstEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return cleanEnvValue(value);
  }
  return "";
}

function cleanEnvValue(value) {
  const trimmed = String(value || "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function serviceAccountJsonFromEnv() {
  // Base64 avoids Netlify/newline escaping issues, so prefer it when present.
  const encodedJson = firstEnv("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
  if (encodedJson) {
    try {
      return Buffer.from(encodedJson, "base64").toString("utf8");
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64");
    }
  }

  const rawJson = firstEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
  if (rawJson) return rawJson;

  const clientEmail = firstEnv("GOOGLE_SERVICE_ACCOUNT_CLIENT_EMAIL", "GA4_SERVICE_ACCOUNT_CLIENT_EMAIL");
  const privateKey = firstEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "GA4_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (clientEmail && privateKey) {
    return JSON.stringify({ client_email: clientEmail, private_key: privateKey });
  }
  if (clientEmail || privateKey) {
    throw new Error("Google service account is partially configured. Set both client email and private key");
  }

  return "";
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getGoogleAccessToken() {
  const oauthCredentials = getGoogleOAuthCredentials();
  if (oauthCredentials) return await getGoogleOAuthAccessToken(oauthCredentials);

  const serviceAccountJson = serviceAccountJsonFromEnv();
  if (serviceAccountJson) return await getGoogleServiceAccountAccessToken(serviceAccountJson);

  throw new Error("Google auth not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON, or set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_OAUTH_REFRESH_TOKEN");
}

async function getGoogleServiceAccountAccessToken(serviceAccountJson) {
  const crypto = require("crypto");
  let credentials;
  try {
    credentials = JSON.parse(serviceAccountJson);
    if (typeof credentials === "string") credentials = JSON.parse(credentials);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key");
  }
  const privateKey = String(credentials.private_key).replace(/\\n/g, "\n");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Google service account private_key is not a valid PEM private key");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const unsignedJwt = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsignedJwt)
    .sign(privateKey);
  const jwt = `${unsignedJwt}.${base64Url(signature)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google service account auth ${res.status}: ${text.slice(0, 300)}. Check that client_email and private_key come from the same service-account JSON key, or use the OAuth env vars instead`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("Google auth did not return an access token");
  return data.access_token;
}

function getGoogleOAuthCredentials() {
  const clientId = firstEnv("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID", "GA4_OAUTH_CLIENT_ID", "GA4_CLIENT_ID");
  const clientSecret = firstEnv("GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "GA4_OAUTH_CLIENT_SECRET", "GA4_CLIENT_SECRET");
  const refreshToken = firstEnv("GOOGLE_OAUTH_REFRESH_TOKEN", "GOOGLE_REFRESH_TOKEN", "GA4_OAUTH_REFRESH_TOKEN", "GA4_REFRESH_TOKEN", "GOOGLE_ANALYTICS_REFRESH_TOKEN");

  if (!clientId && !clientSecret && !refreshToken) return null;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Google OAuth is partially configured. Set client ID, client secret, and refresh token");
  }

  return { clientId, clientSecret, refreshToken };
}

async function getGoogleOAuthAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google OAuth ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error("Google OAuth did not return an access token");
  return data.access_token;
}

async function ga4RunReport(propertyId, accessToken, body) {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GA4 Data API ${res.status}: ${text.slice(0, 500)}`);
  }

  return await res.json();
}

async function ga4RunReportAll(propertyId, accessToken, body, pageSize = 10000) {
  const rows = [];
  let offset = 0;
  let rowCount = 0;

  do {
    const report = await ga4RunReport(propertyId, accessToken, {
      ...body,
      limit: String(pageSize),
      offset: String(offset),
    });
    const batch = report.rows || [];
    rows.push(...batch);
    rowCount = Number(report.rowCount || rowCount || rows.length);
    offset += batch.length;

    if (!batch.length) break;
    if (rowCount && offset >= rowCount) break;
    if (!rowCount && batch.length < pageSize) break;
  } while (true);

  return { rows, rowCount };
}

function containsFilter(fieldName, value) {
  return {
    filter: {
      fieldName,
      stringFilter: { matchType: "CONTAINS", value, caseSensitive: false },
    },
  };
}

function outboundLinkFilter({ linkContains, linkContainsAny, eventNameMode = "exactClick" }) {
  const containsValues = Array.from(new Set([...(linkContainsAny || []), linkContains].filter(Boolean)));
  const linkExpressions = containsValues.map(value => containsFilter("linkUrl", value));
  const expressions = linkExpressions.length === 1
    ? [linkExpressions[0]]
    : [{ orGroup: { expressions: linkExpressions } }];

  if (eventNameMode === "exactClick") {
    expressions.unshift({
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "click", caseSensitive: false },
      },
    });
  } else if (eventNameMode === "containsClick") {
    expressions.unshift({
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "CONTAINS", value: "click", caseSensitive: false },
      },
    });
  }

  return expressions.length === 1 ? expressions[0] : { andGroup: { expressions } };
}

function addMetric(map, key, value) {
  const label = key || "(not set)";
  map[label] = (map[label] || 0) + Number(value || 0);
}

function metricMapToRows(map) {
  return Object.entries(map)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || String(a.label).localeCompare(String(b.label)));
}

async function fetchGa4OutboundClicks(propertyId, accessToken, range, config) {
  const { label, linkContains, linkContainsAny, eventNameMode = "exactClick", includeDebug = false } = config;
  const containsValues = Array.from(new Set([...(linkContainsAny || []), linkContains].filter(Boolean)));
  const report = await ga4RunReportAll(propertyId, accessToken, {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    dimensions: [{ name: "pagePath" }, { name: "eventName" }, { name: "linkUrl" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: outboundLinkFilter({ linkContainsAny: containsValues, eventNameMode }),
    limit: "10000",
  });

  const pageMap = {};
  const eventNameMap = {};
  const linkUrlMap = {};
  const samples = [];
  let totalClicks = 0;

  for (const row of report.rows || []) {
    const page = row.dimensionValues && row.dimensionValues[0] ? row.dimensionValues[0].value : "(not set)";
    const eventName = row.dimensionValues && row.dimensionValues[1] ? row.dimensionValues[1].value : "(not set)";
    const linkUrl = row.dimensionValues && row.dimensionValues[2] ? row.dimensionValues[2].value : "(not set)";
    const clicks = Number(row.metricValues && row.metricValues[0] ? row.metricValues[0].value : 0);
    pageMap[page] = (pageMap[page] || 0) + clicks;
    totalClicks += clicks;

    if (includeDebug) {
      addMetric(eventNameMap, eventName, clicks);
      addMetric(linkUrlMap, linkUrl, clicks);
      if (samples.length < 25) {
        samples.push({ page, eventName, linkUrl, clicks });
      }
    }
  }

  return {
    rows: Object.entries(pageMap).map(([page, clicks]) => ({ page, clicks })),
    debug: includeDebug ? {
      label,
      linkContainsAny: containsValues,
      eventNameMode,
      ga4RowCount: Number(report.rowCount || 0),
      returnedRows: (report.rows || []).length,
      totalClicks,
      eventNames: metricMapToRows(eventNameMap),
      topLinkUrls: metricMapToRows(linkUrlMap).slice(0, 25),
      sampleRows: samples,
    } : {
      label,
      linkContainsAny: containsValues,
      eventNameMode,
      totalClicks,
      returnedRows: (report.rows || []).length,
    },
  };
}

async function fetchKajabiPurchases(range) {
  const store = getKajabiPurchaseStore();
  const list = await store.list();
  const purchases = [];

  for (const blob of list.blobs || []) {
    try {
      const purchase = await store.get(blob.key, { type: "json" });
      if (!purchase || !purchase.date) continue;

      const purchaseDate = String(purchase.date).slice(0, 10);
      if (purchaseDate >= range.startDate && purchaseDate <= range.endDate) {
        purchases.push({
          id: purchase.id || blob.key,
          product: purchase.product || "Unknown",
          amount: Number(purchase.amount || 0),
          date: purchaseDate,
          name: purchase.name || null,
          email: purchase.email || null,
        });
      }
    } catch (err) {
      console.error("Could not read Kajabi purchase blob", blob.key, err);
    }
  }

  return purchases;
}

function getKajabiPurchaseStore() {
  if (process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN) {
    return getStore({
      name: "kajabi-purchases",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
  }

  return getStore("kajabi-purchases");
}

function normalise(range, websitePages, calls, deals, purchases, activeDeals, warnings) {
  const visitors = websitePages.reduce((t, p) => t + Number(p.activeUsers || 0), 0);
  const closedWon = deals.filter(d => d.stage === "Closed Won");
  const conversionEvents = calls.length + purchases.length;
  const conversionRate = visitors ? Number(((conversionEvents / visitors) * 100).toFixed(2)) : 0;

  return {
    dateRange: range,
    kpis: {
      callsBooked: calls.length,
      websiteVisitors: visitors,
      conversionRate,
      pipelineValue: activeDeals.reduce((t, d) => t + Number(d.dealValue || 0), 0),
      revenue: purchases.reduce((t, p) => t + Number(p.amount || 0), 0),
      dealsWon: closedWon.length,
      dealsWonValue: closedWon.reduce((t, d) => t + Number(d.amount || 0), 0),
      referrals: 0,
      brochureDownloads: websitePages.reduce((t, p) => t + Number(p.brochureDownloads || 0), 0),
      outboundCalendlyClicks: websitePages.reduce((t, p) => t + Number(p.outboundCalendlyClicks || 0), 0),
      outboundKajabiClicks: websitePages.reduce((t, p) => t + Number(p.outboundKajabiClicks || 0), 0),
    },
    websitePages,
    calls,
    deals,
    activeDeals,
    purchases,
    referrals: [],
    charts: {
      callsByCategory: groupCount(calls, c => c.category),
      callsByTeamMember: groupCount(calls, c => c.teamMember),
      dealsByStage: groupCount(deals, d => d.stage),
      salesByTeam: groupSum(deals, d => d.owner, d => d.amount),
      revenueByProduct: groupSum(purchases, p => p.product, p => p.amount),
      brochureDownloadsByPage: groupSum(websitePages, p => p.page, p => p.brochureDownloads),
    },
    meta: { usingMockData: false, warnings },
  };
}

// Full calendar month before the month the current range starts in.
// Month-to-date is compared against the complete previous month's result.
function getPreviousRange(range) {
  const [year, month] = range.startDate.split("-").map(Number);
  const prev = new Date(Date.UTC(year, month - 2, 1));
  const prevYear = prev.getUTCFullYear();
  const prevMonth = prev.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  const pad = n => String(n).padStart(2, "0");
  return {
    key: "previousMonth",
    startDate: `${prevYear}-${pad(prevMonth)}-01`,
    endDate: `${prevYear}-${pad(prevMonth)}-${pad(lastDay)}`,
  };
}

async function fetchGa4VisitorTotal(range) {
  const propertyId = normaliseGa4PropertyId(firstEnv("GA4_PROPERTY_ID", "GOOGLE_ANALYTICS_PROPERTY_ID", "GA_PROPERTY_ID"));
  if (!propertyId) throw new Error("GA4_PROPERTY_ID not found");
  const accessToken = await getGoogleAccessToken();
  const report = await ga4RunReport(propertyId, accessToken, {
    dateRanges: [{ startDate: range.startDate, endDate: range.endDate }],
    metrics: [{ name: "activeUsers" }],
  });
  const row = (report.rows || [])[0];
  return Number(row && row.metricValues && row.metricValues[0] ? row.metricValues[0].value : 0);
}

function getCalendlyYtdRange(range) {
  return { key: "ytdFromNov2025", startDate: "2025-11-01", endDate: range.endDate };
}

exports.handler = async (event) => {
  const params = new URLSearchParams(event.rawQuery || "");
  const range = getRange(params);
  const calendlyYtdRange = getCalendlyYtdRange(range);
  const includeGa4Debug = ["1", "true", "ga4"].includes(String(params.get("debug") || "").toLowerCase());
  const warnings = [];

  const previousRange = getPreviousRange(range);

  const startedAt = Date.now();
  const timings = {};
  const timed = (label, promise) => promise.finally(() => { timings[label] = Date.now() - startedAt; });

  // Everything that only depends on the Calendly result is chained off its
  // promise so it overlaps with the GA4/HubSpot/Kajabi fetches instead of
  // running after them.
  const calendlyPromise = timed("calendly", fetchCalendlyCalls(calendlyYtdRange, warnings).catch(e => { warnings.push(`Calendly YTD: ${e.message}`); return { calls: [], meta: { error: e.message } }; }));
  const activeDealsPromise = timed("hubspotActiveDeals", calendlyPromise.then(result => fetchHubSpotActiveDeals(result.calls || [])).catch(e => {
    warnings.push(`HubSpot active deals: ${e.message}`);
    return [];
  }));
  const callSalesPromise = timed("hubspotCallSales", calendlyPromise.then(result => {
    const rangeCalls = (result.calls || []).filter(call => isDateInRange(call.bookedDate || call.date, range));
    return fetchHubSpotCallSalesMatches(rangeCalls);
  }).catch(e => {
    warnings.push(`HubSpot call-sales matching: ${e.message}`);
    return { totalCalls: 0, matchedCalls: 0, unmatchedCalls: 0, conversionRate: 0, matches: [] };
  }));

  const [calendlyYtdResult, websiteResult, deals, purchases, previousVisitors, previousDeals, activeDeals, callSales] = await Promise.all([
    calendlyPromise,
    timed("ga4Pages", fetchGa4PageMetrics(range, { debug: includeGa4Debug }).catch(e => { warnings.push(`GA4: ${e.message}`); return { pages: [], debug: includeGa4Debug ? { error: e.message } : null }; })),
    timed("hubspotDeals", fetchHubSpotDeals(range).catch(e => { warnings.push(`HubSpot: ${e.message}`); return []; })),
    timed("kajabi", fetchKajabiPurchases(range).catch(e => { warnings.push(`Kajabi: ${e.message}`); return []; })),
    timed("ga4PrevVisitors", fetchGa4VisitorTotal(previousRange).catch(() => null)),
    timed("hubspotPrevDeals", fetchHubSpotDeals(previousRange).catch(() => null)),
    activeDealsPromise,
    callSalesPromise,
  ]);
  timings.total = Date.now() - startedAt;

  const websitePages = Array.isArray(websiteResult) ? websiteResult : (websiteResult.pages || []);
  const calls = (calendlyYtdResult.calls || []).filter(call => isDateInRange(call.bookedDate || call.date, range));

  // No-shows are their own open stage in HubSpot; pull them out of the active
  // funnel so they don't inflate pipeline value or the accountability table.
  const isNoShowStage = deal => classifyStage(deal.stage) === "No Show";
  const openDeals = (activeDeals || []).filter(deal => !isNoShowStage(deal));
  const noShows = (activeDeals || []).filter(isNoShowStage);

  const data = normalise(range, websitePages, calls, deals, purchases, openDeals, warnings);
  data.callSales = callSales;
  data.noShows = noShows;

  // Lost deals grouped by outcome reason (closed lost within the range).
  data.charts.lostByReason = groupCount(
    (deals || []).filter(d => d.stage === "Closed Lost"),
    d => d.outcomeReason || "Not specified"
  );

  // Prior-period comparison. Calendly calls come from the same YTD fetch, so the
  // comparison is only available once the previous period falls inside it.
  const previousCalls = previousRange.startDate >= calendlyYtdRange.startDate
    ? (calendlyYtdResult.calls || []).filter(call => isDateInRange(call.bookedDate || call.date, previousRange)).length
    : null;
  const previousClosedWon = Array.isArray(previousDeals) ? previousDeals.filter(d => d.stage === "Closed Won") : null;
  data.kpisPrevious = {
    range: previousRange,
    callsBooked: previousCalls,
    websiteVisitors: previousVisitors,
    dealsWon: previousClosedWon ? previousClosedWon.length : null,
    dealsWonValue: previousClosedWon ? previousClosedWon.reduce((t, d) => t + Number(d.amount || 0), 0) : null,
  };
  data.meta.timings = timings;
  data.meta.calendly = { ...(calendlyYtdResult.meta || {}), includedAllowedEvents: calls.length, sourceRange: calendlyYtdRange, displayedRange: range };
  data.meta.calendlyYtd = calendlyYtdResult.meta || null;
  data.meta.calendlyYtdRange = calendlyYtdRange;
  data.meta.hubspot = {
    activeDealDateField: "createdate",
    activeDealsStartDate: HUBSPOT_ACTIVE_DEALS_START_DATE,
    pipelineValueSource: "activeDeals",
    dealsWonValueDateField: "closedate",
  };
  if (!data.meta.ga4) data.meta.ga4 = {};
  data.meta.ga4.outboundClickMatching = {
    calendly: {
      linkUrlContainsAny: CALENDLY_LINK_URL_CONTAINS,
      eventNameFilter: "eventName exactly 'click'",
      note: "Calendly clicks are counted from GA4 click rows where linkUrl contains a Calendly URL/domain or known TCR Calendly account path, then summed by pagePath.",
    },
    kajabi: {
      linkUrlContains: "kajabi.com",
      eventNameFilter: "eventName exactly 'click'",
    },
  };
  if (websiteResult && websiteResult.debug) data.meta.ga4.clickDebug = websiteResult.debug;
  data.charts.callsByCategoryYtd = groupCount(calendlyYtdResult.calls || [], c => c.category);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=60" },
    body: JSON.stringify(data),
  };
};
