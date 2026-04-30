const { getStore } = require("@netlify/blobs");

function hasValidTestSecret(event) {
  const secret = process.env.KAJABI_TEST_SECRET;
  if (!secret) return false;

  const params = new URLSearchParams(event.rawQuery || "");
  const headers = event.headers || {};
  const supplied = params.get("secret") || headers["x-test-secret"] || headers["X-Test-Secret"];
  return supplied === secret;
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

exports.handler = async (event) => {
  if (!hasValidTestSecret(event)) {
    return {
      statusCode: 403,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: false, error: "Set KAJABI_TEST_SECRET and pass it as ?secret=... or x-test-secret to create a test purchase" }),
    };
  }

  const store = getKajabiPurchaseStore();

  const purchase = {
    id: `test-${Date.now()}`,
    product: "NLP Practitioner",
    rawProduct: "NLP Practitioner Test Purchase",
    amount: 100,
    email: "test@example.com",
    name: "Test Purchase",
    date: new Date().toISOString().slice(0, 10),
    receivedAt: new Date().toISOString(),
    raw: { test: true },
  };

  await store.setJSON(purchase.id, purchase);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, purchase }),
  };
};
