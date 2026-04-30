# TCR Netlify Live Dashboard

Upload this whole folder/ZIP to Netlify.

It includes:
- `index.html`
- Netlify function: `dashboard-data`
- Netlify function: `kajabi-webhook`
- Redirects:
  - `/api/dashboard-data`
  - `/api/kajabi-webhook`

## Step after deploying

Open:

```txt
https://comforting-cajeta-2d6136.netlify.app/api/dashboard-data
```

You should see JSON.

## Environment variables needed in Netlify

Add these later:

```txt
CALENDLY_API_KEY=
HUBSPOT_ACCESS_TOKEN=
GA4_PROPERTY_ID=339892084
GOOGLE_SERVICE_ACCOUNT_ACCESS_TOKEN=
```

Kajabi webhook URL:

```txt
https://comforting-cajeta-2d6136.netlify.app/api/kajabi-webhook
```

## Important

GA4 live connection needs a Google access token/service account process. If not configured, dashboard still works with mock fallback.
Kajabi webhook receives purchases but does not persist them yet. Next step is storage.
