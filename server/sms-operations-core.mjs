import { authorizeProducer } from './consultation-inbox-core.mjs';
import { normalizeE164, sendRingCentralSms } from './ringcentral-client.mjs';
import { buildSmsProducerSummary } from './sms-producer-handoff-core.mjs';
import {
  normalizeSmsProducerAlert,
  sendSmsProducerTestAlert,
  smsProducerAlertConfig
} from './sms-producer-alert.mjs';

export const SMS_OPERATIONS_BUILD = 'RC-SMS-1.9.1';
export const OPS_PREFIX = 'sms-ops/';
export const AUDIT_PREFIX = `${OPS_PREFIX}audit/`;
export const RETRY_PREFIX = `${OPS_PREFIX}retry/`;
export const HEALTH_KEY = `${OPS_PREFIX}health/ringcentral-webhook`;
export const DEFAULT_STALE_HOURS = 24;
export const DEFAULT_RETENTION_DAYS = 30;
const LIVE_PREFIX = 'sms-live-conversations/';
const EVENT_PREFIX = 'sms-live-events/';
const MAX_BODY_BYTES = 12000;

const txt=(v,f='')=>typeof v==='string'&&v.trim()?v.trim():typeof v==='number'&&Number.isFinite(v)?String(v):f;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, max-age=0','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff'}});
const error=(s,c,m)=>json({ok:false,error:{code:c,message:m}},s);
const nowDate=(o={})=>{const v=typeof o.now==='function'?o.now():o.now,d=v instanceof Date?v:v?new Date(v):new Date();return Number.isNaN(d.getTime())?new Date():d};
const envNum=(env,k,f,min,max)=>Math.max(min,Math.min(max,Number(env?.[k])||f));
export const operationsConfig=(env={})=>({staleHours:envNum(env,'RCSMS_STALE_HOURS',DEFAULT_STALE_HOURS,1,720),retentionDays:envNum(env,'RCSMS_RETENTION_DAYS',DEFAULT_RETENTION_DAYS,1,365),maxRetries:envNum(env,'RCSMS_MAX_RETRIES',3,1,8)});
export const redactPhone=v=>{const n=normalizeE164(v);return n?`+1 ••• ••• ${n.slice(-4)}`:'Unknown'};
export const redactLogText=(v,max=160)=>txt(v).replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,'[phone]').replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Ct|Court|Blvd|Boulevard)\b/gi,'[address]').slice(0,max);

export function operationsStatus(conversation={}, now=new Date(), staleHours=DEFAULT_STALE_HOURS){
  if(conversation.deliveryFailure) return 'failed';
  if(conversation.state==='opted_out') return 'opted_out';
  if(conversation.state==='completed') return 'completed';
  if(conversation.coverageFitCompletedAt) return 'coveragefit_completed';
  if(conversation.coverageFitStartedAt) return 'coveragefit_started';
  if(conversation.state==='human_takeover') return 'human_takeover';
  if(conversation.state==='awaiting_producer') return conversation.handoff?.url?'link_delivered':'awaiting_dylan';
  const updated=Date.parse(conversation.updatedAt||conversation.createdAt||'');
  if(Number.isFinite(updated)&&now.getTime()-updated>staleHours*3600000) return 'stale';
  if(conversation.state&&conversation.state!=='new') return 'active';
  return 'new';
}

function safeConversation(c,now,cfg){
  if(!c||typeof c!=='object'||!/^sms-live-[a-f0-9]{32,64}$/i.test(txt(c.id)))return null;
  return {id:c.id,status:operationsStatus(c,now,cfg.staleHours),state:txt(c.state,'new'),intent:txt(c.intent),contact:redactPhone(c.contactPhone),priority:c.answers?.priority==='rush'?'rush':'standard',partnerName:txt(c.attribution?.partnerName),partnerId:txt(c.attribution?.partnerId),campaignId:txt(c.handoffContext?.campaignId||c.campaignId||''),createdAt:txt(c.createdAt),updatedAt:txt(c.updatedAt),lastInboundAt:txt(c.lastInboundAt),lastOutboundAt:txt(c.lastOutboundAt),coverageFitStartedAt:txt(c.coverageFitStartedAt),coverageFitCompletedAt:txt(c.coverageFitCompletedAt),handoffDelivered:Boolean(c.handoff?.url),retryPending:Boolean(c.retryPending),producerAlert:normalizeSmsProducerAlert(c.producerAlert),producerSummary:buildSmsProducerSummary(c)};
}
function counts(rows){return rows.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});}
function campaignReport(rows){const m=new Map();for(const r of rows){const key=r.partnerId||r.campaignId||'direct';const x=m.get(key)||{key,partner:r.partnerName||'',total:0,rush:0,started:0,completed:0};x.total++;if(r.priority==='rush')x.rush++;if(['coveragefit_started','coveragefit_completed'].includes(r.status)||r.coverageFitStartedAt)x.started++;if(r.status==='coveragefit_completed'||r.coverageFitCompletedAt)x.completed++;m.set(key,x)}return [...m.values()].sort((a,b)=>b.total-a.total).slice(0,50)}

