const MARKETING_CAMPAIGN_NAMES = [
  "NLP Practitioner",
  "Executive Pathway",
  "RoomMates",
  "Self-Development Pathway",
  "Coach Training Pathway",
];

const MARKETING_CAMPAIGN_SOURCES = ["Facebook", "Instagram", "LinkedIn", "Email"];

function renderMarketingCampaignRows() {
  return MARKETING_CAMPAIGN_NAMES.map(campaign =>
    MARKETING_CAMPAIGN_SOURCES.map((source, index) => {
      const campaignCell = index === 0
        ? `<td rowspan="4" style="font-weight:700;vertical-align:top;">${campaign}</td>`
        : "";

      return `<tr>${campaignCell}<td>${source}</td><td><span class="integration-placeholder">Awaiting UTM Data</span></td><td data-call-bookings-cell data-campaign="${campaign}" data-source="${source}">0</td></tr>`;
    }).join("\n                    ")
  ).join("\n                    ");
}

const MARKETING_CAMPAIGNS_SECTION = `      <details class="accordion-panel">
        <summary><span class="accordion-title">Marketing Campaigns</span><span class="accordion-icon" aria-hidden="true"></span></summary>
        <div class="accordion-content">
          <section class="card">
            <h3>Marketing Campaign Performance</h3>
            <div class="table-scroll wide-table">
              <table>
                <thead><tr><th>Campaign</th><th>Source</th><th>Clicks</th><th>Call Bookings</th></tr></thead>
                <tbody>
                    ${renderMarketingCampaignRows()}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </details>`;
const EXECUTIVE_SUPPORT_BREAKDOWN_STYLES = `
    .count-breakdown { border-bottom:1px solid #e5e7eb; }
    .count-breakdown:last-child { border-bottom:0; }
    .count-breakdown > summary { list-style:none; cursor:pointer; }
    .count-breakdown > summary::-webkit-details-marker { display:none; }
    .count-breakdown > summary.count-row { border-bottom:0; }
    .count-breakdown-hint { color:#6b7280; font-size:12px; font-weight:700; margin-left:8px; }
    .count-breakdown-list { display:grid; gap:0; padding:2px 0 10px 16px; border-top:1px solid #f3f4f6; }
    .count-breakdown-subrow { display:flex; justify-content:space-between; gap:16px; align-items:center; padding:8px 0; border-bottom:1px solid #f3f4f6; }
    .count-breakdown-subrow:last-child { border-bottom:0; }
    .count-breakdown-sublabel { color:#4b5563; font-size:13px; font-weight:600; line-height:1.3; }
    .count-breakdown-subvalue { color:#111827; font-size:16px; font-weight:800; }
    @media (max-width:640px){ .count-breakdown-list{padding-left:10px;} .count-breakdown-subrow{align-items:flex-start;} }
`;

const EXECUTIVE_SUPPORT_BREAKDOWN_SCRIPT = `
    (() => {
      const EXECUTIVE_SUPPORT_CATEGORY = "Executive Support Pathway";
      const baseRenderCountList = renderCountList;

      renderCountList = function(id, rows) {
        if (id !== "callsByCategoryList" && id !== "callsByCategoryYtdList") {
          baseRenderCountList(id, rows);
          return;
        }
        renderCountListWithExecutiveBreakdown(id, rows || []);
      };

      function getBreakdownRows(rows) {
        const parent = (rows || []).find(row => row && row.label === EXECUTIVE_SUPPORT_CATEGORY);
        return Array.isArray(parent && parent.breakdown) ? parent.breakdown : [];
      }

      function renderCountListWithExecutiveBreakdown(id, rows) {
        const breakdownRows = getBreakdownRows(rows);
        const items = [...(rows || [])]
          .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || String(a.label || "").localeCompare(String(b.label || "")));

        document.getElementById(id).innerHTML = items.length ? items.map(row => {
          if (row.label === EXECUTIVE_SUPPORT_CATEGORY) {
            return renderExecutiveBreakdownRow(row, breakdownRows);
          }
          return '<div class="count-row"><span class="count-label">' + escapeHtml(row.label || "Unknown") + '</span><span class="count-value">' + number(row.value) + '</span></div>';
        }).join("") : '<div class="count-row"><span class="count-label">No calls</span><span class="count-value">0</span></div>';
      }

      function renderExecutiveBreakdownRow(row, breakdownRows) {
        const parentValue = breakdownRows.length
          ? breakdownRows.reduce((total, breakdownRow) => total + Number(breakdownRow.value || 0), 0)
          : Number(row.value || 0);
        const subRows = (breakdownRows || []).map(breakdownRow =>
          '<div class="count-breakdown-subrow"><span class="count-breakdown-sublabel">' + escapeHtml(breakdownRow.label || "Unknown") + '</span><span class="count-breakdown-subvalue">' + number(breakdownRow.value) + '</span></div>'
        ).join("");

        return '<details class="count-breakdown"><summary class="count-row"><span class="count-label">' + escapeHtml(row.label || "Unknown") + '<span class="count-breakdown-hint">Breakdown</span></span><span class="count-value">' + number(parentValue) + '</span></summary><div class="count-breakdown-list">' + subRows + '</div></details>';
      }
    })();
`;

