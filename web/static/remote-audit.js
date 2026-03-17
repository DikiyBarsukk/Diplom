const {
    checkPageAuth,
    createAutoRefreshController,
    escapeHtml,
    formatDateTimeRu,
    getSeverityBadgeClass,
    getSeverityLabel,
    setupGlobalSearch,
    setupLogout,
    persistRecentAction,
} = window.AppShell;
const { getIncidents, getLogs, getStats } = window.DataClient;

let reportRows = [];
let autoRefreshController = null;
const REPORT_PRESETS = [
    { label: 'За 24 часа', type: 'time', days: 1 },
    { label: 'За 7 дней', type: 'time', days: 7 },
    { label: 'По критичным', type: 'critical' },
    { label: 'По хосту', type: 'host' },
];

document.addEventListener('DOMContentLoaded', async () => {
    setupLogout('logoutBtn');
    setupGlobalSearch('reportsSearch', (query) => `/analytics?search=${encodeURIComponent(query)}`);
    installAnalyticsUx();
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        await loadReportData();
        setupReportActions();
        autoRefreshController = createAutoRefreshController(loadReportData, 30000);
        autoRefreshController.start();
    } catch (error) {
        console.error(error);
    }
});

function installAnalyticsUx() {
    const controls = document.querySelector('.flex.gap-3');
    if (controls && !document.getElementById('analyticsPresetFilters')) {
        const box = document.createElement('div');
        box.id = 'analyticsPresetFilters';
        box.className = 'w-full flex flex-wrap gap-2 mt-3';
        box.innerHTML = REPORT_PRESETS.map((preset, index) => `<button data-preset-index="${index}" class="px-3 py-1.5 rounded-lg border border-border-dark text-xs font-bold text-text-muted hover:text-white hover:border-primary/50 transition-colors">${preset.label}</button>`).join('') + '<button id="copyReportSummaryBtn" class="px-3 py-1.5 rounded-lg border border-primary/40 text-xs font-bold text-primary hover:bg-primary/10 transition-colors">Скопировать сводку</button>';
        controls.parentElement.appendChild(box);
    }
}

async function loadReportData() {
    const [stats, incidents, logs] = await Promise.all([
        getStats(),
        getIncidents({ limit: 10 }).catch(() => []),
        getLogs({ limit: 50 }).catch(() => []),
    ]);
    updateCriticalTotal(stats);
    updateRiskLevel(stats);
    buildReportRows(incidents, logs);
    applyReportSearch();
    persistRecentAction({ title: 'Отчеты', url: window.location.href, ts: new Date().toISOString() });
}

function updateCriticalTotal(stats) {
    const severity = stats.severity || {};
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const totalElement = document.getElementById('criticalTotal');
    const trendElement = document.getElementById('criticalTrend');
    if (totalElement) totalElement.textContent = criticalCount.toLocaleString('ru-RU');
    if (trendElement) trendElement.innerHTML = '<span class="material-symbols-outlined text-[16px]">schedule</span> обновлено только что';
}

function updateRiskLevel(stats) {
    const severity = stats.severity || {};
    const total = stats.total_events || 1;
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const ratio = criticalCount / total;
    let level = 'Низкий';
    let hint = 'Система в норме';
    if (ratio > 0.2) {
        level = 'Критично';
        hint = 'Нужно расследование';
    } else if (ratio > 0.05) {
        level = 'Требует внимания';
        hint = 'Есть события повышенного риска';
    }
    const levelElement = document.getElementById('riskLevel');
    const hintElement = document.getElementById('riskHint');
    if (levelElement) levelElement.textContent = level;
    if (hintElement) hintElement.innerHTML = `<span class="material-symbols-outlined text-[16px]">insights</span> ${hint}`;
}

function buildReportRows(incidents, logs) {
    reportRows = (incidents?.length ? incidents.map((incident) => ({
        statusLabel: window.AppShell.getStatusMeta(incident.status).label,
        statusDot: window.AppShell.getStatusMeta(incident.status).tone === 'danger' ? 'bg-red-500' : window.AppShell.getStatusMeta(incident.status).tone === 'warning' ? 'bg-yellow-500' : 'bg-emerald-500',
        time: formatDateTimeRu(incident.detected_at),
        type: incident.incident_type || 'Событие',
        source: incident.host || '--',
        severityLabel: getSeverityLabel(incident.severity),
        severityClass: getSeverityBadgeClass(incident.severity),
        link: `/incidents/details?id=INC-${incident.id}`,
    })) : logs.slice(0, 8).map((event) => ({
        statusLabel: 'Обработано',
        statusDot: 'bg-emerald-500',
        time: formatDateTimeRu(event.ts),
        type: event.unit || event.source || 'Событие',
        source: event.host || '--',
        severityLabel: getSeverityLabel(event.severity),
        severityClass: getSeverityBadgeClass(event.severity),
        link: '/logs',
    })));
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
        <tr class="hover:bg-border-dark/30 transition-colors">
            <td class="px-6 py-4"><span class="flex items-center gap-2"><span class="size-2 ${row.statusDot} rounded-full"></span> ${escapeHtml(row.statusLabel)}</span></td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(row.time)}</td>
            <td class="px-6 py-4 font-medium">${escapeHtml(row.type)}</td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(row.source)}</td>
            <td class="px-6 py-4"><span class="px-2 py-1 ${row.severityClass} rounded text-[10px] font-bold">${escapeHtml(row.severityLabel)}</span></td>
            <td class="px-6 py-4 text-right"><a href="${row.link}" class="material-symbols-outlined text-text-muted hover:text-white">open_in_new</a></td>
        </tr>
    `).join('') : '<tr><td colspan="6" class="px-6 py-6 text-text-muted text-sm">Нет данных для отображения.</td></tr>';
}

function setupReportActions() {
    document.getElementById('reportsSearch')?.addEventListener('input', applyReportSearch);
    document.getElementById('previewReportBtn')?.addEventListener('click', loadReportData);
    document.getElementById('generateReportBtn')?.addEventListener('click', exportReportCsv);
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
    document.getElementById('copyReportSummaryBtn')?.addEventListener('click', async () => {
        const summary = `Критичные события: ${document.getElementById('criticalTotal')?.textContent || '0'}\nРиск: ${document.getElementById('riskLevel')?.textContent || 'Н/Д'}\nПодсказка: ${document.getElementById('riskHint')?.textContent || ''}`;
        await navigator.clipboard.writeText(summary);
        const btn = document.getElementById('copyReportSummaryBtn');
        if (btn) {
            btn.textContent = 'Сводка скопирована';
            setTimeout(() => { btn.textContent = 'Скопировать сводку'; }, 1500);
        }
    });
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