export async function writeOpsAudit(store,type,detail={},options={}){if(!store?.setJSON)return;const at=nowDate(options).toISOString(),id=`${AUDIT_PREFIX}${at.replace(/[^0-9]/g,'')}-${Math.random().toString(36).slice(2,8)}`;const record={build:SMS_OPERATIONS_BUILD,type:txt(type,'event'),at,conversationId:txt(detail.conversationId),detail:redactLogText(detail.message||detail.detail||type)};await store.setJSON(id,record,{metadata:{type:record.type,conversationId:record.conversationId,createdAt:at,updatedAt:at}}).catch(()=>{});}
export async function updateWebhookHealth(store,patch={},options={}){if(!store?.get||!store?.setJSON)return;const at=nowDate(options).toISOString(),old=await store.get(HEALTH_KEY)||{};const next={build:SMS_OPERATIONS_BUILD,lastEventAt:patch.success===false?txt(old.lastEventAt):at,lastSuccessAt:patch.success===false?txt(old.lastSuccessAt):at,lastFailureAt:patch.success===false?at:txt(old.lastFailureAt),successCount:Math.max(0,Number(old.successCount)||0)+(patch.success===false?0:1),failureCount:Math.max(0,Number(old.failureCount)||0)+(patch.success===false?1:0),lastFailureCode:patch.success===false?txt(patch.code,'sms_processing_failed'):txt(old.lastFailureCode),updatedAt:at};await store.setJSON(HEALTH_KEY,next,{metadata:{createdAt:txt(old.createdAt,at),updatedAt:at}}).catch(()=>{});}

export async function queueSmsRetry(store,job={},options={}){if(!store?.setJSON)return null;const at=nowDate(options).toISOString(),id=`${RETRY_PREFIX}${crypto.randomUUID()}`;const record={build:SMS_OPERATIONS_BUILD,id,conversationId:txt(job.conversationId),to:normalizeE164(job.to),body:txt(job.body).slice(0,1000),sourceMessageId:txt(job.sourceMessageId),attempts:0,status:'pending',createdAt:at,updatedAt:at,lastError:redactLogText(job.error||'')};await store.setJSON(id,record,{metadata:{status:'pending',conversationId:record.conversationId,createdAt:at,updatedAt:at}});return record;}

async function retryJob(store,job,env,options={}){const cfg=operationsConfig(env),at=nowDate(options).toISOString();try{const sent=await sendRingCentralSms({to:job.to,textBody:job.body},env,options);job.status='sent';job.sentMessageId=txt(sent?.id);job.updatedAt=at;job.attempts=(Number(job.attempts)||0)+1;job.lastError='';const ckey=`${LIVE_PREFIX}${txt(job.conversationId)}`;const conversation=await store.get(ckey).catch(()=>null);if(conversation&&typeof conversation==='object'){conversation.deliveryFailure=null;conversation.retryPending=false;conversation.outboundCount=Math.max(0,Number(conversation.outboundCount)||0)+1;conversation.lastOutboundAt=at;conversation.updatedAt=at;conversation.transcript=[...(Array.isArray(conversation.transcript)?conversation.transcript:[]),{id:`rc-${job.sentMessageId||`retry-${Date.now()}`}`,direction:'outbound',body:job.body,occurredAt:at,kind:'automation_retry',stateBefore:conversation.state,stateAfter:conversation.state}].slice(-80);conversation.producerSummary=buildSmsProducerSummary(conversation);await store.setJSON(ckey,conversation,{metadata:{state:conversation.state||'',intent:conversation.intent||'',retryPending:false,createdAt:conversation.createdAt||at,updatedAt:at}});}}catch(e){job.attempts=(Number(job.attempts)||0)+1;job.status=job.attempts>=cfg.maxRetries?'failed':'pending';job.lastError=redactLogText(e?.message||'Retry failed');job.updatedAt=at;}await store.setJSON(job.id,job,{metadata:{status:job.status,conversationId:job.conversationId,createdAt:job.createdAt,updatedAt:at}});return job;}

async function body(request){const n=Number(request.headers.get('content-length'));if(Number.isFinite(n)&&n>MAX_BODY_BYTES)return{response:error(413,'payload_too_large','Operations request is too large.')};if(!String(request.headers.get('content-type')||'').toLowerCase().includes('application/json'))return{response:error(415,'unsupported_media_type','Expected application/json.')};try{return{payload:await request.json()}}catch{return{response:error(400,'invalid_json','A valid operations request is required.')}}}
function sameOrigin(r){try{return new URL(txt(r.headers.get('origin'))).origin===new URL(r.url).origin}catch{return false}}

