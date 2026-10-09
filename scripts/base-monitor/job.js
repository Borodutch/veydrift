// No model calls. Scheduler owns failure accounting; explicit message owns delivery.
const base = '/Users/borodutch/.openclaw/workspace/';
const program = base + 'artifacts/ticket61/rework-a25a/release/base-monitor/monitor.py';
const state = base + 'state/base-mainnet-monitor-v2.json';
const health = base + 'artifacts/ticket61/rework-a25a/release/base-node';
function result(r) {
  if (!r || r.status !== 'completed' || r.exitCode !== 0 || typeof r.aggregated !== 'string') throw new Error('monitor execution failed; inspect private run');
  const v = JSON.parse(r.aggregated.trim());
  if (!v || typeof v !== 'object') throw new Error('invalid monitor result');
  return v;
}
const out = result(await exec({command: 'python3 ' + program + ' --health-dir ' + health + ' --state ' + state, host:'gateway', timeoutSeconds:150, yieldMs:1000, awaitResults:true}));
// Custody is a degraded delivery subsystem, not a failed sampler. Keep it visible
// in each run result without feeding a permanent scheduler auto-disable loop.
const report = (status, extra = {}) => ({status, custody:out.custody, ...extra});
if (out.status === 'quiet' || out.status === 'busy') return report(out.status);
if (out.status === 'delivery-held') return report('delivery-degraded', {eventId:out.eventId});
if (out.status !== 'proposed') throw new Error('monitor proposal failed');
const event = out.event;
if (!event || !/^[a-f0-9]{24}$/.test(event.eventId) || typeof event.text !== 'string' || event.text.length > 3900 || !event.text.startsWith('#61 Base / resolver monitoring; event ' + event.eventId + '. ')) throw new Error('invalid monitor event');
// Durable custody is committed BEFORE crossing the message boundary. No TTL/retry.
const claimed = result(await exec({command:'python3 ' + program + ' --state ' + state + ' --claim ' + event.eventId,host:'gateway',timeoutSeconds:10,yieldMs:1000,awaitResults:true}));
if (claimed.status === 'delivery-held' || claimed.status === 'busy') return report('delivery-degraded', {eventId:event.eventId});
if (claimed.status !== 'claimed' || claimed.eventId !== event.eventId) throw new Error('monitor claim failed; no send');
let sent;
try {
  sent = await message({action:'send',channel:'telegram',accountId:'default',target:'76104711',threadId:'4030762',message:event.text});
} catch (_) {
  return report('delivery-uncertain', {eventId:event.eventId, custody:claimed.custody});
}
// Code Mode projects jsonResult.details; no successful receipt means no acknowledgment.
if (!sent || sent.ok !== true || sent.delivered === false || sent.status === 'delivery_queued' || !/^[0-9]{1,128}$/.test(String(sent.messageId)) || String(sent.chatId) !== '76104711' || String(sent.receipt?.threadId) !== '4030762') return report('delivery-uncertain', {eventId:event.eventId, custody:claimed.custody});
const receipt = String(sent.messageId);
try {
  const ack = result(await exec({command:'python3 ' + program + ' --state ' + state + ' --ack ' + event.eventId + ' --receipt ' + receipt,host:'gateway',timeoutSeconds:10,yieldMs:1000,awaitResults:true}));
  if (ack.status !== 'acknowledged' || ack.eventId !== event.eventId) throw new Error('invalid acknowledgment');
  return report('delivered', {eventId:event.eventId, receipt, custody:ack.custody});
} catch (_) {
  return report('acknowledgment-uncertain', {eventId:event.eventId, receipt, custody:claimed.custody});
}
