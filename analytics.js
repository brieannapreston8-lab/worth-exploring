(() => {
  'use strict';

  const ANALYTICS_ENDPOINT = '/api/analytics';
  const VISITOR_STORAGE_KEY = 'worth_exploring_analytics_visitor';
  const SESSION_STORAGE_KEY = 'worth_exploring_analytics_session';
  const ACQUISITION_STORAGE_KEY = 'worth_exploring_analytics_acquisition';
  const VISITOR_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const REQUIRED_STEP_COUNT = 15;
  const PROGRESS_MILESTONES = [25, 50, 75, 100];

  const nativeFetch = window.fetch.bind(window);
  const trackingAllowed = navigator.doNotTrack !== '1';

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
    if (!trackingAllowed) return;

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

    try {
      nativeFetch(ANALYTICS_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(() => {});
    } catch {
      // Analytics must never affect the product experience.
    }
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

  function countAnsweredQuestions() {
    try {
      return Object.values(answers).filter(value => {
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'string') return value.trim().length > 0;
        return value !== undefined && value !== null;
      }).length;
    } catch {
      return 0;
    }
  }

  function fireProgressForCompletedSteps(completedRequiredSteps) {
    const percent = Math.min(
      100,
      (completedRequiredSteps / REQUIRED_STEP_COUNT) * 100
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

  function errorCategoryFrom(status, message) {
    const text = String(message || '').toLowerCase();

    if (status === 429) return 'application_rate_limit';

    if (
      text.includes('resource_exhausted') ||
      text.includes('rate limit') ||
      text.includes('429')
    ) {
      return 'provider_rate_limit';
    }

    if (
      text.includes('unavailable') ||
      text.includes('503')
    ) {
      return 'provider_unavailable';
    }

    if (
      text.includes('timeout') ||
      text.includes('timed out') ||
      text.includes('aborted')
    ) {
      return 'provider_timeout';
    }

    if (
      text.includes('unexpected token') ||
      text.includes('json') ||
      text.includes('structured output')
    ) {
      return 'invalid_structured_output';
    }

    if (text.includes('empty response')) {
      return 'empty_provider_response';
    }

    if (text.includes('api key not configured')) {
      return 'configuration_error';
    }

    if (status === 400 || status === 405) {
      return 'invalid_request';
    }

    if (status >= 500) return 'server_error';

    return 'unknown_generation_error';
  }

  function generationStageFor(errorCategory) {
    if (errorCategory === 'invalid_request') return 'submission';
    if (errorCategory === 'network_error') return 'network';

    if (
      errorCategory === 'invalid_structured_output' ||
      errorCategory === 'empty_provider_response'
    ) {
      return 'response_validation';
    }

    if (
      errorCategory === 'provider_rate_limit' ||
      errorCategory === 'provider_unavailable' ||
      errorCategory === 'provider_timeout'
    ) {
      return 'provider_request';
    }

    return 'unknown';
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

    const fetchStartAt = performance.now();

    try {
      const response = await nativeFetch(input, init);
      const duration = elapsedMilliseconds(fetchStartAt);
      let responseData = null;

      try {
        responseData = await response.clone().json();
      } catch {
        responseData = null;
      }

      if (response.ok && isUsableReport(responseData)) {
        capture('report_generation_succeeded', {
          generation_attempt_number:
            Math.max(1, state.generationAttemptNumber),
          generation_duration_ms: duration,
          application_http_status: response.status
        });
      } else {
        const category = response.ok
          ? 'invalid_structured_output'
          : errorCategoryFrom(
              response.status,
              responseData?.error
            );

        capture('report_generation_failed', {
          generation_attempt_number:
            Math.max(1, state.generationAttemptNumber),
          generation_duration_ms: duration,
          application_http_status: response.status,
          error_category: category,
          generation_stage: generationStageFor(category)
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

  const originalStartAssessment = window.startAssessment;

  if (typeof originalStartAssessment === 'function') {
    window.startAssessment = function trackedStartAssessment(...args) {
      const assessment = document.getElementById('view-assessment');
      const wasHidden = assessment?.classList.contains('hidden');
      const result = originalStartAssessment.apply(this, args);
      const isVisible = assessment && !assessment.classList.contains('hidden');

      if (wasHidden && isVisible && !state.started) {
        state.started = true;
        state.questionnaireStartAt = performance.now();
        capture('questionnaire_started');
      }

      return result;
    };
  }

  const originalNextQuestion = window.nextQuestion;

  if (typeof originalNextQuestion === 'function') {
    window.nextQuestion = function trackedNextQuestion(...args) {
      let beforeIndex = 0;
      let totalSteps = 16;

      try {
        beforeIndex = currentIdx;
        totalSteps = STEPS.length;
      } catch {
        // Use safe defaults if questionnaire internals ever change.
      }

      const isFinalStep = beforeIndex === totalSteps - 1;

      if (isFinalStep && state.started) {
        if (!state.questionnaireCompleted) {
          state.questionnaireCompleted = true;

          capture('questionnaire_completed', {
            total_completion_seconds:
              elapsedSeconds(state.questionnaireStartAt),
            questions_answered_count:
              countAnsweredQuestions()
          });
        }

        state.generationAttemptNumber += 1;
        state.generationStartAt = performance.now();

        capture('report_generation_started', {
          generation_attempt_number:
            state.generationAttemptNumber
        });
      }

      const result = originalNextQuestion.apply(this, args);

      try {
        if (currentIdx > beforeIndex) {
          const completedRequiredSteps = Math.min(
            currentIdx,
            REQUIRED_STEP_COUNT
          );

          fireProgressForCompletedSteps(completedRequiredSteps);
        }
      } catch {
        // Analytics must not interfere with navigation.
      }

      return result;
    };
  }

  const originalRenderResults = window.renderResults;

  if (typeof originalRenderResults === 'function') {
    window.renderResults = function trackedRenderResults(...args) {
      const result = originalRenderResults.apply(this, args);

      if (!state.reportViewed) {
        state.reportViewed = true;

        requestAnimationFrame(() => {
          const report = document.getElementById('view-result');

          if (report && !report.classList.contains('hidden')) {
            capture('report_viewed', {
              generation_to_view_ms:
                elapsedMilliseconds(state.generationStartAt)
            });
          }
        });
      }

      return result;
    };
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
