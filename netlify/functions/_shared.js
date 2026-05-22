const calendlyEventMap = {
  "discovery-call-foundation-pathway": { category: "Self-Development Pathway", subCategory: "Foundations" },
  "the-rebuilder-30min-coaching-experience": { category: "30min Coaching Experience", subCategory: "The Rebuilder" },
  "the-seeker-30min-coaching-experience": { category: "30min Coaching Experience", subCategory: "The Seeker" },
  "discovery-call-developmental-coaching": { category: "Developmental Coaching" },
  "discovery-call-self-development-pathway": { category: "Self-Development Pathway", subCategory: "Self-Development Pathway" },
  "discovery-call-the-optimiser": { category: "Self-Development Pathway", subCategory: "The Optimiser" },
  "discovery-call-the-rebuilder": { category: "Self-Development Pathway", subCategory: "The Rebuilder" },
  "discovery-call-the-seeker": { category: "Self-Development Pathway", subCategory: "The Seeker" },
  "let-s-talk-nlp": { category: "NLP Practitioner" },
  "let-s-talk-roommates": { category: "RoomMates", subCategory: "RoomMates" },

  "discovery-call-coach-pathway": { category: "Coach Training Pathway", subCategory: "Coach Training Pathway" },
  "discovery-call-existing-coach": { category: "Coach Training Pathway", subCategory: "Existing Coach" },
  "discovery-call-become-a-coach": { category: "Coach Training Pathway", subCategory: "Becoming a Coach" },
  "let-s-chat-coaching-essentials": { category: "Coach Training Pathway", subCategory: "Let's Chat Coaching Essentials" },

  "discovery-call-executive-pathway": { category: "Executive Support Pathway", subCategory: "Executive Pathway" },
  "discovery-call-developmental-elt-coaching": { category: "Executive Support Pathway", subCategory: "ELT Development", subSubCategory: "Developmental ELT Coaching" },
  "discovery-call-elt-pathway": { category: "Executive Support Pathway", subCategory: "ELT Development" },
  "discovery-call-corporate-nlp-training": { category: "Executive Support Pathway", subCategory: "ELT Development", subSubCategory: "Corporate NLP Training" },
  "discovery-call-integral-leadership-training": { category: "Executive Support Pathway", subCategory: "ELT Development", subSubCategory: "Integral+ Leadership Training" },
  "discovery-call-the-burnt-out-performer": { category: "Executive Support Pathway", subCategory: "Seasoned Executive", subSubCategory: "The Burnt-Out Performer" },
  "discovery-call-the-disconnected-achiever": { category: "Executive Support Pathway", subCategory: "Seasoned Executive", subSubCategory: "The Disconnected Achiever" },
  "discovery-call-the-systems-strategist": { category: "Executive Support Pathway", subCategory: "Seasoned Executive", subSubCategory: "The Systems Strategist" },
  "discovery-call-the-performance-driven-transitioner": { category: "Executive Support Pathway", subCategory: "New Executive", subSubCategory: "The Performance Driven Transitioner" },
  "discovery-call-the-performance-driver-transitioner": { category: "Executive Support Pathway", subCategory: "New Executive", subSubCategory: "The Performance Driven Transitioner" },
  "discovery-call-the-role-rising-performer": { category: "Executive Support Pathway", subCategory: "New Executive", subSubCategory: "The Role Rising Performer" },
  "discovery-call-the-role-rising-reformer": { category: "Executive Support Pathway", subCategory: "New Executive", subSubCategory: "The Role Rising Performer" },
  "discovery-call-the-self-doubting-performer": { category: "Executive Support Pathway", subCategory: "Aspiring Executive", subSubCategory: "The Self-Doubting Performer" },
  "discovery-call-the-emergent-executive": { category: "Executive Support Pathway", subCategory: "Aspiring Executive", subSubCategory: "The Emergent Executive" },
  "discovery-call-the-over-burdened-change-agent": { category: "Executive Support Pathway", subCategory: "Aspiring Executive", subSubCategory: "The Over Burdened Change Agent" },
  "discovery-call-the-overburdened-change-agent": { category: "Executive Support Pathway", subCategory: "Aspiring Executive", subSubCategory: "The Over Burdened Change Agent" },
  "discovery-call-the-aspiring-executive": { category: "Executive Support Pathway", subCategory: "Aspiring Executive" },
  "discovery-call-aspiring-executive": { category: "Executive Support Pathway", subCategory: "Aspiring Executive" },
  "discovery-call-the-empathetic-overextender": { category: "Executive Support Pathway", subCategory: "New Executive", subSubCategory: "The Empathetic Overextender" },
  "discovery-call-the-empathic-overextender": { category: "Executive Support Pathway", subCategory: "New Executive", subSubCategory: "The Empathetic Overextender" }
};

const EXECUTIVE_SUPPORT_PATHWAY = "Executive Support Pathway";

const executiveSupportBreakdownCategories = [
  "Executive Pathway",
  "ELT Pathway",
  "Developmental ELT Coaching",
  "Corporate NLP Training",
  "Integral+ Leadership Training",
  "The Burnt-Out Performer",
  "The Emergent Executive",
  "The Systems Strategist",
  "The Self-Doubting Performer",
  "The Aspiring Executive",
  "The Empathetic Overextender",
  "The Over Burdened Change Agent",
  "The Performance Driven Transitioner",
  "The Role Rising Performer",
  "The Disconnected Achiever",
];

