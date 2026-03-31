const {
    checkPageAuth,
    createAutoRefreshController,
    escapeHtml,
    formatAgo,
    formatDateTimeRu,
    getSeverityBadgeClass,
    getSeverityLabel,
    setupGlobalSearch,
    setupLogout,
    persistRecentAction,
    getStatusMeta,
} = window.AppShell;
const { getIncidentStats, getIncidents, getLogs, getStats } = window.DataClient;

let reportRows = [];
let autoRefreshController = null;
const REPORT_PRESETS = [
    { label: 'За 24 часа', type: 'reload' },
    { label: 'За 7 дней', type: 'reload' },
    { label: 'По критичным', type: 'critical' },
    { label: 'По хосту', type: 'host' },
];

document.addEventListener('DOMContentLoaded', async () => {
    setupLogout('logoutBtn');
    setupGlobalSearch('reportsSearch', (query) => `/analytics?search=${encodeURIComponent(query)}`);
    renderPresetButtons();
    bindActions();
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        await loadReportData();
        autoRefreshController = createAutoRefreshController(loadReportData, 30000);
        autoRefreshController.start();
    } catch (error) {
        console.error(error);
    }
});

function renderPresetButtons() {
    const container = document.getElementById('analyticsPresetFilters');
    if (!container) return;
    container.innerHTML = REPORT_PRESETS.map((preset, index) => `<button data-preset-index="${index}" class="pill-button">${preset.label}</button>`).join('');
}

function bindActions() {
    document.getElementById('reportsSearch')?.addEventListener('input', applyReportSearch);
    document.getElementById('previewReportBtn')?.addEventListener('click', loadReportData);
    document.getElementById('generateReportBtn')?.addEventListener('click', exportReportCsv);
    document.getElementById('copyReportSummaryBtn')?.addEventListener('click', async () => {
        const summary = `Критичные события: ${document.getElementById('criticalTotal')?.textContent || '0'}\nРиск: ${document.getElementById('riskLevel')?.textContent || 'Н/Д'}\nПодсказка: ${document.getElementById('riskHint')?.textContent || ''}`;
        await navigator.clipboard.writeText(summary);
        const btn = document.getElementById('copyReportSummaryBtn');
        if (btn) {
            btn.textContent = 'Сводка скопирована';
            setTimeout(() => { btn.textContent = 'Скопировать сводку'; }, 1500);
        }
    });
    document.getElementById('analyticsPresetFilters')?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-preset-index]');
        if (!button) return;
        const preset = REPORT_PRESETS[Number(button.dataset.presetIndex)];
        if (preset.type === 'critical') {
            document.getElementById('reportsSearch').value = 'Критично';
            applyReportSearch();
        } else {
            loadReportData();
        }
    });
}

async function loadReportData() {
    const [stats, incidentStats, incidents, logs] = await Promise.all([
        getStats(),
        getIncidentStats().catch(() => ({})),
        getIncidents({ limit: 10 }).catch(() => []),
        getLogs({ limit: 50 }).catch(() => []),
    ]);
    updateCriticalTotal(stats);
    updateRiskLevel(stats);
    updateDashboardSummary(incidentStats, logs);
    buildReportRows(incidents, logs);
    applyReportSearch();
    persistRecentAction({ title: window.location.pathname === '/' ? 'Панель SOC' : 'Отчёты', url: window.location.href, ts: new Date().toISOString() });
}

function updateCriticalTotal(stats) {
    const severity = stats.severity || {};
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const totalElement = document.getElementById('criticalTotal');
    const mirrorElement = document.getElementById('criticalTotalMirror');
    const trendElement = document.getElementById('criticalTrend');
    const updatedElement = document.getElementById('lastUpdated');
    if (totalElement) totalElement.textContent = criticalCount.toLocaleString('ru-RU');
    if (mirrorElement) mirrorElement.textContent = criticalCount.toLocaleString('ru-RU');
    if (trendElement) trendElement.textContent = 'обновлено только что';
    if (updatedElement) updatedElement.textContent = `Последнее обновление: ${new Date().toLocaleTimeString('ru-RU')}`;
}

