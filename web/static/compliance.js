const {
    apiBase: API_BASE,
    authenticatedFetch,
    checkPageAuth,
    escapeHtml,
    getSeverityLabel,
    getSeverityBadgeClass,
    setText,
    setupLogout,
    setupGlobalSearch,
    buildLogsUrl,
    persistRecentAction,
} = window.AppShell;
const { getAgentStats, getLogs, getStats } = window.DataClient;

const PERIODS = [
    { days: 1, label: 'За 24 часа' },
    { days: 7, label: 'За 7 дней' },
    { days: 30, label: 'За 30 дней' },
    { days: 90, label: 'За 90 дней' },
];
let allRows = [];
let selectedHost = 'all';
let periodIndex = 1;
let autoRefreshTimer = null;
const REPORT_PRESETS = [
    { label: 'За 24 часа', days: 1 },
    { label: 'За 7 дней', days: 7 },
    { label: 'Критичные', search: 'crit' },
    { label: 'По хосту', hostFromSelect: true },
];

document.addEventListener('DOMContentLoaded', async () => {
    setupGlobalSearch('complianceSearch', (query) => buildLogsUrl({ search: query }));
    installComplianceUx();
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        await loadComplianceData();
        setupActions();
        setupAutoRefresh();
    } catch (error) {
        console.error(error);
    }
});

function installComplianceUx() {
    const header = document.querySelector('.flex.flex-wrap.justify-between.items-center.gap-3.px-8.py-8');
    if (header && !document.getElementById('reportPresetFilters')) {
        const box = document.createElement('div');
        box.id = 'reportPresetFilters';
        box.className = 'w-full flex flex-wrap gap-2';
        box.innerHTML = REPORT_PRESETS.map((preset, index) => `<button data-preset-index="${index}" class="px-3 py-1.5 text-xs font-bold rounded-lg bg-border-dark text-white hover:bg-slate-700 transition-colors">${preset.label}</button>`).join('') + '<button id="copyComplianceSummaryBtn" class="px-3 py-1.5 text-xs font-bold rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors">Скопировать сводку</button>';
        header.appendChild(box);
    }
}

async function loadComplianceData() {
    const periodDays = PERIODS[periodIndex].days;
    const since = new Date(Date.now() - periodDays * 86400000).toISOString();
    const logs = await getLogs({ limit: 200, since, host: selectedHost !== 'all' ? selectedHost : null }).catch(() => []);
    const stats = await getStats().catch(() => ({}));
    const agents = await getAgentStats(5).catch(() => null);
    updateSummary(stats);
    updateAgentSummary(agents);
    buildAssets(agents, stats);
    buildRows(logs);
    updateTopUsers(logs);
    renderRows(getFilteredRows());
    setText('systemsOnline', agents?.online ?? 0);
    setText('systemsTotal', agents?.total ?? 0);
    persistRecentAction({ title: 'Compliance', url: window.location.href, ts: new Date().toISOString() });
}

function updateSummary(stats) {
    const severity = stats.severity || {};
    const activeSessions = (severity.info || 0) + (severity.notice || 0);
    const policyViolations = (severity.err || 0) + (severity.alert || 0);
    const privEsc = severity.crit || 0;
    const score = Math.max(0, 100 - Math.min(100, policyViolations * 3));
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
    const current = select.value || selectedHost;
    const hosts = Array.from(new Set([...(Object.keys(agents?.last_seen || {})), ...(Object.keys(stats?.hosts || {}))])).sort();
    select.innerHTML = '<option value="all">Все удаленные ПК</option>' + hosts.map((host) => `<option value="${escapeHtml(host)}">${escapeHtml(host)}</option>`).join('');
    select.value = hosts.includes(current) ? current : 'all';
    selectedHost = select.value;
}

function buildRows(logs) {
    allRows = (logs || []).slice(0, 50).map((event) => ({
        user: event.user || event.username || event.uid || event.account || '—',
        userRole: event.role || event.user_role || 'Пользователь',
        eventType: event.event_type || event.unit || event.source || 'Событие',
        host: event.host || '—',
        time: window.AppShell.formatDateTimeRu(event.ts),
        riskLabel: getSeverityLabel(event.severity),
        riskClass: getSeverityBadgeClass(event.severity),
        raw: event,
    }));
}

function getFilteredRows() {
    const query = (document.getElementById('complianceSearch')?.value || '').trim().toLowerCase();
    return query ? allRows.filter((row) => `${row.user} ${row.eventType} ${row.host} ${row.riskLabel}`.toLowerCase().includes(query)) : allRows;
}