export async function handleSmsOperations(request,options={}){
  const auth=authorizeProducer(request,options.env||{});if(!auth.ok)return auth.response;const store=options.store;if(!store?.get||!store?.setJSON||!store?.list||!store?.delete)return error(503,'storage_unavailable','SMS operations storage is unavailable.');
  const cfg=operationsConfig(options.env||{}),now=nowDate(options);
  if(request.method==='GET'){
    const lists=await Promise.all([store.list({prefix:LIVE_PREFIX,limit:500}),store.list({prefix:RETRY_PREFIX,limit:200}),store.list({prefix:AUDIT_PREFIX,limit:100})]);
    const conversations=(await Promise.all((lists[0].blobs||[]).map(x=>store.get(x.key)))).map(x=>safeConversation(x,now,cfg)).filter(Boolean);
    const params=new URL(request.url).searchParams,filter=txt(params.get('status')),conversationId=txt(params.get('conversation_id'));if(conversationId&&!/^sms-live-[a-f0-9]{32,64}$/i.test(conversationId))return error(422,'invalid_conversation_id','A valid SMS conversation identifier is required.');let rows=filter?conversations.filter(x=>x.status===filter):conversations;if(conversationId)rows=rows.filter(x=>x.id===conversationId);
    const retries=(await Promise.all((lists[1].blobs||[]).map(x=>store.get(x.key)))).filter(Boolean).map(x=>({id:x.id,conversationId:x.conversationId,status:x.status,attempts:x.attempts,createdAt:x.createdAt,updatedAt:x.updatedAt,lastError:redactLogText(x.lastError)}));
    const audits=(await Promise.all((lists[2].blobs||[]).map(x=>store.get(x.key)))).filter(Boolean).map(x=>({type:x.type,at:x.at,conversationId:x.conversationId,detail:redactLogText(x.detail)}));
    const alertConfig=smsProducerAlertConfig(options.env||{},request.url);
    return json({ok:true,build:SMS_OPERATIONS_BUILD,config:{...cfg,producerAlerts:{enabled:alertConfig.enabled,configured:alertConfig.configured,missing:alertConfig.missing}},generatedAt:now.toISOString(),counts:counts(conversations),conversations:rows.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,200),retries,health:await store.get(HEALTH_KEY),campaigns:campaignReport(conversations),audit:audits});
  }
  if(request.method!=='POST')return error(405,'method_not_allowed','GET or POST is required.');if(!sameOrigin(request))return error(403,'origin_rejected','Operations changes must come from this CoverageFit site.');const p=await body(request);if(p.response)return p.response;const action=txt(p.payload?.action).toLowerCase();
  if(action==='retry_pending'){const listed=await store.list({prefix:RETRY_PREFIX,limit:100});const jobs=(await Promise.all((listed.blobs||[]).map(x=>store.get(x.key)))).filter(x=>x?.status==='pending');const results=[];for(const job of jobs)results.push(await retryJob(store,job,options.env||{},options));await writeOpsAudit(store,'retry_pending',{detail:`Processed ${results.length} pending SMS retries.`},options);return json({ok:true,processed:results.length,sent:results.filter(x=>x.status==='sent').length,failed:results.filter(x=>x.status==='failed').length,pending:results.filter(x=>x.status==='pending').length});}
  if(action==='cleanup'){const cutoff=now.getTime()-cfg.retentionDays*86400000;let deleted=0;for(const prefix of [EVENT_PREFIX,AUDIT_PREFIX,RETRY_PREFIX]){const l=await store.list({prefix,limit:1000});for(const item of l.blobs||[]){const t=Date.parse(item.uploadedAt||item.metadata?.updatedAt||'');if(Number.isFinite(t)&&t<cutoff){await store.delete(item.key);deleted++;}}}await writeOpsAudit(store,'cleanup',{detail:`Deleted ${deleted} expired operational records.`},options);return json({ok:true,deleted,retentionDays:cfg.retentionDays});}
  if(action==='test_producer_alert'){const alert=await sendSmsProducerTestAlert({...options,requestUrl:request.url,fetch:options.notificationFetch||options.fetch});await writeOpsAudit(store,`producer_alert_test_${alert.state}`,{detail:`Privacy-safe producer email test finished with state ${alert.state}.`},options);return json({ok:true,alert:{state:alert.state,attemptedAt:alert.attemptedAt,sentAt:alert.sentAt,reason:alert.reason}});}
  return error(422,'invalid_action','Unsupported operations action.');
}
