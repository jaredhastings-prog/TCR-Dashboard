// Setup endpoint for Calendly webhook registration.
// Pass ?secret=YOUR_SETUP_SECRET to authenticate.
// Pass ?reset=true to delete the existing webhook and re-register it.

const CALENDLY_API_BASE = "https://api.calendly.com";
const SITE_URL = "https://comforting-cajeta-2d6136.netlify.app";
// Use the direct function URL to bypass the redirect and edge function
const WEBHOOK_URL = `${SITE_URL}/.netlify/functions/calendly-webhook`;

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const setupSecret = process.env.SETUP_SECRET;
  if (setupSecret && event.queryStringParameters?.secret !== setupSecret) {
    return { statusCode: 403, body: "Forbidden — pass ?secret=YOUR_SETUP_SECRET" };
  }

  const calendlyKey = process.env.CALENDLY_API_KEY;
  if (!calendlyKey) {
    return { statusCode: 500, body: "CALENDLY_API_KEY not configured" };
  }

  const reset = event.queryStringParameters?.reset === "true";

  // Step 1: Get org URI
  const meRes = await fetch(`${CALENDLY_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${calendlyKey}` },
  });
  if (!meRes.ok) {
    return { statusCode: 502, body: `Calendly /users/me failed: ${await meRes.text()}` };
  }
  const me = await meRes.json();
  const orgUri = me.resource?.current_organization;

  if (!orgUri) {
    return { statusCode: 502, body: "Could not determine Calendly organisation URI" };
  }

  // Step 2: List existing webhook subscriptions
  const listRes = await fetch(
    `${CALENDLY_API_BASE}/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&scope=organization`,
    { headers: { Authorization: `Bearer ${calendlyKey}` } }
  );
  const listData = listRes.ok ? await listRes.json() : { collection: [] };
  const existing = (listData.collection || []).find(
    w => w.callback_url === WEBHOOK_URL || w.callback_url.includes("calendly-webhook")
  );

  // Step 3: Delete existing webhook if reset requested
  if (existing && reset) {
    const delRes = await fetch(existing.uri, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${calendlyKey}` },
    });
    if (!delRes.ok && delRes.status !== 404) {
      return { statusCode: 502, body: `Failed to delete existing webhook: ${await delRes.text()}` };
    }
    console.log(`Deleted existing webhook: ${existing.uri}`);
  } else if (existing && !reset) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "already_registered",
        webhook_url: existing.callback_url,
        calendly_webhook_uri: existing.uri,
        state: existing.state,
        message: "Webhook already registered. To delete and re-register, add ?reset=true to the URL.",
      }, null, 2),
    };
  }

  // Step 4: Register the webhook — organisation scope only, no user field
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
      scope: "organization",
    }),
  });

  const createData = await createRes.json();

  if (!createRes.ok) {
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Webhook registration failed", details: createData }, null, 2),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "registered",
      webhook_url: WEBHOOK_URL,
      calendly_webhook_uri: createData.resource?.uri,
      signing_key: createData.resource?.signing_key || null,
    }, null, 2),
  };
};
