// One-time setup endpoint — call this once to register the Calendly webhook subscription.
// Protect with SETUP_SECRET env var: GET /api/calendly-webhook-setup?secret=YOUR_SECRET
// After running, paste the returned signing_key into Netlify env as CALENDLY_WEBHOOK_SECRET.

const CALENDLY_API_BASE = "https://api.calendly.com";
const SITE_URL = "https://comforting-cajeta-2d6136.netlify.app";
const WEBHOOK_URL = `${SITE_URL}/api/calendly-webhook`;

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Basic protection so this can't be triggered by anyone
  const setupSecret = process.env.SETUP_SECRET;
  if (setupSecret && event.queryStringParameters?.secret !== setupSecret) {
    return { statusCode: 403, body: "Forbidden — pass ?secret=YOUR_SETUP_SECRET" };
  }

  const calendlyKey = process.env.CALENDLY_API_KEY;
  if (!calendlyKey) {
    return { statusCode: 500, body: "CALENDLY_API_KEY not configured" };
  }

  // Step 1: Get current user + org URI
  const meRes = await fetch(`${CALENDLY_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${calendlyKey}` },
  });
  if (!meRes.ok) {
    const err = await meRes.text();
    return { statusCode: 502, body: `Calendly /users/me failed: ${err}` };
  }
  const me = await meRes.json();
  const orgUri = me.resource?.current_organization;
  const userUri = me.resource?.uri;

  if (!orgUri) {
    return { statusCode: 502, body: "Could not determine Calendly organisation URI" };
  }

  // Step 2: Check for existing webhook subscriptions to avoid duplicates
  const listRes = await fetch(
    `${CALENDLY_API_BASE}/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&scope=organization`,
    { headers: { Authorization: `Bearer ${calendlyKey}` } }
  );
  if (listRes.ok) {
    const listData = await listRes.json();
    const existing = (listData.collection || []).find(w => w.callback_url === WEBHOOK_URL);
    if (existing) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: "already_registered",
          webhook_url: WEBHOOK_URL,
          calendly_webhook_uri: existing.uri,
          state: existing.state,
          message: "Webhook already registered. No action taken.",
        }, null, 2),
        headers: { "Content-Type": "application/json" },
      };
    }
  }

  // Step 3: Create the webhook subscription
  const createRes = await fetch(`${CALENDLY_API_BASE}/webhook_subscriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${calendlyKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: WEBHOOK_URL,
      events: ["invitee.created", "invitee.canceled"],
      organization: orgUri,
      user: userUri,
      scope: "organization",
    }),
  });

  const createData = await createRes.json();

  if (!createRes.ok) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Webhook registration failed", details: createData }, null, 2),
      headers: { "Content-Type": "application/json" },
    };
  }

  const signingKey = createData.resource?.signing_key;

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: "registered",
      webhook_url: WEBHOOK_URL,
      calendly_webhook_uri: createData.resource?.uri,
      next_step: signingKey
        ? `Go to Netlify → Site configuration → Environment variables and add: CALENDLY_WEBHOOK_SECRET = ${signingKey}`
        : "No signing key returned — check Calendly dashboard to confirm registration.",
      signing_key: signingKey || null,
    }, null, 2),
    headers: { "Content-Type": "application/json" },
  };
};
