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

  if (html.includes("Marketing Campaigns")) {
    return htmlResponse(html, response);
  }

  const salesPipelineMarker = `      <details class="accordion-panel">
        <summary><span class="accordion-title">Sales Pipeline</span><span class="accordion-icon" aria-hidden="true"></span></summary>`;

  if (!html.includes(salesPipelineMarker)) {
    return htmlResponse(html, response);
  }

  const nextHtml = html.replace(
    salesPipelineMarker,
    `${MARKETING_CAMPAIGNS_SECTION}\n\n${salesPipelineMarker}`
  );

  return htmlResponse(nextHtml, response);
};
