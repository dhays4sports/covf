(() => {
  'use strict';
  const KEY = 'coveragefit.producerInbox.token';
  const ENDPOINT = '/api/sms/operations/';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  let access = sessionStorage.getItem(KEY) || '';

  const status = (id, message, bad = false) => {
    const element = $(id);
    if (!element) return;
    element.textContent = message || '';
    element.dataset.error = bad ? 'true' : 'false';
  };

  async function api(method = 'GET', body = null) {
    const params = new URLSearchParams();
    if (method === 'GET' && $('opsFilter')?.value) params.set('status', $('opsFilter').value);
    const linkedConversation = new URL(location.href).searchParams.get('conversation_id');
    if (method === 'GET' && linkedConversation) params.set('conversation_id', linkedConversation);
    const url = `${ENDPOINT}${params.size ? `?${params}` : ''}`;
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : null
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data?.error?.message || 'Operations request failed.');
    return data;
  }

  const card = (label, value) => `<div class="sim-card"><span class="sim-card__label">${escapeHtml(label)}</span><h2 style="margin:6px 0 0">${escapeHtml(value || 0)}</h2></div>`;
  const formatDate = value => {
    if (!value) return '—';
    try { return new Date(value).toLocaleString(); } catch (_) { return value; }
  };
  const alertText = alert => alert
    ? `${String(alert.type || 'alert').replaceAll('_', ' ')} · ${alert.state}${alert.sentAt ? ` ${formatDate(alert.sentAt)}` : ''}`
    : 'No actionable alert triggered';

  function render(data) {
    const order = ['new', 'active', 'awaiting_dylan', 'human_takeover', 'link_delivered', 'coveragefit_started', 'coveragefit_completed', 'failed', 'stale', 'opted_out', 'completed'];
    $('opsCounts').innerHTML = order.map(key => card(key.replaceAll('_', ' '), data.counts?.[key] || 0)).join('');
    $('opsConversations').innerHTML = data.conversations?.length
      ? data.conversations.map(conversation => `<article class="sim-live-item"><div><strong>${escapeHtml(conversation.status.replaceAll('_', ' '))}</strong> · ${escapeHtml(conversation.contact)} · ${escapeHtml(conversation.intent || 'intent pending')}</div><div>${escapeHtml(conversation.partnerName || 'Direct')} · ${escapeHtml(conversation.priority)} · updated ${escapeHtml(formatDate(conversation.updatedAt))}</div><div><small>Producer alert: ${escapeHtml(alertText(conversation.producerAlert))}</small></div><pre>${escapeHtml(conversation.producerSummary?.text || 'Summary unavailable')}</pre></article>`).join('')
      : '<p>No conversations match this view.</p>';

    const health = data.health || {};
    $('opsHealth').innerHTML = `<div><dt>Last event</dt><dd>${escapeHtml(formatDate(health.lastEventAt))}</dd></div><div><dt>Last success</dt><dd>${escapeHtml(formatDate(health.lastSuccessAt))}</dd></div><div><dt>Last failure</dt><dd>${escapeHtml(formatDate(health.lastFailureAt))}</dd></div><div><dt>Success / failure</dt><dd>${escapeHtml(health.successCount || 0)} / ${escapeHtml(health.failureCount || 0)}</dd></div><div><dt>Stale after</dt><dd>${escapeHtml(data.config?.staleHours)} hours</dd></div><div><dt>Retention</dt><dd>${escapeHtml(data.config?.retentionDays)} days</dd></div>`;
    const alerts = data.config?.producerAlerts || {};
    $('opsAlertHealth').innerHTML = `<div><dt>Enabled</dt><dd>${alerts.enabled ? 'Yes' : 'No'}</dd></div><div><dt>Configured</dt><dd>${alerts.configured ? 'Ready' : 'Needs setup'}</dd></div><div><dt>Missing</dt><dd>${escapeHtml(alerts.missing?.join(', ') || 'Nothing')}</dd></div><div><dt>Privacy</dt><dd>No lead PII in email</dd></div>`;
    $('opsRetries').innerHTML = data.retries?.length ? data.retries.map(item => `<div class="sim-live-item"><strong>${escapeHtml(item.status)}</strong> · attempts ${escapeHtml(item.attempts)}<br><small>${escapeHtml(item.lastError || formatDate(item.updatedAt))}</small></div>`).join('') : '<p>No retry jobs.</p>';
    $('opsCampaigns').innerHTML = data.campaigns?.length ? data.campaigns.map(item => `<div class="sim-live-item"><strong>${escapeHtml(item.partner || item.key)}</strong><br>${escapeHtml(item.total)} conversations · ${escapeHtml(item.started)} started · ${escapeHtml(item.completed)} completed · ${escapeHtml(item.rush)} rush</div>`).join('') : '<p>No campaign activity yet.</p>';
    $('opsAudit').innerHTML = data.audit?.length ? data.audit.slice(0, 30).map(item => `<div class="sim-live-item"><strong>${escapeHtml(item.type)}</strong> · ${escapeHtml(formatDate(item.at))}<br><small>${escapeHtml(item.detail)}</small></div>`).join('') : '<p>No audit events yet.</p>';
  }

  async function load() {
    try {
      render(await api());
      $('opsLock').hidden = true;
      $('opsWorkspace').hidden = false;
      status('opsAccessStatus', '');
    } catch (cause) {
      $('opsLock').hidden = false;
      $('opsWorkspace').hidden = true;
      status('opsAccessStatus', cause.message, true);
    }
  }

  async function action(name) {
    const target = name === 'test_producer_alert' ? 'opsAlertStatus' : 'opsActionStatus';
    status(target, 'Working…');
    try {
      const data = await api('POST', { action: name });
      const message = name === 'retry_pending'
        ? `Processed ${data.processed}; sent ${data.sent}; pending ${data.pending}; failed ${data.failed}.`
        : name === 'cleanup'
          ? `Deleted ${data.deleted} expired operational records.`
          : data.alert?.state === 'sent'
            ? 'Privacy-safe test alert sent.'
            : `Test alert ${data.alert?.state || 'finished'}${data.alert?.reason ? `: ${data.alert.reason}` : '.'}`;
      status(target, message, data.alert && data.alert.state !== 'sent');
      await load();
    } catch (cause) {
      status(target, cause.message, true);
    }
  }

  $('opsAccessForm').addEventListener('submit', event => {
    event.preventDefault();
    access = $('opsAccessKey').value.trim();
    sessionStorage.setItem(KEY, access);
    load();
  });
  $('opsRefresh').addEventListener('click', load);
  $('opsFilter').addEventListener('change', load);
  $('opsRetry').addEventListener('click', () => action('retry_pending'));
  $('opsCleanup').addEventListener('click', () => action('cleanup'));
  $('opsTestAlert').addEventListener('click', () => action('test_producer_alert'));
  if (access) load();
})();
