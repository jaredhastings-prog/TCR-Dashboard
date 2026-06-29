exports.handler = async () => {
  const value = process.env.CALENDLY_API_KEY || "";
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      calendlyKeyExists: Boolean(value),
      calendlyKeyLength: value.length,
      calendlyKeyStartsWith: value ? value.slice(0, 10) : null,
      availableDashboardEnvKeys: Object.keys(process.env).filter(k => k.includes("CALENDLY") || k.includes("HUBSPOT") || k.includes("GA4") || k.includes("GOOGLE") || k.includes("KAJABI") || k.includes("NETLIFY"))
    })
  };
};
