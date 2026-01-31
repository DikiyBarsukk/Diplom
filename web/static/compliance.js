const API_BASE = window.location.origin;
const PERIODS = [
    { days: 1, label: 'Последние 24 часа' },
    { days: 7, label: 'Последние 7 дней' },
    { days: 30, label: 'Последние 30 дней' },
    { days: 90, label: 'Последние 90 дней' }
];
let allRows = [];
let selectedHost = 'all';
let periodIndex = 2;
let autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkAuth();
        updatePeriodButton();
        await loadComplianceData();
        setupActions();
        setupAutoRefresh();
    } catch (e) {
        console.error(e);
    }
});

async function checkAuth() {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
}

async function loadComplianceData() {
    const periodDays = PERIODS[periodIndex].days;
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
    const hostParam = selectedHost !== 'all' ? `&host=${encodeURIComponent(selectedHost)}` : '';
    const logsUrl = `${API_BASE}/api/logs?limit=200&since=${encodeURIComponent(since)}${hostParam}`;
    const [statsRes, logsRes, agentsRes] = await Promise.all([
        fetch(`${API_BASE}/stats`, { credentials: 'include' }),
        fetch(logsUrl, { credentials: 'include' }),
        fetch(`${API_BASE}/api/agents/stats?window_minutes=5`, { credentials: 'include' })
    ]);

    const stats = statsRes.ok ? await statsRes.json() : {};
    const logs = logsRes.ok ? await logsRes.json() : [];
    const agents = agentsRes.ok ? await agentsRes.json() : null;

    updateSummary(stats);
    updateAgentSummary(agents);
    buildAssets(agents, stats);
    buildRows(logs);
    updateTopUsers(logs);
    applySearch();
}

function updateSummary(stats) {
    const severity = stats.severity || {};
    const activeSessions = (severity.info || 0) + (severity.notice || 0);
    const policyViolations = (severity.err || 0) + (severity.alert || 0);
    const privEsc = severity.crit || 0;
    const score = Math.max(0, 100 - Math.min(100, policyViolations));

    setText('activeSessions', activeSessions);
    setText('policyViolations', policyViolations);
    setText('privEscalations', privEsc);
    setText('auditScore', `${score}/100`);
}

function updateAgentSummary(agents) {
    if (!agents) {
        setText('systemsOnline', 0);
        setText('systemsTotal', 0);
        return;
    }
    setText('systemsOnline', agents.online ?? 0);
    setText('systemsTotal', agents.total ?? 0);
}

function buildAssets(agents, stats) {
    const select = document.getElementById('assetSelect');
    if (!select) return;
    const lastSeen = agents?.last_seen || {};
    const hostsStats = stats?.hosts || {};
    const hosts = Array.from(new Set([...Object.keys(lastSeen), ...Object.keys(hostsStats)])).sort();
    select.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'Все удаленные ПК';
    select.appendChild(allOption);
    hosts.forEach(host => {
        const count = hostsStats[host] || 0;
        const label = count ? `${host} (${count} событий)` : host;
        const option = document.createElement('option');
        option.value = host;
        option.textContent = label;
        select.appendChild(option);
    });
    select.value = selectedHost;
    if (select.value !== selectedHost) {
        selectedHost = 'all';
        select.value = 'all';
    }
}

function buildRows(logs) {
    if (!Array.isArray(logs) || !logs.length) {
        allRows = [];
        return;
    }
    allRows = logs.slice(0, 25).map(ev => {
        const user = ev.user || ev.username || ev.uid || ev.account || '—';
        const userRole = ev.role || ev.user_role || (user !== '—' ? 'Пользователь' : 'Система');
        const eventType = ev.event_type || (ev.message ? ev.message.split('|')[0].trim() : 'Событие');
        const host = ev.host || '—';
        const time = ev.ts ? new Date(ev.ts).toLocaleString('ru-RU') : '--';
        const sev = (ev.severity || 'info').toLowerCase();
        const risk = sev === 'emerg' || sev === 'alert' || sev === 'crit' ? 'КРИТИЧЕСКИЙ' :
            sev === 'err' ? 'ВЫСОКИЙ' : sev === 'warn' ? 'СРЕДНИЙ' : 'НИЗКИЙ';
        const riskClass = risk === 'КРИТИЧЕСКИЙ' ? 'bg-red-900/30 text-red-400' :
            risk === 'ВЫСОКИЙ' ? 'bg-orange-900/30 text-orange-400' :
            risk === 'СРЕДНИЙ' ? 'bg-yellow-900/30 text-yellow-400' : 'bg-emerald-900/30 text-emerald-400';
        return {
            user,
            userRole,
            eventType,
            host,
            time,
            risk,
            riskClass
        };
    });
}