const CALENDLY_SOURCE_COLUMN_SCRIPT = `
    (() => {
      const AWAITING_UTM_DATA = "Awaiting UTM Data";
      const SOURCE_LABELS = {
        facebook: "Facebook",
        instagram: "Instagram",
        linkedin: "LinkedIn",
        email: "Email",
      };
      const baseFetch = window.fetch.bind(window);

      window.fetch = async (...args) => {
        const response = await baseFetch(...args);
        const requestUrl = String(args[0] && args[0].url ? args[0].url : args[0] || "");

        if (requestUrl.includes("/.netlify/functions/dashboard-data")) {
          response.clone().json().then(data => {
            window.__tcrDashboardData = data;
            queueMicrotask(updateDashboardSourceViews);
            setTimeout(updateDashboardSourceViews, 0);
            setTimeout(updateDashboardSourceViews, 100);
          }).catch(() => {});
        }

        return response;
      };

      function getCallsTable() {
        const body = document.getElementById("callsTable");
        return body ? body.closest("table") : null;
      }

      function ensureSourceHeader() {
        const table = getCallsTable();
        const headerRow = table && table.querySelector("thead tr");
        if (!headerRow || Array.from(headerRow.children).some(cell => cell.textContent.trim() === "Source")) return;
        const sourceHeader = document.createElement("th");
        sourceHeader.textContent = "Source";
        headerRow.appendChild(sourceHeader);
      }

      function dashboardCalls() {
        return Array.isArray(window.__tcrDashboardData && window.__tcrDashboardData.calls)
          ? window.__tcrDashboardData.calls
          : [];
      }

      function firstNonEmpty(...values) {
        for (const value of values) {
          if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
        }
        return "";
      }

      function normaliseSource(value) {
        return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      }

      function rawSourceValue(call) {
        if (!call) return "";
        const utm = call.utm && typeof call.utm === "object" ? call.utm : {};
        return firstNonEmpty(call.utmSource, call.utm_source, call.source, call.trafficSource, call.campaignSource, utm.source);
      }

      function formatSource(value) {
        const raw = String(value || "").trim();
        const normalised = normaliseSource(raw);
        if (!normalised) return "";
        return SOURCE_LABELS[normalised] || raw;
      }

      function renderSource(value) {
        const formatted = formatSource(value);
        return formatted
          ? escapeHtml(formatted)
          : '<span class="integration-placeholder">' + AWAITING_UTM_DATA + '</span>';
      }

      function campaignValue(call) {
        if (!call) return "";
        const category = String(call.category || "").trim();
        const subCategory = String(call.subCategory || "").trim();

        if (category === "NLP Practitioner" || subCategory === "NLP Practitioner") return "NLP Practitioner";
        if (category === "RoomMates" || subCategory === "RoomMates") return "RoomMates";
        if (category === "Self-Development Pathway" || subCategory === "Self-Development Pathway") return "Self-Development Pathway";
        if (category === "Coach Training Pathway" || subCategory === "Coach Training Pathway") return "Coach Training Pathway";
        if (category === "Executive Pathway" || subCategory === "Executive Pathway") return "Executive Pathway";

        return "";
      }

      function updateMarketingCampaignPerformance() {
        const counts = new Map();

        dashboardCalls().forEach(call => {
          const campaign = campaignValue(call);
          const source = formatSource(rawSourceValue(call));
          const sourceKey = SOURCE_LABELS[normaliseSource(source)];

          if (!campaign || !sourceKey) return;
          const key = campaign + "|" + sourceKey;
          counts.set(key, (counts.get(key) || 0) + 1);
        });

        document.querySelectorAll("[data-call-bookings-cell]").forEach(cell => {
          const campaign = cell.getAttribute("data-campaign") || "";
          const source = cell.getAttribute("data-source") || "";
          const value = counts.get(campaign + "|" + source) || 0;
          cell.textContent = String(value);
        });
      }

      function updateCalendlySourceColumn() {
        const body = document.getElementById("callsTable");
        if (!body) return;
        ensureSourceHeader();

        const calls = dashboardCalls();

        Array.from(body.querySelectorAll("tr")).forEach((row, index) => {
          let sourceCell = row.querySelector("td[data-source-cell]");
          if (!sourceCell) {
            sourceCell = document.createElement("td");
            sourceCell.setAttribute("data-source-cell", "true");
            row.appendChild(sourceCell);
          }

          const nextHtml = renderSource(rawSourceValue(calls[index]));
          if (sourceCell.innerHTML !== nextHtml) sourceCell.innerHTML = nextHtml;
        });
      }

      function updateDashboardSourceViews() {
        updateCalendlySourceColumn();
        updateMarketingCampaignPerformance();
      }

      function initSourceColumnObserver() {
        const body = document.getElementById("callsTable");
        if (!body || body.dataset.sourceObserverReady === "true") return;
        body.dataset.sourceObserverReady = "true";
        new MutationObserver(updateCalendlySourceColumn).observe(body, { childList: true });
        ensureSourceHeader();
        updateDashboardSourceViews();
      }

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initSourceColumnObserver);
      } else {
        initSourceColumnObserver();
      }
    })();
`;
const PATHWAYS_REVENUE_AMOUNT = "$85,335.10";
const SELF_DEVELOPMENT_PATHWAYS_SOLD = "6";
const EXECUTIVE_SUPPORT_PATHWAYS_SOLD = "2";

