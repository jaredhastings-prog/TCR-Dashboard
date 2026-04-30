const { slugFrom, mapCalendlySlug } = require("./_shared");

exports.handler = async () => {
  const token = process.env.CALENDLY_API_KEY || "";
  if (!token) return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: "No CALENDLY_API_KEY found" }) };
  try {
    const meRes = await fetch("https://api.calendly.com/users/me", { headers: { Authorization: `Bearer ${token}` } });
    const meJson = await meRes.json();
    const userUri = meJson && meJson.resource && meJson.resource.uri ? meJson.resource.uri : null;
    const orgValue = meJson && meJson.resource ? meJson.resource.current_organization : null;
    const organizationUri = typeof orgValue === "string" ? orgValue : orgValue && orgValue.uri ? orgValue.uri : null;

    async function probe(scope) {
      function addCount(map, value) {
        const key = value || "Unknown";
        map[key] = (map[key] || 0) + 1;
      }

      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
      const params = new URLSearchParams({
        ...scope,
        status: "active",
        count: "100",
        min_start_time: start,
        max_start_time: end,
        sort: "start_time:asc",
      });
      const res = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      let count = null;
      let allowedEventCalls = null;
      let excludedCurrentMonthEvents = null;
      const allowedEventNames = {};
      const excludedEventNames = {};
      if (res.ok) {
        const json = await res.json();
        const events = Array.isArray(json.collection) ? json.collection : [];
        count = events.length;
        allowedEventCalls = 0;
        excludedCurrentMonthEvents = 0;

        for (const event of events) {
          const eventName = event.name || "Calendly Event";
          const mapping = mapCalendlySlug(slugFrom(eventName));
          if (mapping) {
            allowedEventCalls += 1;
            addCount(allowedEventNames, eventName);
          } else {
            excludedCurrentMonthEvents += 1;
            addCount(excludedEventNames, eventName);
          }
        }
      }
      return {
        status: res.status,
        currentMonthEventsVisible: count,
        allowedEventCalls,
        excludedCurrentMonthEvents,
        allowedEventNames,
        excludedEventNames,
      };
    }

    let userEvents = null;
    let organizationEvents = null;
    if (userUri) {
      userEvents = await probe({ user: userUri });
    }
    if (organizationUri) {
      organizationEvents = await probe({ organization: organizationUri });
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: true,
        usersMeStatus: meRes.status,
        userUri,
        userName: meJson?.resource?.name || null,
        organizationUri,
        userEvents,
        organizationEvents,
      })
    };
  } catch (err) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
