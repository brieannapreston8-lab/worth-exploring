(() => {
  'use strict';

  const ANALYTICS_ENDPOINT = '/api/analytics';
  const VISITOR_STORAGE_KEY = 'worth_exploring_analytics_visitor';
  const SESSION_STORAGE_KEY = 'worth_exploring_analytics_session';
  const ACQUISITION_STORAGE_KEY = 'worth_exploring_analytics_acquisition';
  const VISITOR_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const REQUIRED_STEP_COUNT = 15;
  const PROGRESS_MILESTONES = [25, 50, 75, 100];
  const SAFE_ERROR_CATEGORIES = new Set([
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
  ]);
  const SAFE_GENERATION_STAGES = new Set([
    'submission',
    'provider_request',
    'response_validation',
    'network',
    'unknown'
  ]);

  const nativeFetch = window.fetch.bind(window);
  const trackingAllowed = navigator.doNotTrack !== '1';
  let captureQueue = Promise.resolve();

  const state = {
    started: false,
    questionnaireStartAt: null,
    firedMilestones: new Set(),
    questionnaireCompleted: false,
    generationAttemptNumber: 0,
    generationStartAt: null,
    reportViewed: false,
    feedbackStarted: false
  };

  function randomId() {
    if (window.crypto?.randomUUID) {
      return window.crypto.randomUUID();
    }

    return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
  }

  function getVisitorId() {
    const fallback = randomId();

    if (!trackingAllowed) return fallback;

    try {
      const stored = JSON.parse(
        localStorage.getItem(VISITOR_STORAGE_KEY) || 'null'
      );

      if (
        stored?.id &&
        stored?.created_at &&
        Date.now() - Number(stored.created_at) < VISITOR_TTL_MS
      ) {
        return stored.id;
      }

      const next = {
        id: fallback,
        created_at: Date.now()
      };

      localStorage.setItem(
        VISITOR_STORAGE_KEY,
        JSON.stringify(next)
      );

      return next.id;
    } catch {
      return fallback;
    }
  }

  function getSessionId() {
    const fallback = randomId();

    if (!trackingAllowed) return fallback;

    try {
      const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);

      if (existing) return existing;

      sessionStorage.setItem(SESSION_STORAGE_KEY, fallback);
      return fallback;
    } catch {
      return fallback;
    }
  }

  function safeToken(value, maxLength = 80) {
    if (typeof value !== 'string') return undefined;

    const cleaned = value
      .trim()
      .slice(0, maxLength)
      .replace(/[^A-Za-z0-9._~-]/g, '_');

    return cleaned || undefined;
  }

  function getReferrerCategory() {
    if (!document.referrer) return 'direct';

    try {
      const referrerHost = new URL(document.referrer).hostname.toLowerCase();
      const currentHost = window.location.hostname.toLowerCase();

      if (referrerHost === currentHost) return 'internal';
      if (referrerHost.includes('linkedin.')) return 'linkedin';
      if (referrerHost.includes('reddit.')) return 'reddit';

      if (
        referrerHost.includes('google.') ||
        referrerHost.includes('bing.') ||
        referrerHost.includes('duckduckgo.') ||
        referrerHost.includes('yahoo.')
      ) {
        return 'search';
      }

      return 'other';
    } catch {
      return 'other';
    }
  }

  function getDeviceCategory() {
    const width = window.innerWidth || 0;

    if (!width) return 'unknown';
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  }

  function readAcquisition() {
    const params = new URLSearchParams(window.location.search);

    const fromUrl = {
      utm_source: safeToken(params.get('utm_source')),
      utm_medium: safeToken(params.get('utm_medium')),
      utm_campaign: safeToken(params.get('utm_campaign')),
      referrer_category: getReferrerCategory()
    };

    const hasUtm =
      fromUrl.utm_source ||
      fromUrl.utm_medium ||
      fromUrl.utm_campaign;

    if (trackingAllowed) {
      try {
        if (hasUtm || !sessionStorage.getItem(ACQUISITION_STORAGE_KEY)) {
          sessionStorage.setItem(
            ACQUISITION_STORAGE_KEY,
            JSON.stringify(fromUrl)
          );
        }

        const stored = JSON.parse(
          sessionStorage.getItem(ACQUISITION_STORAGE_KEY) || '{}'
        );

        return {
          utm_source: safeToken(stored.utm_source),
          utm_medium: safeToken(stored.utm_medium),
          utm_campaign: safeToken(stored.utm_campaign),
          referrer_category:
            [
              'direct',
              'linkedin',
              'reddit',
              'search',
              'internal',
              'other'
            ].includes(stored.referrer_category)
              ? stored.referrer_category
              : fromUrl.referrer_category
        };
      } catch {
        // Fall through to the current-page acquisition values.
      }
    }

    return fromUrl;
  }

  const visitorId = getVisitorId();
  const sessionId = getSessionId();
  const acquisition = readAcquisition();

  function capture(event, properties = {}) {
    if (!trackingAllowed) return Promise.resolve();

    const payload = {
      event,
      distinct_id: visitorId,
      session_id: sessionId,
      properties: {
        ...acquisition,
        device_category: getDeviceCategory(),
        ...properties
      }
    };

    captureQueue = captureQueue
      .catch(() => {})
      .then(() =>
        nativeFetch(ANALYTICS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload),
          keepalive: true
        })
      )
      .then(() => undefined)
      .catch(() => undefined);

    return captureQueue;
  }

  function elapsedSeconds(startAt) {
    if (!startAt) return 0;

    return Math.max(
      0,
      Math.round((performance.now() - startAt) / 1000)
    );
  }

  function elapsedMilliseconds(startAt) {
    if (!startAt) return 0;

    return Math.max(
      0,
      Math.round(performance.now() - startAt)
    );
  }

  function fireProgressForCompletedSteps(completedRequiredSteps) {
    if (!state.started) return;

    const safeCompletedSteps = Math.min(
      REQUIRED_STEP_COUNT,
      Math.max(0, Number(completedRequiredSteps) || 0)
    );

    const percent = Math.min(
      100,
      (safeCompletedSteps / REQUIRED_STEP_COUNT) * 100
    );

    PROGRESS_MILESTONES.forEach(milestone => {
      if (
        percent >= milestone &&
        !state.firedMilestones.has(milestone)
      ) {
        state.firedMilestones.add(milestone);

        capture('questionnaire_progress', {
          milestone,
          elapsed_seconds: elapsedSeconds(state.questionnaireStartAt)
        });
      }
    });
  }

  function isUsableReport(value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      Array.isArray(value.patterns) &&
      Array.isArray(value.tensions) &&
      Array.isArray(value.hypotheses) &&
      Array.isArray(value.dealbreakers) &&
      Array.isArray(value.networking_compass) &&
      Array.isArray(value.thirty_day_plan)
    );
  }

  function safeHeaderValue(response, name, allowedValues) {
    const value = response.headers.get(name);

    return value && allowedValues.has(value)
      ? value
      : undefined;
  }

  function providerRetryCount(response) {
    const attempts = Number(
      response.headers.get('X-WE-Provider-Attempts')
    );

    if (!Number.isFinite(attempts)) return undefined;

    return Math.min(2, Math.max(0, attempts - 1));
  }

  function errorCategoryFromResponse(response) {
    const backendCategory = safeHeaderValue(
      response,
      'X-WE-Generation-Error',
      SAFE_ERROR_CATEGORIES
    );

    if (backendCategory) return backendCategory;
    if (response.status === 429) return 'application_rate_limit';
    if (response.status === 400 || response.status === 405) return 'invalid_request';
    if (response.status >= 500) return 'server_error';

    return 'unknown_generation_error';
  }

  function generationStageFor(response, errorCategory) {
    const backendStage = safeHeaderValue(
      response,
      'X-WE-Generation-Stage',
      SAFE_GENERATION_STAGES
    );

    if (backendStage) return backendStage;
    if (errorCategory === 'invalid_request') return 'submission';
    if (errorCategory === 'network_error') return 'network';
    return 'unknown';
  }

  function startQuestionnaireIfVisible() {
    if (state.started) return;

    const assessment = document.getElementById('view-assessment');

    if (!assessment || assessment.classList.contains('hidden')) return;

    state.started = true;
    state.questionnaireStartAt = performance.now();
    capture('questionnaire_started');
  }

  function displayedStepNumber() {
    const text = document.getElementById('question-number')?.textContent || '';
    const match = text.match(/Step\s+(\d+)\s+of\s+(\d+)/i);

    if (!match) return null;

    const step = Number(match[1]);
    return Number.isFinite(step) ? step : null;
  }

  function trackVisibleProgress() {
    if (!state.started) return;

    const assessment = document.getElementById('view-assessment');

    if (!assessment || assessment.classList.contains('hidden')) return;

    const visibleStep = displayedStepNumber();

    if (!visibleStep) return;

    // If Step 5 is visible, four required screens have been completed.
    // The final screen is optional, so entering Step 16 means all 15
    // required screens are complete and the 100% milestone may fire.
    fireProgressForCompletedSteps(visibleStep - 1);
  }

  function captureReportViewIfVisible() {
    if (state.reportViewed) return;

    const report = document.getElementById('view-result');

    if (!report || report.classList.contains('hidden')) return;

    state.reportViewed = true;

    capture('report_viewed', {
      generation_to_view_ms:
        elapsedMilliseconds(state.generationStartAt)
    });
  }

  // Intercept only the existing generation request. Analytics requests use
  // nativeFetch directly and are never intercepted here.
  window.fetch = async function trackedFetch(input, init) {
    const rawUrl =
      typeof input === 'string'
        ? input
        : input?.url;

    let isGenerationRequest = false;

    try {
      isGenerationRequest =
        new URL(rawUrl, window.location.origin).pathname === '/api/generate';
    } catch {
      isGenerationRequest = false;
    }

    if (!isGenerationRequest) {
      return nativeFetch(input, init);
    }

    if (!state.questionnaireCompleted) {
      state.questionnaireCompleted = true;

      capture('questionnaire_completed', {
        total_completion_seconds:
          elapsedSeconds(state.questionnaireStartAt)
      });
    }

    state.generationAttemptNumber += 1;
    state.generationStartAt = performance.now();

    capture('report_generation_started', {
      generation_attempt_number:
        state.generationAttemptNumber
    });

    const fetchStartAt = performance.now();

    try {
      const response = await nativeFetch(input, init);
      const duration = elapsedMilliseconds(fetchStartAt);
      const retryCount = providerRetryCount(response);
      let responseData = null;

      if (response.ok) {
        try {
          responseData = await response.clone().json();
        } catch {
          responseData = null;
        }
      }

      if (response.ok && isUsableReport(responseData)) {
        capture('report_generation_succeeded', {
          generation_attempt_number:
            Math.max(1, state.generationAttemptNumber),
          provider_retry_count: retryCount,
          generation_duration_ms: duration,
          application_http_status: response.status
        });
      } else {
        const category = response.ok
          ? 'invalid_structured_output'
          : errorCategoryFromResponse(response);

        capture('report_generation_failed', {
          generation_attempt_number:
            Math.max(1, state.generationAttemptNumber),
          provider_retry_count: retryCount,
          generation_duration_ms: duration,
          application_http_status: response.status,
          error_category: category,
          generation_stage:
            response.ok
              ? 'response_validation'
              : generationStageFor(response, category)
        });
      }

      return response;
    } catch (error) {
      capture('report_generation_failed', {
        generation_attempt_number:
          Math.max(1, state.generationAttemptNumber),
        generation_duration_ms:
          elapsedMilliseconds(fetchStartAt),
        error_category: 'network_error',
        generation_stage: 'network'
      });

      throw error;
    }
  };

  const startButton = document.querySelector(
    'button[onclick="startAssessment()"]'
  );

  if (startButton) {
    startButton.addEventListener('click', () => {
      // The existing inline handler is registered before this listener. Check
      // the resulting UI state instead of relying on its internal function.
      startQuestionnaireIfVisible();
    });
  }

  const nextButton = document.getElementById('next-btn');

  if (nextButton) {
    nextButton.addEventListener('click', () => {
      // Navigation is synchronous. Read only the displayed step number after
      // the core click handler has run; never inspect questionnaire content.
      requestAnimationFrame(trackVisibleProgress);
    });
  }

  const reportView = document.getElementById('view-result');

  if (reportView) {
    const reportObserver = new MutationObserver(() => {
      captureReportViewIfVisible();
    });

    reportObserver.observe(reportView, {
      attributes: true,
      attributeFilter: ['class']
    });
  }

  const feedbackLink = document.querySelector(
    'a[href*="forms.gle"], a[href*="docs.google.com/forms"]'
  );

  if (feedbackLink) {
    feedbackLink.addEventListener('click', () => {
      if (state.feedbackStarted) return;

      state.feedbackStarted = true;
      capture('feedback_started');
    });
  }

  capture('landing_viewed');
})();
