const ANALYTICS_VERSIONS = Object.freeze({
  questionnaire_version: 'questionnaire_v1',
  prompt_version: 'prompt_v1',
  report_methodology_version: 'methodology_v1'
});

const GENERATION_META = Object.freeze({
  model_provider: 'google',
  model: 'gemini-3.6-flash'
});

const ALLOWED_EVENTS = new Set([
  'landing_viewed',
  'questionnaire_started',
  'questionnaire_progress',
  'questionnaire_completed',
  'report_generation_started',
  'report_generation_succeeded',
  'report_generation_failed',
  'report_viewed',
  'feedback_started'
]);

const COMMON_PROPERTY_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'referrer_category',
  'device_category'
]);

const EVENT_PROPERTY_KEYS = Object.freeze({
  landing_viewed: new Set([]),
  questionnaire_started: new Set([]),
  questionnaire_progress: new Set([
    'milestone',
    'elapsed_seconds'
  ]),
  questionnaire_completed: new Set([
    'total_completion_seconds',
    'questions_answered_count'
  ]),
  report_generation_started: new Set([
    'generation_attempt_number'
  ]),
  report_generation_succeeded: new Set([
    'generation_attempt_number',
    'generation_duration_ms',
    'application_http_status'
  ]),
  report_generation_failed: new Set([
    'generation_attempt_number',
    'generation_duration_ms',
    'application_http_status',
    'error_category',
    'generation_stage'
  ]),
  report_viewed: new Set([
    'generation_to_view_ms'
  ]),
  feedback_started: new Set([])
});

const ENUMS = Object.freeze({
  referrer_category: new Set([
    'direct',
    'linkedin',
    'reddit',
    'search',
    'internal',
    'other'
  ]),
  device_category: new Set([
    'mobile',
    'tablet',
    'desktop',
    'unknown'
  ]),
  error_category: new Set([
    'application_rate_limit',
    'provider_rate_limit',
    'provider_unavailable',
    'provider_timeout',
    'invalid_structured_output',
    'empty_provider_response',
    'configuration_error',
    'invalid_request',
    'network_error',
    'server_error',
    'unknown_generation_error'
  ]),
  generation_stage: new Set([
    'submission',
    'provider_request',
    'response_validation',
    'network',
    'unknown'
  ])
});

function analyticsEnabled() {
  return (
    process.env.VERCEL_ENV === 'production' &&
    typeof process.env.POSTHOG_PROJECT_TOKEN === 'string' &&
    process.env.POSTHOG_PROJECT_TOKEN.trim().length > 0
  );
}

function safeId(value) {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  return /^[A-Za-z0-9_-]{8,128}$/.test(trimmed)
    ? trimmed
    : null;
}

function safeToken(value, maxLength = 80) {
  if (typeof value !== 'string') return undefined;

  const cleaned = value
    .trim()
    .slice(0, maxLength)
    .replace(/[^A-Za-z0-9._~-]/g, '_');

  return cleaned || undefined;
}

function safeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);

  if (!Number.isFinite(number)) return undefined;

  return Math.min(max, Math.max(min, number));
}

function sanitizeProperty(key, value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (key.startsWith('utm_')) {
    return safeToken(value);
  }

  if (ENUMS[key]) {
    return typeof value === 'string' && ENUMS[key].has(value)
      ? value
      : undefined;
  }

  switch (key) {
    case 'milestone': {
      const milestone = safeNumber(value, { min: 0, max: 100 });
      return [25, 50, 75, 100].includes(milestone)
        ? milestone
        : undefined;
    }

    case 'elapsed_seconds':
    case 'total_completion_seconds':
      return safeNumber(value, { min: 0, max: 86400 });

    case 'questions_answered_count':
      return safeNumber(value, { min: 0, max: 18 });

    case 'generation_attempt_number':
      return safeNumber(value, { min: 1, max: 20 });

    case 'generation_duration_ms':
    case 'generation_to_view_ms':
      return safeNumber(value, { min: 0, max: 600000 });

    case 'application_http_status':
      return safeNumber(value, { min: 100, max: 599 });

    default:
      return undefined;
  }
}

function sanitizeProperties(event, input) {
  const clean = {};
  const eventKeys = EVENT_PROPERTY_KEYS[event] || new Set();

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return clean;
  }

  Object.entries(input).forEach(([key, value]) => {
    if (!COMMON_PROPERTY_KEYS.has(key) && !eventKeys.has(key)) {
      return;
    }

    const sanitized = sanitizeProperty(key, value);

    if (sanitized !== undefined) {
      clean[key] = sanitized;
    }
  });

  return clean;
}

function getPostHogHost() {
  const rawHost = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';

  try {
    const parsed = new URL(rawHost);

    if (parsed.protocol !== 'https:') {
      return 'https://us.i.posthog.com';
    }

    return parsed.origin;
  } catch {
    return 'https://us.i.posthog.com';
  }
}

export async function captureAnalyticsEvent({
  event,
  distinctId,
  sessionId,
  properties = {}
}) {
  if (!analyticsEnabled() || !ALLOWED_EVENTS.has(event)) {
    return false;
  }

  const safeDistinctId = safeId(distinctId);
  const safeSessionId = safeId(sessionId);

  if (!safeDistinctId || !safeSessionId) {
    return false;
  }

  const eventProperties = {
    ...ANALYTICS_VERSIONS,
    app_version:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
      'production_unknown',
    environment: 'production',
    anonymous_session_id: safeSessionId,
    ...sanitizeProperties(event, properties),
    $process_person_profile: false
  };

  if (
    event === 'report_generation_started' ||
    event === 'report_generation_succeeded' ||
    event === 'report_generation_failed'
  ) {
    Object.assign(eventProperties, GENERATION_META);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(
      `${getPostHogHost()}/i/v0/e/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: process.env.POSTHOG_PROJECT_TOKEN,
          distinct_id: safeDistinctId,
          event,
          properties: eventProperties
        }),
        signal: controller.signal
      }
    );

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export const ANALYTICS_EVENT_NAMES = Object.freeze(
  Array.from(ALLOWED_EVENTS)
);