function renderRows(rows) {
    const tbody = document.getElementById('complianceTableBody');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-6 text-text-muted text-sm">Данные по выбранному периоду не найдены.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map((row) => `
        <tr class="hover:bg-border-dark/30 transition-colors">
            <td class="px-6 py-4"><div class="flex flex-col"><span class="font-bold text-white">${escapeHtml(String(row.user))}</span><span class="text-[10px] text-text-muted">${escapeHtml(row.userRole)}</span></div></td>
            <td class="px-6 py-4 font-medium">${escapeHtml(row.eventType)}</td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(row.host)}</td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(row.time)}</td>
            <td class="px-6 py-4"><span class="px-2 py-1 ${row.riskClass} rounded text-[10px] font-bold">${escapeHtml(row.riskLabel)}</span></td>
            <td class="px-6 py-4 text-right"><a href="${buildLogsUrl({ host: row.host !== '—' ? row.host : '', search: row.eventType })}" class="material-symbols-outlined text-text-muted hover:text-white">open_in_new</a></td>
        </tr>
    `).join('');
}

function setupActions() {
    document.getElementById('complianceSearch')?.addEventListener('input', () => renderRows(getFilteredRows()));
    document.getElementById('generateComplianceBtn')?.addEventListener('click', loadComplianceData);
    document.getElementById('analyzeLogsBtn')?.addEventListener('click', loadComplianceData);
    document.getElementById('periodButton')?.addEventListener('click', () => {
        periodIndex = (periodIndex + 1) % PERIODS.length;
        updatePeriodButton();
        loadComplianceData();
    });
    document.getElementById('assetSelect')?.addEventListener('change', (event) => {
        selectedHost = event.target.value || 'all';
        loadComplianceData();
    });
    document.getElementById('selectAllAssetsBtn')?.addEventListener('click', () => {
        selectedHost = 'all';
        document.getElementById('assetSelect').value = 'all';
        loadComplianceData();
    });
    document.getElementById('resetAssetsBtn')?.addEventListener('click', () => {
        selectedHost = 'all';
        document.getElementById('assetSelect').value = 'all';
        document.getElementById('complianceSearch').value = '';
        loadComplianceData();
    });
    document.getElementById('exportComplianceBtn')?.addEventListener('click', exportCsv);
    document.getElementById('reportPresetFilters')?.addEventListener('click', (event) => {
        const presetButton = event.target.closest('[data-preset-index]');
        if (!presetButton) return;
        const preset = REPORT_PRESETS[Number(presetButton.dataset.presetIndex)];
        if (preset.days) {
            periodIndex = PERIODS.findIndex((item) => item.days === preset.days);
            if (periodIndex < 0) periodIndex = 1;
            updatePeriodButton();
            loadComplianceData();
        } else if (preset.hostFromSelect) {
            renderRows(getFilteredRows().filter((row) => selectedHost === 'all' ? true : row.host === selectedHost));
        } else if (preset.search) {
            document.getElementById('complianceSearch').value = preset.search;
            renderRows(getFilteredRows());
        }
    });
    document.getElementById('copyComplianceSummaryBtn')?.addEventListener('click', async () => {
        const summary = [
            `Активные сессии: ${document.getElementById('activeSessions')?.textContent || '0'}`,
            `Нарушения политик: ${document.getElementById('policyViolations')?.textContent || '0'}`,
            `Повышение привилегий: ${document.getElementById('privEscalations')?.textContent || '0'}`,
            `Оценка аудита: ${document.getElementById('auditScore')?.textContent || '0/100'}`,
        ].join('\n');
        await navigator.clipboard.writeText(summary);
        const btn = document.getElementById('copyComplianceSummaryBtn');
        if (btn) {
            btn.textContent = 'Сводка скопирована';
            setTimeout(() => { btn.textContent = 'Скопировать сводку'; }, 1500);
        }
    });
}

function exportCsv() {
    if (!allRows.length) return;
    const header = ['Пользователь', 'Роль', 'Тип события', 'Хост', 'Время', 'Риск'];
    const lines = [
        header.join(','),
        ...getFilteredRows().map((row) => [row.user, row.userRole, row.eventType, row.host, row.time, row.riskLabel].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `compliance_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function updatePeriodButton() {
    const span = document.querySelector('#periodButton span:last-child');
    if (span) span.textContent = PERIODS[periodIndex].label;
}

function updateTopUsers(logs) {
    const container = document.getElementById('topUsersList');
    if (!container) return;
    const counts = new Map();
    (logs || []).forEach((event) => {
        const user = event.user || event.username || event.uid || event.account;
        if (!user) return;
        counts.set(user, (counts.get(user) || 0) + 1);
    });
    const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    container.innerHTML = top.length ? top.map(([user, count]) => `<div class="flex items-center justify-between"><span>${escapeHtml(user)}</span><span class="text-text-muted">${count}</span></div>`).join('') : '<p class="text-text-muted text-sm">Нет данных для отображения.</p>';
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadComplianceData, 30000);
}