const executiveSupportBreakdownBySlug = {
  "discovery-call-executive-pathway": "Executive Pathway",
  "discovery-call-elt-pathway": "ELT Pathway",
  "discovery-call-developmental-elt-coaching": "Developmental ELT Coaching",
  "discovery-call-corporate-nlp-training": "Corporate NLP Training",
  "discovery-call-integral-leadership-training": "Integral+ Leadership Training",
  "discovery-call-the-burnt-out-performer": "The Burnt-Out Performer",
  "discovery-call-the-emergent-executive": "The Emergent Executive",
  "discovery-call-the-systems-strategist": "The Systems Strategist",
  "discovery-call-the-self-doubting-performer": "The Self-Doubting Performer",
  "discovery-call-the-aspiring-executive": "The Aspiring Executive",
  "discovery-call-aspiring-executive": "The Aspiring Executive",
  "discovery-call-the-empathetic-overextender": "The Empathetic Overextender",
  "discovery-call-the-empathic-overextender": "The Empathetic Overextender",
  "discovery-call-the-over-burdened-change-agent": "The Over Burdened Change Agent",
  "discovery-call-the-overburdened-change-agent": "The Over Burdened Change Agent",
  "discovery-call-the-performance-driven-transitioner": "The Performance Driven Transitioner",
  "discovery-call-the-performance-driver-transitioner": "The Performance Driven Transitioner",
  "discovery-call-the-role-rising-performer": "The Role Rising Performer",
  "discovery-call-the-role-rising-reformer": "The Role Rising Performer",
  "discovery-call-the-disconnected-achiever": "The Disconnected Achiever",
};

function dateOnly(d) { return d.toISOString().slice(0, 10); }

function getRange(params) {
  const key = params.get("range") || "mtd";
  const today = new Date();
  let start = new Date(today);
  let end = new Date(today);
  if (key === "mtd") start = new Date(today.getFullYear(), today.getMonth(), 1);
  if (key === "last30") { start = new Date(today); start.setDate(today.getDate() - 30); }
  if (key === "lastMonth") { start = new Date(today.getFullYear(), today.getMonth() - 1, 1); end = new Date(today.getFullYear(), today.getMonth(), 0); }
  if (key === "qtd") { const q = Math.floor(today.getMonth() / 3) * 3; start = new Date(today.getFullYear(), q, 1); }
  return { key, startDate: dateOnly(start), endDate: dateOnly(end) };
}

function slugFrom(value) {
  if (!value) return "unknown";
  return String(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function mapCalendlySlug(slug) {
  const exact = calendlyEventMap[slug];
  return exact ? { ...exact, matchType: "allowed_event" } : null;
}

function normaliseProduct(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("nlp practitioner") || raw.includes("nlp prac")) return "NLP Practitioner";
  if (raw.includes("nlp master") || raw.includes("master practitioner")) return "NLP Master Practitioner";
  if (raw.includes("identity compass")) return "Identity Compass";
  if (raw.includes("developmental life coaching")) return "Developmental Life Coaching";
  if (raw.includes("roommates") || raw.includes("room mates")) return "RoomMates";
  if (raw.includes("pathway")) return "Pathway Products";
  if (raw.includes("executive")) return "Executive Support";
  if (raw.includes("coach")) return "Coach Training";
  return value || "Unknown";
}

function getExecutiveSupportBreakdownLabel(call) {
  if (!call || call.category !== EXECUTIVE_SUPPORT_PATHWAY) return null;
  if (call.eventSlug && executiveSupportBreakdownBySlug[call.eventSlug]) {
    return executiveSupportBreakdownBySlug[call.eventSlug];
  }
  return call.subSubCategory || call.subCategory || "Other Executive Support";
}

function buildExecutiveSupportBreakdown(items) {
  const counts = new Map(executiveSupportBreakdownCategories.map(label => [label, 0]));
  const extraLabels = [];

  for (const item of items || []) {
    const label = getExecutiveSupportBreakdownLabel(item);
    if (!label) continue;
    if (!counts.has(label)) {
      counts.set(label, 0);
      extraLabels.push(label);
    }
    counts.set(label, counts.get(label) + 1);
  }

  return [...executiveSupportBreakdownCategories, ...extraLabels].map(label => ({
    label,
    value: counts.get(label) || 0,
  }));
}

function groupCount(items, labelFn) {
  const map = {};
  for (const item of items || []) {
    const label = labelFn(item) || "Unknown";
    map[label] = (map[label] || 0) + 1;
  }

  const executiveSupportBreakdown = buildExecutiveSupportBreakdown(items);
  return Object.entries(map).map(([label, value]) => ({
    label,
    value,
    ...(label === EXECUTIVE_SUPPORT_PATHWAY ? { breakdown: executiveSupportBreakdown } : {}),
  }));
}

function groupSum(items, labelFn, valueFn) {
  const map = {};
  for (const item of items || []) {
    const label = labelFn(item) || "Unknown";
    map[label] = (map[label] || 0) + Number(valueFn(item) || 0);
  }
  return Object.entries(map).map(([label, value]) => ({ label, value }));
}

function emptyData(range, warnings = []) {
  return {
    dateRange: range,
    kpis: { callsBooked: 0, websiteVisitors: 0, conversionRate: 0, pipelineValue: 0, revenue: 0, dealsWon: 0, dealsWonValue: 0, referrals: 0, brochureDownloads: 0, outboundCalendlyClicks: 0, outboundKajabiClicks: 0 },
    websitePages: [],
    calls: [],
    deals: [],
    activeDeals: [],
    purchases: [],
    referrals: [],
    charts: { callsByCategory: [], callsByTeamMember: [], dealsByStage: [], salesByTeam: [], revenueByProduct: [], brochureDownloadsByPage: [] },
    meta: { usingMockData: false, warnings }
  };
}

module.exports = { getRange, slugFrom, mapCalendlySlug, normaliseProduct, groupCount, groupSum, emptyData };
