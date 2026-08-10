import {
  handleConsultationActivity,
  handleConsultationChecklist,
  handleConsultationCompletion,
  handleConsultationDisposition,
  handleConsultationFollowUp,
  handleConsultationInbox,
  handleConsultationRecommendations,
  handleConsultationStatus,
  handleConsultationSubmission
} from './consultation-inbox-core.mjs';
import { handleProspectReportCreate, handleProspectReportRead } from './prospect-report-core.mjs';
import { handleReferralLinkCreate, handleReferralLinkRead } from './referral-link-core.mjs';
import { handleReferralEvent } from './referral-event-core.mjs';
import { handleSmsSimulator } from './sms-conversation-core.mjs';
import { handleSmsHandoffRead } from './sms-handoff-core.mjs';
import { handleRingCentralStatus, handleRingCentralSubscription, handleRingCentralWebhook } from './ringcentral-sms-connection-core.mjs';
import { handleSmsProducerHandoff } from './sms-producer-handoff-core.mjs';
import { handleSmsOperations } from './sms-operations-core.mjs';
import { createConsultationStore, createProspectReportStore, createReferralLinkStore, createReferralEventStore, createSmsConversationStore, createSmsHandoffStore } from './d1-json-store.mjs';
import { withD1RateLimit } from './cloudflare-rate-limit.mjs';

function consultationOptions(context) {
  return {
    store: context.env?.COVERAGEFIT_DB ? createConsultationStore(context.env.COVERAGEFIT_DB) : null,
    env: context.env || {},
    waitUntil: typeof context.waitUntil === 'function' ? context.waitUntil.bind(context) : null
  };
}

function reportOptions(context) {
  return {
    store: context.env?.COVERAGEFIT_DB ? createProspectReportStore(context.env.COVERAGEFIT_DB) : null,
    operationsStore: context.env?.COVERAGEFIT_DB ? createSmsConversationStore(context.env.COVERAGEFIT_DB) : null,
    env: context.env || {}
  };
}


function smsOptions(context) {
  return {
    store: context.env?.COVERAGEFIT_DB ? createSmsConversationStore(context.env.COVERAGEFIT_DB) : null,
    handoffStore: context.env?.COVERAGEFIT_DB ? createSmsHandoffStore(context.env.COVERAGEFIT_DB) : null,
    env: context.env || {},
    waitUntil: typeof context.waitUntil === 'function' ? context.waitUntil.bind(context) : null
  };
}

function referralOptions(context) {
  const db = context.env?.COVERAGEFIT_DB;
  return {
    referralStore: db ? createReferralLinkStore(db) : null,
    eventStore: db ? createReferralEventStore(db) : null,
    reportStore: db ? createProspectReportStore(db) : null,
    env: context.env || {}
  };
}

export function consultationSubmit(context) {
  return withD1RateLimit(context, { route: 'consultation-submit', limit: 12, windowSeconds: 60 }, () =>
    handleConsultationSubmission(context.request, consultationOptions(context))
  );
}

export function consultationInbox(context) {
  return withD1RateLimit(context, { route: 'consultation-inbox', limit: 60, windowSeconds: 60 }, () =>
    handleConsultationInbox(context.request, consultationOptions(context))
  );
}

export function consultationStatus(context) {
  return withD1RateLimit(context, { route: 'consultation-status', limit: 120, windowSeconds: 60 }, () =>
    handleConsultationStatus(context.request, consultationOptions(context))
  );
}

export function consultationFollowUp(context) {
  return withD1RateLimit(context, { route: 'consultation-follow-up', limit: 120, windowSeconds: 60 }, () =>
    handleConsultationFollowUp(context.request, consultationOptions(context))
  );
}

export function consultationActivity(context) {
  return withD1RateLimit(context, { route: 'consultation-activity', limit: 180, windowSeconds: 60 }, () =>
    handleConsultationActivity(context.request, consultationOptions(context))
  );
}

