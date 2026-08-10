import { authorizeProducer } from './consultation-inbox-core.mjs';
import { normalizeE164, sendRingCentralSms } from './ringcentral-client.mjs';
import { SMS_STATES } from './sms-conversation-core.mjs';
import { writeOpsAudit } from './sms-operations-core.mjs';

export const SMS_PRODUCER_HANDOFF_BUILD = 'RC-SMS-1.9.1';
const LIVE_CONVERSATION_PREFIX = 'sms-live-conversations/';
export const SMS_PRODUCER_ACTIONS = Object.freeze(['pause', 'resume', 'resend_handoff', 'complete', 'not_proceeding']);
const LIVE_ID = /^sms-live-[a-f0-9]{32,64}$/i;
const MAX_BODY_BYTES = 8000;

function text(value, fallback = '') {
  if (value === 0) return '0';
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' } });
}
function error(status, code, message) { return json({ ok: false, error: { code, message } }, status); }
function sameOrigin(request) {
  const origin = text(request.headers.get('origin'));
  if (!origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch (_) { return false; }
}
function nowIso(options = {}) {
  const value = typeof options.now === 'function' ? options.now() : options.now;
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
function phoneDisplay(value) {
  const n = normalizeE164(value);
  return n ? `${n.slice(0, 2)} (${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}` : 'Unknown';
}
function occupancyLabel(value) {
  return ({ primary_home: 'Primary', rental_property: 'Rental', second_home: 'Second home', not_sure: 'Not sure' })[text(value)] || 'Not captured';
}

export function buildSmsProducerSummary(conversation = {}) {
  const answers = conversation.answers && typeof conversation.answers === 'object' ? conversation.answers : {};
  const attribution = conversation.attribution && typeof conversation.attribution === 'object' ? conversation.attribution : {};
  const handoff = conversation.handoff && typeof conversation.handoff === 'object' ? conversation.handoff : null;
  const summary = {
    conversationId: text(conversation.id),
    buyer: phoneDisplay(conversation.contactPhone || conversation.testPhone),
    intent: text(conversation.intent, 'Not captured'),
    referredBy: text(attribution.partnerName, 'Direct / no partner captured'),
    partnerId: text(attribution.partnerId),
    property: text(answers.propertyAddress, 'Not captured'),
    closing: text(answers.closingDateDisplay || answers.closingDateRaw || answers.closingDate, 'Not captured'),
    occupancy: occupancyLabel(answers.occupancy),
    autoReview: typeof answers.autoReview === 'boolean' ? (answers.autoReview ? 'Yes' : 'No') : 'Not captured',
    reviewReason: text(answers.reviewReason, 'Not captured'),
    bundleStatus: text(answers.bundleStatus, 'Not captured'),
    requestCategory: text(answers.requestCategory, 'Not captured'),
    priority: answers.priority === 'rush' ? 'RUSH / time-sensitive' : 'Standard',
    coverageFit: handoff?.url ? 'Link delivered / available' : 'Not delivered',
    state: text(conversation.state, 'new'),
    updatedAt: text(conversation.updatedAt)
  };
  const title = conversation.intent === 'buyer' ? 'NEW 408FARMERS BUYER' : conversation.intent === 'home_review' ? 'NEW 408FARMERS HOME REVIEW' : conversation.intent === 'bundle' ? 'NEW 408FARMERS HOME + AUTO' : 'NEW 408FARMERS REQUEST';
  summary.text = [
    title,
    '',
    `Buyer: ${summary.buyer}`,
    `Referred by: ${summary.referredBy}`,
    `Property: ${summary.property}`,
    `Closing: ${summary.closing}`,
    `Occupancy: ${summary.occupancy}`,
    `Auto review: ${summary.autoReview}`,
    ...(conversation.intent === 'home_review' ? [`Review reason: ${summary.reviewReason}`] : []),
    ...(conversation.intent === 'bundle' ? [`Current policies: ${summary.bundleStatus}`] : []),
    ...(conversation.intent === 'other' ? [`Request: ${summary.requestCategory}`] : []),
    `Priority: ${summary.priority}`,
    `CoverageFit: ${summary.coverageFit}`
  ].join('\n');
  return summary;
}

export function determineGuidedResumeState(conversation = {}) {
  const intent = text(conversation.intent);
  if (!intent) return 'intent_requested';
  const a = conversation.answers || {};
  if (intent === 'buyer') {
    if (!text(a.propertyAddress)) return 'buyer_address_requested';
    if (!text(a.closingDateDisplay || a.closingDateRaw || a.closingDate)) return 'buyer_closing_date_requested';
    if (!text(a.occupancy)) return 'buyer_occupancy_requested';
    if (typeof a.autoReview !== 'boolean') return 'buyer_bundle_requested';
  } else if (intent === 'home_review') {
    if (!text(a.propertyAddress)) return 'home_review_address_requested';
    if (!text(a.reviewReason)) return 'home_review_reason_requested';
  } else if (intent === 'bundle') {
    if (!text(a.propertyAddress)) return 'bundle_address_requested';
    if (!text(a.occupancy)) return 'bundle_occupancy_requested';
    if (!text(a.bundleStatus)) return 'bundle_status_requested';
  } else if (intent === 'other') return text(a.requestCategory) ? 'awaiting_producer' : 'other_category_requested';
  return conversation.handoff?.url ? 'awaiting_producer' : 'coveragefit_ready';
}

function cleanConversation(value) {
  if (!value || typeof value !== 'object' || !LIVE_ID.test(text(value.id))) return null;
  const state = text(value.state).toLowerCase();
  return {
    ...value,
    state: SMS_STATES.includes(state) ? state : 'new',
    transcript: Array.isArray(value.transcript) ? value.transcript.slice(-80) : [],
    producerSummary: buildSmsProducerSummary(value)
  };
}

function metadata(conversation) {
  return {
    state: conversation.state,
    intent: text(conversation.intent),
    priority: conversation.answers?.priority || 'standard',
    partnerId: conversation.attribution?.partnerId || '',
    producerHandoff: true,
    updatedAt: conversation.updatedAt,
    createdAt: conversation.createdAt,
    build: SMS_PRODUCER_HANDOFF_BUILD
  };
}

function transcriptItem(body, occurredAt, before, after, kind = 'operator') {
  return { id: `operator-${occurredAt}-${Math.random().toString(36).slice(2, 8)}`, direction: 'outbound', body: text(body).slice(0, 1000), occurredAt, kind, stateBefore: before, stateAfter: after };
}

async function parseBody(request) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { response: error(413, 'payload_too_large', 'The producer action is too large.') };
  if (!String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return { response: error(415, 'unsupported_media_type', 'Expected application/json.') };
  let raw = '';
  try { raw = await request.text(); } catch (_) { return { response: error(400, 'invalid_body', 'The producer action could not be read.') }; }
  if (!raw || raw.length > MAX_BODY_BYTES) return { response: error(raw ? 413 : 400, 'invalid_body', 'A valid producer action is required.') };
  try { return { payload: JSON.parse(raw) }; } catch (_) { return { response: error(400, 'invalid_json', 'The producer action is not valid JSON.') }; }
}

export async function handleSmsProducerHandoff(request, options = {}) {
  const authorization = authorizeProducer(request, options.env || {});
  if (!authorization.ok) return authorization.response;
  const store = options.store;
  if (!store?.get || !store?.setJSON || !store?.list) return error(503, 'storage_unavailable', 'SMS producer handoff storage is unavailable.');

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const id = text(url.searchParams.get('conversation_id'));
    if (id) {
      if (!LIVE_ID.test(id)) return error(422, 'invalid_conversation_id', 'A valid live SMS conversation ID is required.');
      const conversation = cleanConversation(await store.get(`${LIVE_CONVERSATION_PREFIX}${id}`));
      if (!conversation) return error(404, 'conversation_not_found', 'The live SMS conversation was not found.');
      return json({ ok: true, conversation });
    }
    const listed = await store.list({ prefix: LIVE_CONVERSATION_PREFIX, limit: 100 });
    const keys = (listed?.blobs || []).map(item => item.key).filter(key => key.startsWith(LIVE_CONVERSATION_PREFIX));
    const loaded = await Promise.all(keys.map(key => store.get(key)));
    const conversations = loaded.map(cleanConversation).filter(Boolean).filter(item => ['awaiting_producer', 'human_takeover'].includes(item.state)).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return json({ ok: true, count: conversations.length, conversations });
  }

  if (request.method !== 'POST') return error(405, 'method_not_allowed', 'GET or POST is required.');
  if (!sameOrigin(request)) return error(403, 'origin_rejected', 'Producer SMS actions can only be changed from this CoverageFit site.');
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const id = text(parsed.payload?.conversationId);
  const action = text(parsed.payload?.action).toLowerCase();
  if (!LIVE_ID.test(id)) return error(422, 'invalid_conversation_id', 'A valid live SMS conversation ID is required.');
  if (!SMS_PRODUCER_ACTIONS.includes(action)) return error(422, 'invalid_action', 'Unsupported producer SMS action.');
  const key = `${LIVE_CONVERSATION_PREFIX}${id}`;
  let conversation = cleanConversation(await store.get(key));
  if (!conversation) return error(404, 'conversation_not_found', 'The live SMS conversation was not found.');
  const occurredAt = nowIso(options);
  const before = conversation.state;

  if (action === 'resend_handoff') {
    const url = text(conversation.handoff?.url);
    if (!url) return error(409, 'handoff_unavailable', 'This conversation does not have a CoverageFit continuation link to resend.');
    const message = `Here is your secure CoverageFit continuation link again: ${url}`;
    const response = await sendRingCentralSms({ to: conversation.contactPhone, textBody: message }, options.env || {}, options);
    const outboundId = text(response?.id, `operator-${Date.now()}`);
    conversation.transcript = [...conversation.transcript, { id: `rc-${outboundId}`, direction: 'outbound', body: message, occurredAt, kind: 'operator', stateBefore: before, stateAfter: before }].slice(-80);
    conversation.outboundCount = Math.max(0, Number(conversation.outboundCount) || 0) + 1;
    conversation.lastOutboundAt = occurredAt;
  } else {
    const target = action === 'pause' ? 'human_takeover' : action === 'resume' ? determineGuidedResumeState(conversation) : 'completed';
    conversation.state = target;
    conversation.producerDisposition = action === 'not_proceeding' ? 'not_proceeding' : action === 'complete' ? 'completed' : text(conversation.producerDisposition);
    if (target === 'completed') conversation.completedAt = occurredAt;
    const note = action === 'pause' ? 'Automation paused by Dylan.' : action === 'resume' ? 'Guided intake resumed by Dylan.' : action === 'not_proceeding' ? 'Marked not proceeding by Dylan.' : 'Conversation marked complete by Dylan.';
    conversation.transcript = [...conversation.transcript, transcriptItem(note, occurredAt, before, target)].slice(-80);
  }
  conversation.updatedAt = occurredAt;
  conversation.producerSummary = buildSmsProducerSummary(conversation);
  await store.setJSON(key, conversation, { metadata: metadata(conversation) });
  await writeOpsAudit(store, `producer_${action}`, { conversationId: id, detail: `Producer action: ${action}` }, options);
  return json({ ok: true, action, conversation });
}