function applySearch() {
    const filtered = getFilteredRows();
    renderRows(filtered);
}

function getFilteredRows() {
    const query = (document.getElementById('complianceSearch')?.value || '').trim().toLowerCase();
    return query
        ? allRows.filter(r => `${r.user} ${r.eventType} ${r.host} ${r.risk}`.toLowerCase().includes(query))
        : allRows;
}

function renderRows(rows) {
    const tbody = document.getElementById('complianceTableBody');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-6 text-text-muted text-sm">Нет данных для отображения.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `
        <tr class="hover:bg-border-dark/30 transition-colors">
            <td class="px-6 py-4">
                <div class="flex flex-col">
                    <span class="font-bold text-white">${escapeHtml(String(r.user))}</span>
                    <span class="text-[10px] text-text-muted">${escapeHtml(r.userRole)}</span>
                </div>
            </td>
            <td class="px-6 py-4 font-medium">${escapeHtml(r.eventType)}</td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(r.host)}</td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(r.time)}</td>
            <td class="px-6 py-4"><span class="px-2 py-1 ${r.riskClass} rounded text-[10px] font-bold">${r.risk}</span></td>
            <td class="px-6 py-4 text-right"><button class="material-symbols-outlined text-text-muted hover:text-white">description</button></td>
        </tr>
    `).join('');
}

function setupActions() {
    document.getElementById('complianceSearch')?.addEventListener('input', applySearch);
    document.getElementById('generateComplianceBtn')?.addEventListener('click', loadComplianceData);
    document.getElementById('analyzeLogsBtn')?.addEventListener('click', loadComplianceData);
    document.getElementById('periodButton')?.addEventListener('click', () => {
        periodIndex = (periodIndex + 1) % PERIODS.length;
        updatePeriodButton();
        loadComplianceData();
    });
    document.getElementById('assetSelect')?.addEventListener('change', (e) => {
        selectedHost = e.target.value || 'all';
        loadComplianceData();
    });
    document.getElementById('selectAllAssetsBtn')?.addEventListener('click', () => {
        selectedHost = 'all';
        const select = document.getElementById('assetSelect');
        if (select) select.value = 'all';
        loadComplianceData();
    });
    document.getElementById('resetAssetsBtn')?.addEventListener('click', () => {
        selectedHost = 'all';
        const select = document.getElementById('assetSelect');
        if (select) select.value = 'all';
        loadComplianceData();
    });
    document.getElementById('exportComplianceBtn')?.addEventListener('click', exportCsv);
}

function exportCsv() {
    const rows = getFilteredRows();
    if (!rows.length) return;
    const header = ['Пользователь', 'Роль', 'Тип события', 'Хост', 'Время', 'Риск'];
    const lines = [
        header.join(','),
        ...rows.map(r => [
            r.user,
            r.userRole,
            r.eventType,
            r.host,
            r.time,
            r.risk
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `compliance_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadComplianceData, 30000);
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function updatePeriodButton() {
    const button = document.getElementById('periodButton');
    if (!button) return;
    const label = PERIODS[periodIndex]?.label || 'Последние 30 дней';
    const span = button.querySelector('span:last-child');
    if (span) span.textContent = label;
}

function updateTopUsers(logs) {
    const container = document.getElementById('topUsersList');
    if (!container) return;
    if (!Array.isArray(logs) || !logs.length) {
        container.innerHTML = '<p class="text-text-muted text-sm">Нет данных для отображения.</p>';
        return;
    }
    const counts = new Map();
    logs.forEach(ev => {
        const user = ev.user || ev.username || ev.uid || ev.account || '';
        if (!user) return;
        counts.set(user, (counts.get(user) || 0) + 1);
    });
    const top = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    if (!top.length) {
        container.innerHTML = '<p class="text-text-muted text-sm">Нет данных для отображения.</p>';
        return;
    }
    container.innerHTML = top.map(([user, count]) => `
        <div class="flex items-center justify-between">
            <span>${escapeHtml(user)}</span>
            <span class="text-text-muted text-xs">${count} событий</span>
        </div>
    `).join('');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
