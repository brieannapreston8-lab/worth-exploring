import { captureAnalyticsEvent } from './_analytics.js';

function parseBody(req) {
  if (!req.body) return {};

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return req.body;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  // Analytics must never become a dependency of the product experience.
  // Invalid, disabled, preview, or failed analytics requests are intentionally
  // acknowledged without exposing implementation details to the browser.
  if (req.method !== 'POST') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const body = parseBody(req);

    await captureAnalyticsEvent({
      event: body?.event,
      distinctId: body?.distinct_id,
      sessionId: body?.session_id,
      properties: body?.properties
    });
  } catch {
    // Intentionally ignored. Product analytics are observational only.
  }

  res.statusCode = 204;
  return res.end();
}
