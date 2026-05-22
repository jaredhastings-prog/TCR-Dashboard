const MARKETING_CAMPAIGNS_SECTION = `      <details class="accordion-panel">
        <summary><span class="accordion-title">Marketing Campaigns</span><span class="accordion-icon" aria-hidden="true"></span></summary>
        <div class="accordion-content">
          <section class="grid-3">
            <div class="card">
              <h3>Email Campaigns</h3>
              <div class="table-scroll wide-table">
                <table>
                  <thead><tr><th>Campaign</th><th>Sent</th><th>Open Rate</th><th>Clicks</th><th>Calendly Clicks</th><th>Calls Booked</th><th>Deals Won</th></tr></thead>
                  <tbody><tr><td colspan="7"><span class="integration-placeholder">Awaiting Integration</span></td></tr></tbody>
                </table>
              </div>
            </div>
            <div class="card">
              <h3>Paid Social Campaigns</h3>
              <div class="table-scroll wide-table">
                <table>
                  <thead><tr><th>Campaign</th><th>Spend</th><th>Clicks</th><th>Landing Page Views</th><th>Calendly Clicks</th><th>Calls Booked</th><th>Cost Per Call</th></tr></thead>
                  <tbody><tr><td colspan="7"><span class="integration-placeholder">Awaiting Integration</span></td></tr></tbody>
                </table>
              </div>
            </div>
            <div class="card">
              <h3>Organic Social</h3>
              <div class="table-scroll">
                <table>
                  <thead><tr><th>Platform</th><th>Post / Topic</th><th>Reach</th><th>Clicks</th><th>Calls Generated</th></tr></thead>
                  <tbody><tr><td colspan="5"><span class="integration-placeholder">Awaiting Integration</span></td></tr></tbody>
                </table>
              </div>
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

const PATHWAYS_REVENUE_AMOUNT = "$79,535.10";
const EXECUTIVE_SUPPORT_PATHWAYS_SOLD = "2";

function applyPathwaysValueOverrides(html) {
  return html
    .replace(
      /(<h3>Revenue Attributed to Pathways<\/h3>[\s\S]*?<tbody><tr><td>)([^<]+)(<\/td><\/tr><\/tbody>)/,
      (_match, start, _value, end) => `${start}${PATHWAYS_REVENUE_AMOUNT}${end}`
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

  return htmlResponse(nextHtml, response);
};
