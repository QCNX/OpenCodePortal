import { InstanceView } from '../api/instance-view';
import { SetupGuideContent } from '../setup-guide/loader';
import { formatPortalVersionLabel, getPortalVersion } from '../../shared/version';
import { escapeHtml, escapeAttr, safeJson } from './escape';
import { getHtmlLang, getTranslations, type PortalLocale } from '../i18n';
import { renderLanguageOptions, renderLanguageSwitcherScript, renderThemeToggleScript } from './shared-scripts';
import { renderPortalIcon } from './icons';

export interface DashboardPageModel {
  locale: PortalLocale;
  instances: InstanceView[];
  baseDomain: string;
  authEnabled: boolean;
  setupGuide: SetupGuideContent | null;
}

export function renderDashboardPage(model: DashboardPageModel): string {
    const locale = model.locale;
    const translations = getTranslations(locale);
    const t = {
      ...translations.common,
      ...translations.dashboard,
      modalClose: translations.common.close,
      setupClose: translations.common.close,
    };

    const instances = model.instances;
    const baseDomain = model.baseDomain;
    const langAttr = getHtmlLang(locale);
    const versionLabel = formatPortalVersionLabel(getPortalVersion());
    const rowIcons = {
      info: renderPortalIcon('info'),
      deploy: renderPortalIcon('deploy'),
      edit: renderPortalIcon('edit'),
      delete: renderPortalIcon('delete'),
    };

    const rows = instances
      .map(
        (inst) => `
        <tr>
          <td><span class="portal-status-dot ${escapeAttr(inst.status)}"></span></td>
          <td>
            ${inst.status === 'online'
              ? `<a class="portal-link" href="//${escapeAttr(inst.id)}.${escapeAttr(baseDomain)}/">${escapeHtml(inst.name)}</a>`
              : escapeHtml(inst.name)
            }
            <button type="button" onclick="event.stopPropagation();showDetail(${escapeAttr(safeJson(inst.id))})" title="${escapeAttr(t.infoTitle)}" aria-label="${escapeAttr(t.infoTitle)}" class="portal-detail-action">${rowIcons.info}</button>
          </td>
          <td>${inst.tags.length ? escapeHtml(inst.tags.join(', ')) : '-'}</td>
          <td title="${escapeAttr(t.colSessionsHint)}">${inst.status === 'online' ? inst.sessionCount : '-'}</td>
          <td>${inst.status === 'online' && inst.agentVersion ? escapeHtml('v' + inst.agentVersion) : '-'}</td>
          <td>${inst.status === 'online' && inst.opencodeVersion ? escapeHtml('v' + inst.opencodeVersion) : '-'}</td>
          <td class="last-seen" data-ts="${inst.lastSeen}">${inst.lastSeen ? escapeHtml(t.timeNow) : '-'}</td>
          <td>${escapeHtml(inst.status === 'online' ? t.online : t.offline)}</td>
          <td class="actions-cell">
            <button type="button" onclick="event.stopPropagation();showDeploy(${escapeAttr(safeJson(inst.id))})" title="${escapeAttr(t.deployInstance)}" aria-label="${escapeAttr(t.deployInstance)}" class="portal-row-action">${rowIcons.deploy}</button>
            <button type="button" onclick="event.stopPropagation();showEdit(${escapeAttr(safeJson(inst.id))})" title="${escapeAttr(t.editInstance)}" aria-label="${escapeAttr(t.editInstance)}" class="portal-row-action">${rowIcons.edit}</button>
            <button type="button" onclick="event.stopPropagation();showDelete(${escapeAttr(safeJson(inst.id))})" title="${escapeAttr(t.deleteInstance)}" aria-label="${escapeAttr(t.deleteInstance)}" class="portal-row-action portal-row-action-danger">${rowIcons.delete}</button>
          </td>
        </tr>`,
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="${langAttr}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenCode Portal</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/portal.css">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .dash-container { max-width: 1100px; margin: 0 auto; }
    .portal-form-group { margin-bottom: 14px; }
    .portal-form-group label { display: block; font-size: 12px; color: var(--text-weak); margin-bottom: 4px; }
    .portal-form-group input { width: 100%; }
    .portal-field-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
    .portal-field-actions label { margin-bottom: 0; }
    .portal-pass-status { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: var(--font-size-small); color: var(--text-weak); }
    .portal-pass-clear-note { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; font-size: 12px; color: var(--text-weak); }
    .portal-field-note { color: var(--text-weak); font-size: 12px; line-height: 1.5; margin-top: 6px; }
    .deploy-code-copy { position: absolute; top: 4px; right: 8px; font-size: 11px; cursor: pointer; background: var(--surface-raised-base); border: 1px solid var(--border-weak-base); border-radius: var(--radius-xs); padding: 2px 8px; color: var(--text-weak); font-family: var(--font-family-sans); }
    .deploy-code-copy:hover { color: var(--text-stronger); }
    .portal-error-note { color: #e53e3e; font-size: 12px; margin-top: 4px; }
    .dash-toolbar { display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px; }
    .dash-toolbar-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .dash-toolbar-actions { margin-left: auto; display: flex; gap: 12px; flex-wrap: wrap; }
    #tagFilters { gap: 6px; flex-wrap: wrap; }
    /* Setup Guide modal content */
    #setupContent pre {
      background: var(--surface-inset-base);
      border: 1px solid var(--border-weak-base);
      border-radius: var(--radius-sm);
      padding: 12px;
      font-family: var(--font-family-mono);
      font-size: 12px;
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-x: auto;
      margin: 8px 0;
    }
    #setupContent code {
      font-family: var(--font-family-mono);
      font-size: 11px;
      background: var(--surface-inset-base);
      padding: 1px 4px;
      border-radius: 3px;
    }
    #setupContent pre code { background: none; padding: 0; font-size: inherit; }
    #setupContent blockquote {
      border-left: 3px solid var(--border-interactive-selected, var(--border-weak-base));
      padding: 8px 12px;
      margin: 8px 0;
      background: var(--surface-inset-base);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }
    #setupContent blockquote p { margin: 4px 0; }
    #setupContent ul { padding-left: 20px; margin: 8px 0; }
    #setupContent li { margin: 4px 0; line-height: 1.6; }
    #setupContent strong { font-weight: 600; }
    .portal-sse-status { font-size: 11px; color: var(--text-weak); white-space: nowrap; }
    .portal-sse-status[data-state="connected"] { color: #2ea043; }
    .portal-sse-status[data-state="disconnected"] { color: #cf222e; }
  </style>
</head>
<body class="portal-body" style="padding: 40px 20px;">
  <div class="dash-container">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <h1 style="font-size:var(--font-size-large);font-weight:530;color:var(--text-stronger);">OpenCode Portal</h1>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="portal-version">${escapeHtml(versionLabel)}</span>
        <button type="button" class="portal-theme-toggle" id="theme-toggle" title="${escapeAttr(t.themeSystem)}" aria-label="${escapeAttr(t.themeSystem)}">${renderPortalIcon('system')}</button>
        <span style="position:relative;">
          <button type="button" class="portal-lang-btn" id="lang-btn" title="${escapeAttr(t.language)}" aria-label="${escapeAttr(t.language)}">${renderPortalIcon('language')}</button>
          <div class="portal-lang-dropdown" id="lang-dropdown">
            ${renderLanguageOptions(locale)}
          </div>
        </span>
        ${model.authEnabled ? `<a href="/auth/logout" data-component="button-v2" data-variant="ghost" data-size="small">${escapeHtml(t.logout)}</a>` : ''}
      </div>
    </div>
    <div class="dash-toolbar">
      <div class="dash-toolbar-row">
        <input type="text" id="search" data-component="input-v2" style="width:220px;" placeholder="${escapeAttr(t.searchPlaceholder)}" oninput="render()">
        <select id="statusFilter" class="portal-select" onchange="render()">
          <option value="">${escapeHtml(t.allStatus)}</option>
          <option value="online">${escapeHtml(t.online)}</option>
          <option value="offline">${escapeHtml(t.offline)}</option>
        </select>
        <button type="button" id="refreshStatus" class="portal-status-refresh" title="${escapeAttr(t.refreshStatus)}" aria-label="${escapeAttr(t.refreshStatus)}" onclick="location.reload()">${renderPortalIcon('refresh')}</button>
        <span id="sseStatus" class="portal-sse-status" data-state="connecting" aria-live="polite"></span>
        <div class="dash-toolbar-actions">
          ${model.setupGuide ? `<button type="button" data-component="button-v2" data-variant="neutral" data-size="normal" onclick="showSetupGuide()">${escapeHtml(t.setupGuide)}</button>` : ''}
          <button type="button" data-component="button-v2" data-variant="contrast" data-size="normal" onclick="showAdd()">+ ${escapeHtml(t.addInstance)}</button>
        </div>
      </div>
      <div class="dash-toolbar-row" id="tagFilters"></div>
    </div>
    <table class="portal-table">
      <thead>
        <tr>
          <th></th>
          <th class="sortable" data-col="name" onclick="toggleSort('name')">${escapeHtml(t.colName)} <span class="portal-sort-arrow"></span></th>
          <th>${escapeHtml(t.colTags)}</th>
          <th class="sortable" data-col="sessionCount" onclick="toggleSort('sessionCount')" title="${escapeAttr(t.colSessionsHint)}">${escapeHtml(t.colSessions)} <span class="portal-sort-arrow"></span></th>
          <th class="sortable" data-col="agentVersion" onclick="toggleSort('agentVersion')">${escapeHtml(t.colAgentVersion)} <span class="portal-sort-arrow"></span></th>
          <th class="sortable" data-col="opencodeVersion" onclick="toggleSort('opencodeVersion')">${escapeHtml(t.colOpencodeVersion)} <span class="portal-sort-arrow"></span></th>
          <th class="sortable" data-col="lastSeen" onclick="toggleSort('lastSeen')">${escapeHtml(t.colHeartbeat)} <span class="portal-sort-arrow"></span></th>
          <th class="sortable" data-col="status" onclick="toggleSort('status')">${escapeHtml(t.colStatus)} <span class="portal-sort-arrow"></span></th>
          <th></th> <!-- actions -->
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="9">${escapeHtml(t.noInstances)}</td></tr>`}
      </tbody>
    </table>
  </div>

  <!-- Detail modal -->
  <div class="portal-modal-overlay" id="modalOverlay" onclick="closeDetail(event)">
    <div class="portal-modal portal-card" onclick="event.stopPropagation()">
      <h2 id="modalTitle">-</h2>
      <div id="modalBody"></div>
      <button type="button" data-component="button-v2" data-variant="neutral" data-size="small" style="margin-top:16px;" onclick="closeDetail()">${escapeHtml(t.modalClose)}</button>
    </div>
  </div>

  <!-- Add/Edit modal -->
  <div class="portal-modal-overlay" id="addEditOverlay" onclick="closeForm(event)">
    <div class="portal-modal portal-card" onclick="event.stopPropagation()" style="width:400px;">
      <h2 id="addEditTitle">${escapeHtml(t.addTitle)}</h2>
      <form id="addEditForm" onsubmit="handleFormSubmit(event)">
        <div class="portal-form-group">
          <label for="aeName">${escapeHtml(t.instanceName)}</label>
          <input type="text" id="aeName" data-component="input-v2" required oninput="onNameInput()">
        </div>
        <div class="portal-form-group">
          <label for="aeId">${escapeHtml(t.instanceId)}</label>
          <input type="text" id="aeId" data-component="input-v2" required>
        </div>
        <div class="portal-form-group">
          <label for="aeTags">${escapeHtml(t.colTags)}</label>
          <input type="text" id="aeTags" data-component="input-v2" placeholder="${escapeAttr(t.tagsHint)}">
        </div>
        <div class="portal-form-group">
          <label for="aeTargetHost">${escapeHtml(t.targetHost)}</label>
          <input type="text" id="aeTargetHost" data-component="input-v2" value="127.0.0.1">
        </div>
        <div class="portal-form-group">
          <label for="aeTargetPort">${escapeHtml(t.targetPort)}</label>
          <input type="text" id="aeTargetPort" data-component="input-v2" value="4096">
        </div>
        <div class="portal-form-group">
          <div class="portal-field-actions">
            <label for="aeOpenUser">${escapeHtml(t.openUser)}</label>
            <button type="button" id="aeOpenUserClear" data-component="button-v2" data-variant="ghost" data-size="small" style="display:none" onclick="clearOpenUser()">${escapeHtml(t.openUserClear)}</button>
          </div>
          <input type="text" id="aeOpenUser" data-component="input-v2" placeholder="${escapeAttr(t.optional)}">
        </div>
        <div class="portal-form-group">
          <label for="aeOpenPass">${escapeHtml(t.openPass)}</label>
          <div id="aeOpenPassStatus" class="portal-pass-status" style="display:none">
            <span>${escapeHtml(t.openPassSet)}</span>
            <button type="button" data-component="button-v2" data-variant="neutral" data-size="small" onclick="showOpenPassModify()">${escapeHtml(t.openPassModify)}</button>
            <button type="button" data-component="button-v2" data-variant="ghost" data-tone="critical" data-size="small" onclick="markOpenPassClear()">${escapeHtml(t.openPassClear)}</button>
          </div>
          <div id="aeOpenPassInputWrap">
            <input type="password" id="aeOpenPass" data-component="input-v2" placeholder="${escapeAttr(t.optional)}" autocomplete="new-password">
          </div>
          <div id="aeOpenPassClearNote" class="portal-pass-clear-note" style="display:none">
            <span>${escapeHtml(t.openPassClearPending)}</span>
            <button type="button" data-component="button-v2" data-variant="ghost" data-size="small" onclick="cancelOpenPassClear()">${escapeHtml(t.openPassClearCancel)}</button>
          </div>
          <p class="portal-field-note">${escapeHtml(t.openCredentialsHint)}</p>
        </div>
        <div id="aeError" class="portal-error-note" style="display:none;"></div>
        <div class="portal-button-row">
          <button type="button" data-component="button-v2" data-variant="ghost" data-size="small" onclick="closeForm()">${escapeHtml(t.cancel)}</button>
          <button type="submit" data-component="button-v2" data-variant="contrast" data-size="small" id="aeSubmit">${escapeHtml(t.create)}</button>
        </div>
      </form>
      <input type="hidden" id="aeEditId" value="">
    </div>
  </div>

  <!-- Deploy modal -->
  <div class="portal-modal-overlay" id="deployOverlay" onclick="closeDeploy(event)">
    <div class="portal-modal portal-card" onclick="event.stopPropagation()" style="width:700px;max-width:95vw;height:75vh;display:flex;flex-direction:column;">
      <h2 id="deployTitle">${escapeHtml(t.deployTitle)}</h2>
      <p class="portal-field-note">${escapeHtml(t.deployCredentialsHint)}</p>
      <div class="portal-tabs deploy-method-tabs">
        <button type="button" class="portal-tab active" onclick="switchDeployTab('docker')">${escapeHtml(t.dockerRun)}</button>
        <button type="button" class="portal-tab" onclick="switchDeployTab('compose')">${escapeHtml(t.composeEnv)}</button>
      </div>
      <div style="flex:1;min-height:0;overflow-y:auto;">
        <div id="deployTabDocker" class="deploy-tab-panel">${escapeHtml(t.loading)}</div>
        <div id="deployTabCompose" class="deploy-tab-panel" style="display:none;">${escapeHtml(t.loading)}</div>
      </div>
      <div class="portal-button-row">
        <button type="button" data-component="button-v2" data-variant="neutral" data-size="small" onclick="closeDeploy()">${escapeHtml(t.modalClose)}</button>
      </div>
    </div>
  </div>

  <!-- Delete confirmation modal -->
  <div class="portal-modal-overlay" id="deleteOverlay" onclick="closeDelete(event)">
    <div class="portal-modal portal-card" onclick="event.stopPropagation()" style="width:380px;">
      <h2>${escapeHtml(t.confirmDelete)}</h2>
      <p style="color:var(--text-weak);font-size:var(--font-size-small);margin:12px 0;">${escapeHtml(t.confirmDeleteDesc)}</p>
      <p style="font-weight:530;" id="deleteInstName">-</p>
      <div id="deleteError" class="portal-error-note" style="display:none;"></div>
      <div class="portal-button-row">
        <button type="button" data-component="button-v2" data-variant="ghost" data-size="small" onclick="closeDelete()">${escapeHtml(t.cancel)}</button>
        <button type="button" data-component="button-v2" data-variant="contrast" data-tone="critical" data-size="small" id="deleteConfirmBtn" onclick="doDelete()">${escapeHtml(t.deleteInstance)}</button>
      </div>
    </div>
  </div>

  ${model.setupGuide ? `<!-- Setup Guide modal -->
  <div class="portal-modal-overlay" id="setupOverlay" onclick="closeModal(event,'setupOverlay')">
    <div class="portal-modal portal-card" onclick="event.stopPropagation()" style="width:700px;max-width:95vw;height:75vh;display:flex;flex-direction:column;">
      <h2 id="setupTitle">${escapeHtml(t.setupGuide)}</h2>
      <div class="portal-tabs" id="setupMainTabs"></div>
      <div class="portal-tabs" id="setupSubTabs" style="display:none;"></div>
      <div id="setupContent" style="flex:1;min-height:0;overflow-y:auto;font-size:var(--font-size-small);line-height:1.6;"></div>
      <div class="portal-button-row">
        <button type="button" data-component="button-v2" data-variant="neutral" data-size="small" onclick="closeModal(null,'setupOverlay')">${escapeHtml(t.setupClose)}</button>
      </div>
    </div>
  </div>` : ''}

<script>
let allInstances = ${safeJson(instances)};
let baseDomain = ${safeJson(baseDomain)};
let setupSteps = ${model.setupGuide ? safeJson(model.setupGuide[locale]) : 'null'};
let activeTags = new Set();
let sortCol = null, sortAsc = true;
let i18nSessionsHint = ${safeJson(t.colSessionsHint)};
let i18nDetailSessionsHint = ${safeJson(t.detailSessionsHint)};
let i18nAction = {
  info: ${safeJson(t.infoTitle)},
  deploy: ${safeJson(t.deployInstance)},
  edit: ${safeJson(t.editInstance)},
  delete: ${safeJson(t.deleteInstance)},
  online: ${safeJson(t.online)},
  offline: ${safeJson(t.offline)},
};
let deployI18n = {
  deploymentCommand: ${safeJson(t.deploymentCommand)},
  upgradeGuide: ${safeJson(t.upgradeGuide)},
  upgradeCommand: ${safeJson(t.upgradeCommand)},
  upgradeDowntime: ${safeJson(t.upgradeDowntime)},
  dockerSteps: ${safeJson([t.upgradeDockerStep1, t.upgradeDockerStep2, t.upgradeDockerStep3])},
  composeSteps: ${safeJson([t.upgradeComposeStep1, t.upgradeComposeStep2, t.upgradeComposeStep3])},
};
let rowIcons = ${safeJson(rowIcons)};

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function attr(v) { return esc(v); }
function jsArg(v) {
  return attr(JSON.stringify(String(v ?? '')).replace(/</g, '\\\\u003c').replace(/>/g, '\\\\u003e').replace(/&/g, '\\\\u0026'));
}

// -- URL persistence -----------------------------------------------------
function readUrlParams() {
  const p = new URLSearchParams(location.search);
  const q = p.get('q'); if (q) document.getElementById('search').value = q;
  const s = p.get('status'); if (s) document.getElementById('statusFilter').value = s;
  const t = p.get('tags'); if (t) t.split(',').forEach(tag => activeTags.add(tag));
}
function writeUrlParams() {
  const q = document.getElementById('search').value;
  const s = document.getElementById('statusFilter').value;
  const tags = [...activeTags].join(',');
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (s) p.set('status', s);
  if (tags) p.set('tags', tags);
  const url = location.pathname + (p.toString() ? '?' + p.toString() : '');
  history.replaceState(null, '', url);
}

// -- Sort ----------------------------------------------------------------
function toggleSort(col) {
  if (sortCol === col) { sortAsc = !sortAsc; }
  else { sortCol = col; sortAsc = true; }
  render();
}
function applySort(list) {
  if (!sortCol) return list;
  const mult = sortAsc ? 1 : -1;
  return [...list].sort((a, b) => {
    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
    if (sortCol === 'lastSeen') { va = va || 0; vb = vb || 0; }
    if (sortCol === 'sessionCount' || sortCol === 'lastSeen') return (va - vb) * mult;
    if (sortCol === 'status') { va = va === 'online' ? 0 : 1; vb = vb === 'online' ? 0 : 1; }
    return String(va).localeCompare(String(vb)) * mult;
  });
}
function updateSortArrows() {
  document.querySelectorAll('.portal-sort-arrow').forEach(el => el.textContent = '');
  if (!sortCol) return;
  const th = document.querySelector('th[data-col="' + sortCol + '"] .portal-sort-arrow');
  if (th) th.textContent = sortAsc ? '\\u25B2' : '\\u25BC';
}

// -- Uptime helper -------------------------------------------------------
function uptime(connectedAt) {
  if (!connectedAt) return '-';
  const diff = Date.now() - connectedAt;
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
}

// -- Detail modal --------------------------------------------------------
function showDetail(id) {
  const inst = allInstances.find(i => i.id === id);
  if (!inst) return;
  document.getElementById('modalTitle').textContent = inst.name;
  document.getElementById('modalBody').innerHTML = [
    [${safeJson(t.detailId)}, inst.id],
    [${safeJson(t.detailStatus)}, inst.status === 'online' ? i18nAction.online : i18nAction.offline],
    [${safeJson(t.detailTags)}, inst.tags.join(', ') || '-'],
    [${safeJson(t.detailSessions)}, inst.status === 'online' ? inst.sessionCount : '-', i18nDetailSessionsHint],
    [${safeJson(t.colAgentVersion)}, inst.agentVersion ? 'v' + inst.agentVersion : '-'],
    [${safeJson(t.colOpencodeVersion)}, inst.opencodeVersion ? 'v' + inst.opencodeVersion : '-'],
    [${safeJson(t.detailLastSeen)}, timeAgo(inst.lastSeen)],
    [${safeJson(t.detailUptime)}, inst.connectedAt ? uptime(inst.connectedAt) : '-'],
    [${safeJson(t.detailConnectedAt)}, inst.connectedAt ? new Date(inst.connectedAt).toLocaleString('${langAttr}') : '-'],
  ].map(([k, v, keyTitle]) => '<div class="row"><span class="key"' + (keyTitle ? ' title="' + attr(keyTitle) + '"' : '') + '>' + esc(k) + '</span><span class="val" title="' + attr(v) + '">' + esc(v) + '</span></div>').join('');
  document.getElementById('modalOverlay').classList.add('visible');
}
// Track mousedown target to prevent drag-out-from-input closing modals
var _ocpMouseDownTarget = null;
document.addEventListener('mousedown', function(e) { _ocpMouseDownTarget = e.target; });

function closeModal(e, overlayId) {
  if (e && e.target !== document.getElementById(overlayId)) return;
  // Don't close if user was selecting text (drag-out from input or DOM selection)
  // Only apply mousedown guard for overlay backdrop clicks where e is the event
  if (e && _ocpMouseDownTarget) {
    var overlay = document.getElementById(overlayId);
    // If mousedown started inside the modal card (not on the overlay backdrop), skip close
    if (overlay && overlay.contains(_ocpMouseDownTarget) && _ocpMouseDownTarget !== overlay) return;
    // Also skip if there's an active DOM selection (for non-input text)
    var sel = window.getSelection();
    if (sel && sel.toString().length > 0) return;
  }
  document.getElementById(overlayId).classList.remove('visible');
}
// ESC key closes any visible modal
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Escape') return;
  var modals = document.querySelectorAll('.portal-modal-overlay.visible');
  for (var i = 0; i < modals.length; i++) {
    modals[i].classList.remove('visible');
  }
});
function closeDetail(e) { closeModal(e, 'modalOverlay'); }
function closeForm(e) {
  closeModal(e, 'addEditOverlay');
  document.getElementById('aeId').readOnly = false;
  passClearPending = false;
}
function closeDeploy(e) {
  closeModal(e, 'deployOverlay');
  pendingDeployId = null;
}
function closeDelete(e) {
  closeModal(e, 'deleteOverlay');
  deleteTargetId = null;
}
document.addEventListener('keydown', function(e) {
  if (e.key === '/' && document.activeElement !== document.getElementById('search') && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    document.getElementById('search').focus();
  }
});

function updateTagFilters() {
  const tags = [...new Set(allInstances.flatMap(i => i.tags))].sort();
  const el = document.getElementById('tagFilters');
  el.style.display = tags.length ? 'flex' : 'none';
  el.innerHTML = tags.map(t =>
    '<button type="button" class="portal-chip' + (activeTags.has(t) ? ' active' : '') + '" onclick="toggleTag(' + jsArg(t) + ')">' + esc(t) + '</button>'
  ).join('');
}
function toggleTag(t) { activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t); render(); }

function timeAgo(ts) {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return ${safeJson(t.timeNow)};
  const m = Math.floor(s / 60);
  if (m < 60) return ${safeJson(t.timeMinutesAgo)}.replace('{value}', String(m));
  const h = Math.floor(m / 60);
  if (h < 24) return ${safeJson(t.timeHoursAgo)}.replace('{value}', String(h));
  return ${safeJson(t.timeDaysAgo)}.replace('{value}', String(Math.floor(h / 24)));
}

// -- slugify -------------------------------------------------------------
function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').substring(0, 48);
}

// -- Add / Edit form -----------------------------------------------------
let pendingDeployId = null;
let passClearPending = false;

function resetOpenPassUi(hasPassword) {
  passClearPending = false;
  const status = document.getElementById('aeOpenPassStatus');
  const inputWrap = document.getElementById('aeOpenPassInputWrap');
  const clearNote = document.getElementById('aeOpenPassClearNote');
  const passInput = document.getElementById('aeOpenPass');
  passInput.value = '';
  clearNote.style.display = 'none';
  if (hasPassword) {
    status.style.display = 'flex';
    inputWrap.style.display = 'none';
    passInput.placeholder = ${safeJson(t.openPassKeep)};
  } else {
    status.style.display = 'none';
    inputWrap.style.display = '';
    passInput.placeholder = ${safeJson(t.optional)};
  }
}
function showOpenPassModify() {
  passClearPending = false;
  document.getElementById('aeOpenPassStatus').style.display = 'none';
  document.getElementById('aeOpenPassClearNote').style.display = 'none';
  document.getElementById('aeOpenPassInputWrap').style.display = '';
  document.getElementById('aeOpenPass').placeholder = ${safeJson(t.openPassKeep)};
  document.getElementById('aeOpenPass').focus();
}
function markOpenPassClear() {
  passClearPending = true;
  document.getElementById('aeOpenPassStatus').style.display = 'none';
  document.getElementById('aeOpenPassInputWrap').style.display = 'none';
  document.getElementById('aeOpenPass').value = '';
  document.getElementById('aeOpenPassClearNote').style.display = 'flex';
}
function cancelOpenPassClear() {
  const editId = document.getElementById('aeEditId').value;
  const inst = editId ? allInstances.find(i => i.id === editId) : null;
  resetOpenPassUi(!!(inst && inst.hasOpencodePassword));
}
function clearOpenUser() {
  document.getElementById('aeOpenUser').value = '';
  document.getElementById('aeOpenUser').focus();
}

function showAdd() {
  document.getElementById('addEditTitle').textContent = ${safeJson(t.addTitle)};
  document.getElementById('aeName').value = '';
  document.getElementById('aeId').value = '';
  document.getElementById('aeTags').value = '';
  document.getElementById('aeTargetHost').value = '127.0.0.1';
  document.getElementById('aeTargetPort').value = '4096';
  document.getElementById('aeOpenUser').value = '';
  document.getElementById('aeOpenUserClear').style.display = 'none';
  resetOpenPassUi(false);
  document.getElementById('aeEditId').value = '';
  document.getElementById('aeError').style.display = 'none';
  document.getElementById('aeSubmit').textContent = ${safeJson(t.create)};
  document.getElementById('addEditOverlay').classList.add('visible');
  document.getElementById('aeName').focus();
}
function showEdit(id) {
  const inst = allInstances.find(i => i.id === id);
  if (!inst) return;
  document.getElementById('addEditTitle').textContent = ${safeJson(t.editTitle)};
  document.getElementById('aeName').value = inst.name;
  document.getElementById('aeId').value = inst.id;
  document.getElementById('aeId').readOnly = true;
  document.getElementById('aeTags').value = inst.tags.join(', ');
  document.getElementById('aeTargetHost').value = inst.targetHost || '127.0.0.1';
  document.getElementById('aeTargetPort').value = inst.targetPort || 4096;
  document.getElementById('aeOpenUser').value = inst.opencodeUser || '';
  document.getElementById('aeOpenUserClear').style.display = '';
  resetOpenPassUi(inst.hasOpencodePassword);
  document.getElementById('aeEditId').value = inst.id;
  document.getElementById('aeError').style.display = 'none';
  document.getElementById('aeSubmit').textContent = ${safeJson(t.save)};
  document.getElementById('addEditOverlay').classList.add('visible');
}
function onNameInput() {
  const editId = document.getElementById('aeEditId').value;
  if (!editId) {
    document.getElementById('aeId').value = slugify(document.getElementById('aeName').value);
  }
}
async function handleFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById('aeEditId').value;
  const id = document.getElementById('aeId').value.trim();
  const errEl = document.getElementById('aeError');
  errEl.style.display = 'none';

  const isEdit = !!editId;
  const method = isEdit ? 'PATCH' : 'POST';
  const url = isEdit ? '/api/instances/' + encodeURIComponent(editId) : '/api/instances';

  const openUserRaw = document.getElementById('aeOpenUser').value.trim();
  const formFields = {
    name: document.getElementById('aeName').value.trim(),
    tags: (document.getElementById('aeTags').value || '').split(',').map(t => t.trim()).filter(Boolean),
    targetHost: document.getElementById('aeTargetHost').value || undefined,
    targetPort: parseInt(document.getElementById('aeTargetPort').value) || undefined,
  };
  if (isEdit) {
    formFields.opencodeUser = openUserRaw || null;
  } else if (openUserRaw) {
    formFields.opencodeUser = openUserRaw;
  }
  const openPass = document.getElementById('aeOpenPass').value;
  if (!isEdit) {
    if (openPass) formFields.opencodePassword = openPass;
  } else if (passClearPending) {
    formFields.opencodePassword = null;
  } else if (openPass) {
    formFields.opencodePassword = openPass;
  }
  const body = JSON.stringify(isEdit ? formFields : { id, ...formFields });

  try {
    const resp = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || ${safeJson(t.requestFailed)} + ' (' + resp.status + ')');
    }
    closeForm();
    location.reload();
  } catch (err) {
    errEl.textContent = ${safeJson(t.errorPrefix)} + ': ' + err.message;
    errEl.style.display = 'block';
  }
}

// -- Deploy modal --------------------------------------------------------
function deployCodeBlock(content) {
  return '<div class="deploy-code"><button type="button" class="deploy-code-copy" onclick="copyToClipboard(this)">' + esc(${safeJson(t.copy)}) + '</button>' + esc(content || 'N/A') + '</div>';
}
function deployUpgradeGuide(steps, command) {
  return '<section class="deploy-upgrade-guide">' +
    '<h3>' + esc(deployI18n.upgradeGuide) + '</h3>' +
    '<ol>' + steps.map(step => '<li>' + esc(step) + '</li>').join('') + '</ol>' +
    '<p class="deploy-upgrade-note">' + esc(deployI18n.upgradeDowntime) + '</p>' +
    '<div class="deploy-section-title">' + esc(deployI18n.upgradeCommand) + '</div>' +
    deployCodeBlock(command) +
  '</section>';
}
async function showDeploy(id) {
  pendingDeployId = id;
  document.getElementById('deployTitle').textContent = ${safeJson(t.deployTitle)} + ': ' + id;
  document.getElementById('deployTabDocker').textContent = ${safeJson(t.loading)};
  document.getElementById('deployTabCompose').textContent = ${safeJson(t.loading)};
  document.getElementById('deployOverlay').classList.add('visible');
  switchDeployTab('docker');
  try {
    const resp = await fetch('/api/instances/' + encodeURIComponent(id) + '/deploy');
    const data = await resp.json();
    document.getElementById('deployTabDocker').innerHTML =
      '<div class="deploy-section-title">' + esc(deployI18n.deploymentCommand) + '</div>' +
      deployCodeBlock(data.dockerRun) +
      deployUpgradeGuide(deployI18n.dockerSteps, data.dockerUpgrade);
    document.getElementById('deployTabCompose').innerHTML =
      '<div class="deploy-section-title">docker-compose.yml</div>' +
      deployCodeBlock(data.composeFile) +
      '<div class="deploy-section-title">.env</div>' +
      deployCodeBlock(data.composeEnv) +
      deployUpgradeGuide(deployI18n.composeSteps, data.composeUpgrade);
  } catch (err) {
    document.getElementById('deployTabDocker').textContent = ${safeJson(t.errorPrefix)} + ': ' + err.message;
    document.getElementById('deployTabCompose').textContent = ${safeJson(t.errorPrefix)} + ': ' + err.message;
  }
}
function switchDeployTab(tab) {
  document.querySelectorAll('#deployOverlay .portal-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('#deployOverlay [id^="deployTab"]').forEach(el => el.style.display = 'none');
  const tabBtn = document.querySelector('#deployOverlay .portal-tab[onclick*="' + tab + '"]');
  if (tabBtn) tabBtn.classList.add('active');
  const panel = document.getElementById('deployTab' + (tab === 'docker' ? 'Docker' : 'Compose'));
  if (panel) panel.style.display = 'block';
}
function copyToClipboard(btn) {
  const code = btn.parentElement;
  const text = code.textContent.replace(btn.textContent, '').trim();
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = ${safeJson(t.copied)};
    setTimeout(() => { btn.textContent = ${safeJson(t.copy)}; }, 1500);
  }).catch(() => {});
}

// -- Delete modal ---------------------------------------------------------
let deleteTargetId = null;
function showDelete(id) {
  const inst = allInstances.find(i => i.id === id);
  if (!inst) return;
  deleteTargetId = id;
  document.getElementById('deleteInstName').textContent = inst.name + ' (' + inst.id + ')';
  document.getElementById('deleteError').style.display = 'none';
  document.getElementById('deleteConfirmBtn').disabled = false;
  document.getElementById('deleteConfirmBtn').textContent = ${safeJson(t.deleteInstance)};
  document.getElementById('deleteOverlay').classList.add('visible');
}
async function doDelete() {
  if (!deleteTargetId) return;
  const btn = document.getElementById('deleteConfirmBtn');
  btn.disabled = true;
  btn.textContent = ${safeJson(t.deleting)};
  const errEl = document.getElementById('deleteError');
  errEl.style.display = 'none';
  try {
    const resp = await fetch('/api/instances/' + encodeURIComponent(deleteTargetId), { method: 'DELETE' });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error || ${safeJson(t.deleteFailed)} + ' (' + resp.status + ')');
    }
    closeDelete();
    location.reload();
  } catch (err) {
    errEl.textContent = ${safeJson(t.errorPrefix)} + ': ' + err.message;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = ${safeJson(t.deleteInstance)};
  }
}

// -- Setup Guide modal -----------------------------------------------------
let setupActiveStep = 0;
let setupActiveSub = 0;

function showSetupGuide() {
  if (!setupSteps || !setupSteps.length) return;
  setupActiveStep = 0;
  setupActiveSub = 0;
  renderSetupTabs();
  document.getElementById('setupOverlay').classList.add('visible');
}

function renderSetupTabs() {
  const mt = document.getElementById('setupMainTabs');
  mt.innerHTML = setupSteps.map((s, i) =>
    '<button type="button" class="portal-tab' + (i === setupActiveStep ? ' active' : '') + '" onclick="switchSetupTab(' + i + ')">' + esc(s.title) + '</button>'
  ).join('');

  const st = document.getElementById('setupSubTabs');
  const step = setupSteps[setupActiveStep];
  if (step.subSteps.length > 0) {
    st.style.display = 'flex';
    st.innerHTML = step.subSteps.map((ss, i) =>
      '<button type="button" class="portal-tab' + (i === setupActiveSub ? ' active' : '') + '" onclick="switchSetupSubTab(' + i + ')">' + esc(ss.title) + '</button>'
    ).join('');
  } else {
    st.style.display = 'none';
    st.innerHTML = '';
  }
  renderSetupContent();
}

function switchSetupTab(i) {
  setupActiveStep = i;
  setupActiveSub = 0;
  renderSetupTabs();
}

function switchSetupSubTab(i) {
  setupActiveSub = i;
  const step = setupSteps[setupActiveStep];
  const st = document.getElementById('setupSubTabs');
  st.querySelectorAll('.portal-tab').forEach((el, j) => el.classList.toggle('active', j === i));
  renderSetupContent();
}

function renderSetupContent() {
  const step = setupSteps[setupActiveStep];
  const content = step.subSteps.length > 0
    ? step.subSteps[setupActiveSub].content
    : step.content;
  var el = document.getElementById('setupContent');
  el.innerHTML = content;
  // Add copy buttons to code blocks
  var pres = el.querySelectorAll('pre');
  for (var i = 0; i < pres.length; i++) {
    if (pres[i].querySelector('.deploy-code-copy')) continue;
    pres[i].style.position = 'relative';
    var btn = document.createElement('button');
    btn.className = 'deploy-code-copy';
    btn.textContent = ${safeJson(t.copy)};
    btn.onclick = function() { copyToClipboard(this); };
    pres[i].appendChild(btn);
  }
}

function render() {
  const search = (document.getElementById('search').value || '').toLowerCase();
  const status = document.getElementById('statusFilter').value;
  let filtered = allInstances;
  if (search) filtered = filtered.filter(i => i.name.toLowerCase().includes(search) || i.id.toLowerCase().includes(search));
  if (status) filtered = filtered.filter(i => i.status === status);
  if (activeTags.size > 0) filtered = filtered.filter(i => i.tags.some(t => activeTags.has(t)));
  filtered = applySort(filtered);
  const tbody = document.querySelector('tbody');
  if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="9">${escapeAttr(t.noMatch)}</td></tr>'; updateSortArrows(); writeUrlParams(); return; }
  tbody.innerHTML = filtered.map(inst =>
    '<tr>' +
      '<td><span class="portal-status-dot ' + attr(inst.status) + '"></span></td>' +
      '<td>' + (inst.status === 'online' ? '<a class="portal-link" href="//' + attr(inst.id) + '.' + attr(baseDomain) + '/">' + esc(inst.name) + '</a>' : esc(inst.name)) +
        ' <button type="button" onclick="event.stopPropagation();showDetail(' + jsArg(inst.id) + ')" title="' + i18nAction.info + '" aria-label="' + i18nAction.info + '" class="portal-detail-action">' + rowIcons.info + '</button>' +
      '</td>' +
      '<td>' + (inst.tags.length ? esc(inst.tags.join(', ')) : '-') + '</td>' +
      '<td title="' + attr(i18nSessionsHint) + '">' + (inst.status === 'online' ? inst.sessionCount : '-') + '</td>' +
      '<td>' + (inst.status === 'online' && inst.agentVersion ? esc('v' + inst.agentVersion) : '-') + '</td>' +
      '<td>' + (inst.status === 'online' && inst.opencodeVersion ? esc('v' + inst.opencodeVersion) : '-') + '</td>' +
      '<td class="last-seen">' + timeAgo(inst.lastSeen) + '</td>' +
      '<td>' + esc(inst.status === 'online' ? i18nAction.online : i18nAction.offline) + '</td>' +
      '<td class="actions-cell">' +
        ' <button type="button" onclick="event.stopPropagation();showDeploy(' + jsArg(inst.id) + ')" title="' + i18nAction.deploy + '" aria-label="' + i18nAction.deploy + '" class="portal-row-action">' + rowIcons.deploy + '</button>' +
        ' <button type="button" onclick="event.stopPropagation();showEdit(' + jsArg(inst.id) + ')" title="' + i18nAction.edit + '" aria-label="' + i18nAction.edit + '" class="portal-row-action">' + rowIcons.edit + '</button>' +
        ' <button type="button" onclick="event.stopPropagation();showDelete(' + jsArg(inst.id) + ')" title="' + i18nAction.delete + '" aria-label="' + i18nAction.delete + '" class="portal-row-action portal-row-action-danger">' + rowIcons.delete + '</button>' +
      '</td>' +
    '</tr>'
  ).join('');
  updateTagFilters();
  updateSortArrows();
  writeUrlParams();
}

readUrlParams();
const sseLabels = { connected: ${safeJson(t.sseConnected)}, disconnected: ${safeJson(t.sseDisconnected)} };
function setSseStatus(state) {
  const el = document.getElementById('sseStatus');
  if (!el) return;
  el.dataset.state = state;
  const label = state === 'connected' ? sseLabels.connected : sseLabels.disconnected;
  el.textContent = label;
  el.title = label;
}
const es = new EventSource('/events');
es.onopen = () => setSseStatus('connected');
es.onerror = () => setSseStatus('disconnected');
es.onmessage = (e) => {
  try {
    const data = JSON.parse(e.data);
    if (data.instances) { allInstances = data.instances; render(); }
  } catch {}
};
render();
</script>
${renderThemeToggleScript(t)}
${renderLanguageSwitcherScript(baseDomain)}
</body>
</html>`;

    return html;
}