export function consultationDisposition(context) {
  return withD1RateLimit(context, { route: 'consultation-disposition', limit: 120, windowSeconds: 60 }, () =>
    handleConsultationDisposition(context.request, consultationOptions(context))
  );
}

export function consultationRecommendations(context) {
  return withD1RateLimit(context, { route: 'consultation-recommendations', limit: 120, windowSeconds: 60 }, () =>
    handleConsultationRecommendations(context.request, consultationOptions(context))
  );
}

export function consultationCompletion(context) {
  return withD1RateLimit(context, { route: 'consultation-completion', limit: 120, windowSeconds: 60 }, () =>
    handleConsultationCompletion(context.request, consultationOptions(context))
  );
}

export function consultationChecklist(context) {
  return withD1RateLimit(context, { route: 'consultation-checklist', limit: 180, windowSeconds: 60 }, () =>
    handleConsultationChecklist(context.request, consultationOptions(context))
  );
}

export function prospectReportCreate(context) {
  return withD1RateLimit(context, { route: 'prospect-report-create', limit: 12, windowSeconds: 60 }, () =>
    handleProspectReportCreate(context.request, reportOptions(context))
  );
}

export function prospectReportRead(context) {
  return withD1RateLimit(context, { route: 'prospect-report-read', limit: 120, windowSeconds: 60 }, () =>
    handleProspectReportRead(context.request, reportOptions(context))
  );
}


export function referralLinkCreate(context) {
  return withD1RateLimit(context, { route: 'referral-link-create', limit: 30, windowSeconds: 60 }, () =>
    handleReferralLinkCreate(context.request, referralOptions(context))
  );
}

export function referralLinkRead(context) {
  return withD1RateLimit(context, { route: 'referral-link-read', limit: 120, windowSeconds: 60 }, () =>
    handleReferralLinkRead(context.request, referralOptions(context))
  );
}


export function referralEvent(context) {
  return withD1RateLimit(context, { route: 'referral-event', limit: 240, windowSeconds: 60 }, () =>
    handleReferralEvent(context.request, referralOptions(context))
  );
}


export function smsSimulator(context) {
  return withD1RateLimit(context, { route: 'sms-simulator', limit: 180, windowSeconds: 60 }, () =>
    handleSmsSimulator(context.request, smsOptions(context))
  );
}


export function smsHandoffRead(context) {
  return withD1RateLimit(context, { route: 'sms-handoff-read', limit: 120, windowSeconds: 60 }, () =>
    handleSmsHandoffRead(context.request, {
      store: context.env?.COVERAGEFIT_DB ? createSmsHandoffStore(context.env.COVERAGEFIT_DB) : null,
      operationsStore: context.env?.COVERAGEFIT_DB ? createSmsConversationStore(context.env.COVERAGEFIT_DB) : null,
      env: context.env || {}
    })
  );
}


export function smsProducerHandoff(context) {
  return withD1RateLimit(context, { route: 'sms-producer-handoff', limit: 120, windowSeconds: 60 }, () =>
    handleSmsProducerHandoff(context.request, smsOptions(context))
  );
}


export function smsOperations(context) {
  return withD1RateLimit(context, { route: 'sms-operations', limit: 120, windowSeconds: 60 }, () =>
    handleSmsOperations(context.request, smsOptions(context))
  );
}

export function ringCentralSmsWebhook(context) {
  return handleRingCentralWebhook(context.request, smsOptions(context));
}

export function ringCentralSmsStatus(context) {
  return withD1RateLimit(context, { route: 'ringcentral-sms-status', limit: 30, windowSeconds: 60 }, () =>
    handleRingCentralStatus(context.request, smsOptions(context))
  );
}

export function ringCentralSmsSubscription(context) {
  return withD1RateLimit(context, { route: 'ringcentral-sms-subscription', limit: 10, windowSeconds: 60 }, () =>
    handleRingCentralSubscription(context.request, smsOptions(context))
  );
}
