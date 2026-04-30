const { randomUUID } = require("crypto");
const { getStore } = require("@netlify/blobs");
const { normaliseProduct } = require("./_shared");

function pick(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function normaliseKajabiPurchase(body) {
  const productRaw = pick(
    body.offer_title,
    body.offer && body.offer.title,
    body.product_title,
    body.product && body.product.title,
    body.title,
    body.name,
    body.payload && body.payload.offer_title,
    body.payload && body.payload.product_title
  );

  const amountRaw = pick(
    body.total_price,
    body.total,
    body.amount,
    body.price,
    body.purchase_amount,
    body.payload && body.payload.total_price,
    body.payload && body.payload.amount
  );

  const email = pick(
    body.email,
    body.customer_email,
    body.member_email,
    body.customer && body.customer.email,
    body.member && body.member.email,
    body.payload && body.payload.email,
    body.payload && body.payload.customer_email
  );

  const name = pick(
    body.name,
    body.customer_name,
    body.member_name,
    body.customer && body.customer.name,
    body.member && body.member.name,
    body.payload && body.payload.name
  );

  const rawId = pick(
    body.id,
    body.purchase_id,
    body.order_id,
    body.transaction_id,
    body.payload && body.payload.id,
    body.payload && body.payload.purchase_id
  );

  const date = pick(
    body.created_at,
    body.purchased_at,
    body.completed_at,
    body.order_created_at,
    body.payload && body.payload.created_at,
    new Date().toISOString()
  );

  return {
    id: String(rawId || randomUUID()),
    product: normaliseProduct(productRaw),
    rawProduct: productRaw || "Unknown",
    amount: Number(String(amountRaw || 0).replace(/[^0-9.-]/g, "")) || 0,
    email: email || null,
    name: name || null,
    date: String(date).slice(0, 10),
    receivedAt: new Date().toISOString(),
    raw: body,
  };
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
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method not allowed" };
  try {
    const body = JSON.parse(event.body || "{}");
    const purchase = normaliseKajabiPurchase(body);

    const store = getKajabiPurchaseStore();
    await store.setJSON(purchase.id, purchase);

    console.log("Kajabi purchase stored:", JSON.stringify({
      id: purchase.id,
      product: purchase.product,
      amount: purchase.amount,
      date: purchase.date,
    }));

    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true, stored: true, purchase }) };
  } catch (err) {
    console.error("Kajabi webhook error:", err);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: false, error: err.message }) };
  }
};