function applyPathwaysValueOverrides(html) {
  return html
    .replace(
      /(<h3>Revenue Attributed to Pathways<\/h3>[\s\S]*?<tbody><tr><td>)([^<]+)(<\/td><\/tr><\/tbody>)/,
      (_match, start, _value, end) => `${start}${PATHWAYS_REVENUE_AMOUNT}${end}`
    )
    .replace(
      /(<tr><td>Self-Development<\/td><td>)([^<]+)(<\/td><\/tr>)/,
      (_match, start, _value, end) => `${start}${SELF_DEVELOPMENT_PATHWAYS_SOLD}${end}`
    )
    .replace(
      /(<tr><td>Executive Support<\/td><td>)([^<]+)(<\/td><\/tr>)/,
      (_match, start, _value, end) => `${start}${EXECUTIVE_SUPPORT_PATHWAYS_SOLD}${end}`
    );
}

const htmlResponse = (body, response) => {
  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default async (_request, context) => {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("text/html")) {
    return response;
  }

  const html = await response.text();
  let nextHtml = applyPathwaysValueOverrides(html);

  const salesPipelineMarker = `      <details class="accordion-panel">
        <summary><span class="accordion-title">Sales Pipeline</span><span class="accordion-icon" aria-hidden="true"></span></summary>`;

  if (!nextHtml.includes("Marketing Campaigns") && nextHtml.includes(salesPipelineMarker)) {
    nextHtml = nextHtml.replace(
      salesPipelineMarker,
      `${MARKETING_CAMPAIGNS_SECTION}\n\n${salesPipelineMarker}`
    );
  }

  if (!nextHtml.includes("count-breakdown-subrow")) {
    nextHtml = nextHtml.replace("  </style>", `${EXECUTIVE_SUPPORT_BREAKDOWN_STYLES}\n  </style>`);
  }

  if (!nextHtml.includes("EXECUTIVE_SUPPORT_CATEGORY")) {
    nextHtml = nextHtml.replace("    loadDashboard();", `${EXECUTIVE_SUPPORT_BREAKDOWN_SCRIPT}\n    loadDashboard();`);
  }

  if (!nextHtml.includes("__tcrDashboardData")) {
    nextHtml = nextHtml.replace("    loadDashboard();", `${CALENDLY_SOURCE_COLUMN_SCRIPT}\n    loadDashboard();`);
  }

  return htmlResponse(nextHtml, response);
};