function updateRiskLevel(stats) {
    const severity = stats.severity || {};
    const total = stats.total_events || 1;
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const ratio = criticalCount / total;
    let level = 'Низкий';
    let hint = 'Система выглядит стабильно';
    if (ratio > 0.2) {
        level = 'Критично';
        hint = 'Нужно немедленное расследование';
    } else if (ratio > 0.05) {
        level = 'Требует внимания';
        hint = 'Есть события повышенного риска';
    }
    const levelElement = document.getElementById('riskLevel');
    const hintElement = document.getElementById('riskHint');
    if (levelElement) levelElement.textContent = level;
    if (hintElement) hintElement.textContent = hint;
}

function updateDashboardSummary(incidentStats, logs) {
    const openIncidents = incidentStats?.by_status?.open ?? incidentStats?.open ?? 0;
    const openCard = document.getElementById('openIncidentCard');
    const syncSidebar = document.getElementById('agentSync');
    const syncCard = document.getElementById('dashboardSyncStateText');
    const lastEventTs = logs?.[0]?.ts || null;
    const syncText = lastEventTs ? `Последнее событие ${formatAgo(lastEventTs)}` : 'Источники ещё не передавали данные';

    if (openCard) {
        openCard.textContent = openIncidents ? `${openIncidents.toLocaleString('ru-RU')} открыто` : 'Нет открытых';
    }
    if (syncSidebar) syncSidebar.textContent = syncText;
    if (syncCard) syncCard.textContent = lastEventTs ? 'Телеметрия поступает' : 'Ожидание';
}

function buildReportRows(incidents, logs) {
    reportRows = (incidents?.length ? incidents.map((incident) => ({
        statusLabel: getStatusMeta(incident.status).label,
        statusTone: getStatusMeta(incident.status).tone,
        time: formatDateTimeRu(incident.detected_at),
        type: incident.incident_type || 'Событие',
        source: incident.host || '--',
        severityLabel: getSeverityLabel(incident.severity),
        severityClass: getSeverityBadgeClass(incident.severity),
        link: `/incidents/details?id=INC-${incident.id}`,
    })) : logs.slice(0, 8).map((event) => ({
        statusLabel: 'Обработано',
        statusTone: 'success',
        time: formatDateTimeRu(event.ts),
        type: event.unit || event.source || 'Событие',
        source: event.host || '--',
        severityLabel: getSeverityLabel(event.severity),
        severityClass: getSeverityBadgeClass(event.severity),
        link: '/logs',
    })));
}

function getStatusDotClass(tone) {
    if (tone === 'danger') return 'status-dot status-dot--danger';
    if (tone === 'warning') return 'status-dot status-dot--warning';
    return 'status-dot status-dot--success';
}

function applyReportSearch() {
    const query = (document.getElementById('reportsSearch')?.value || '').trim().toLowerCase();
    const filtered = query ? reportRows.filter((row) => `${row.statusLabel} ${row.type} ${row.source} ${row.severityLabel}`.toLowerCase().includes(query)) : reportRows;
    renderReportRows(filtered);
}

function renderReportRows(rows) {
    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;
    tbody.innerHTML = rows.length ? rows.map((row) => `
        <tr>
            <td><span class="inline-actions"><span class="${getStatusDotClass(row.statusTone)}"></span>${escapeHtml(row.statusLabel)}</span></td>
            <td class="mono">${escapeHtml(row.time)}</td>
            <td><strong>${escapeHtml(row.type)}</strong></td>
            <td class="mono">${escapeHtml(row.source)}</td>
            <td><span class="${row.severityClass}">${escapeHtml(row.severityLabel)}</span></td>
            <td><div class="table-actions"><a href="${row.link}" class="action-link">Открыть</a></div></td>
        </tr>
    `).join('') : '<tr><td colspan="6" class="table-empty">Нет данных для отображения.</td></tr>';
}

function exportReportCsv() {
    if (!reportRows.length) return;
    const header = ['Статус', 'Время', 'Тип события', 'Источник', 'Важность'];
    const lines = [header.join(','), ...reportRows.map((row) => [row.statusLabel, row.time, row.type, row.source, row.severityLabel].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}