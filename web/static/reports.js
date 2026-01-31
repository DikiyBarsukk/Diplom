const API_BASE = window.location.origin;
let reportRows = [];
let autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkAuth();
        await loadReportData();
        setupReportActions();
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

async function loadReportData() {
    const [statsRes, incidentsRes, logsRes] = await Promise.all([
        fetch(`${API_BASE}/stats`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/incidents?limit=10`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/logs?limit=50`, { credentials: 'include' }).catch(() => null),
    ]);

    const stats = statsRes.ok ? await statsRes.json() : {};
    const incidents = incidentsRes?.ok ? await incidentsRes.json() : [];
    const logs = logsRes?.ok ? await logsRes.json() : [];

    updateCriticalTotal(stats);
    updateRiskLevel(stats);
    buildReportRows(incidents, logs);
    applyReportSearch();
}

function updateCriticalTotal(stats) {
    const severity = stats.severity || {};
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const totalEl = document.getElementById('criticalTotal');
    const trendEl = document.getElementById('criticalTrend');
    if (totalEl) totalEl.textContent = criticalCount.toLocaleString('ru-RU');
    if (trendEl) trendEl.innerHTML = '<span class="material-symbols-outlined text-[16px]">trending_up</span> 0%';
}

function updateRiskLevel(stats) {
    const severity = stats.severity || {};
    const total = stats.total_events || 1;
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const ratio = criticalCount / total;

    let level = 'НИЗКИЙ';
    let hint = 'Нормальная зона';
    if (ratio > 0.2) {
        level = 'ВЫСОКИЙ';
        hint = 'Критическая зона';
    } else if (ratio > 0.05) {
        level = 'СРЕДНИЙ';
        hint = 'Зона внимания';
    }

    const levelEl = document.getElementById('riskLevel');
    const hintEl = document.getElementById('riskHint');
    if (levelEl) levelEl.textContent = level;
    if (hintEl) hintEl.innerHTML = `<span class="material-symbols-outlined text-[16px]">warning</span> ${hint}`;
}

function buildReportRows(incidents, logs) {
    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;

    reportRows = [];
    if (Array.isArray(incidents) && incidents.length) {
        reportRows = incidents.map(inc => {
            const status = (inc.status || 'open').toLowerCase();
            const statusLabel = status === 'open' ? 'Активно' : status === 'investigating' ? 'Расследуется' : 'Закрыто';
            const statusDot = status === 'open' ? 'bg-red-500' : status === 'investigating' ? 'bg-yellow-500' : 'bg-emerald-500';
            const time = inc.detected_at ? new Date(inc.detected_at).toLocaleString('ru-RU') : '--';
            const type = inc.incident_type || 'Событие';
            const source = inc.host || '--';
            const sev = (inc.severity || 'info').toLowerCase();
            const sevLabel = sev === 'critical' ? 'КРИТИЧЕСКИЙ' : sev === 'high' ? 'ВЫСОКИЙ' : sev === 'medium' ? 'СРЕДНИЙ' : 'НИЗКИЙ';
            const sevClass = sev === 'critical' ? 'text-red-400 bg-red-900/30' : sev === 'high' ? 'text-orange-400 bg-orange-900/30' : sev === 'medium' ? 'text-yellow-400 bg-yellow-900/30' : 'text-emerald-400 bg-emerald-900/30';
            return {
                statusLabel,
                statusDot,
                time,
                type,
                source,
                sevLabel,
                sevClass,
                link: `/incidents/details?id=INC-${inc.id}`
            };
        });
    } else if (Array.isArray(logs) && logs.length) {
        reportRows = logs.slice(0, 8).map(ev => {
            const time = ev.ts ? new Date(ev.ts).toLocaleString('ru-RU') : '--';
            const type = ev.unit || ev.source || 'Событие';
            const source = ev.host || '--';
            const sev = (ev.severity || 'info').toLowerCase();
            const sevLabel = sev === 'emerg' || sev === 'alert' || sev === 'crit' ? 'КРИТИЧЕСКИЙ' : sev === 'err' ? 'ВЫСОКИЙ' : sev === 'warn' ? 'СРЕДНИЙ' : 'НИЗКИЙ';
            const sevClass = sevLabel === 'КРИТИЧЕСКИЙ' ? 'text-red-400 bg-red-900/30' : sevLabel === 'ВЫСОКИЙ' ? 'text-orange-400 bg-orange-900/30' : sevLabel === 'СРЕДНИЙ' ? 'text-yellow-400 bg-yellow-900/30' : 'text-emerald-400 bg-emerald-900/30';
            return {
                statusLabel: 'Обработано',
                statusDot: 'bg-emerald-500',
                time,
                type,
                source,
                sevLabel,
                sevClass,
                link: '/logs'
            };
        });
    }
}

function applyReportSearch() {
    const query = (document.getElementById('reportsSearch')?.value || '').trim().toLowerCase();
    const filtered = query
        ? reportRows.filter(row => `${row.statusLabel} ${row.time} ${row.type} ${row.source} ${row.sevLabel}`.toLowerCase().includes(query))
        : reportRows;
    renderReportRows(filtered);
}

function renderReportRows(rows) {
    const tbody = document.getElementById('reportTableBody');
    if (!tbody) return;
    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-6 text-text-muted text-sm">Нет данных для отображения.</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(row => `
        <tr class="hover:bg-border-dark/30 transition-colors">
            <td class="px-6 py-4"><span class="flex items-center gap-2"><span class="size-2 ${row.statusDot} rounded-full"></span> ${escapeHtml(row.statusLabel)}</span></td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(row.time)}</td>
            <td class="px-6 py-4 font-medium">${escapeHtml(row.type)}</td>
            <td class="px-6 py-4 font-mono text-xs">${escapeHtml(row.source)}</td>
            <td class="px-6 py-4"><span class="px-2 py-1 ${row.sevClass} rounded text-[10px] font-bold">${escapeHtml(row.sevLabel)}</span></td>
            <td class="px-6 py-4 text-right"><a href="${row.link}" class="material-symbols-outlined text-text-muted hover:text-white">open_in_new</a></td>
        </tr>
    `).join('');
}

function setupReportActions() {
    document.getElementById('reportsSearch')?.addEventListener('input', applyReportSearch);
    document.getElementById('previewReportBtn')?.addEventListener('click', loadReportData);
    document.getElementById('generateReportBtn')?.addEventListener('click', exportReportCsv);
}

function exportReportCsv() {
    if (!reportRows.length) return;
    const header = ['Статус', 'Время', 'Тип события', 'Источник', 'Важность'];
    const lines = [
        header.join(','),
        ...reportRows.map(row => [
            row.statusLabel,
            row.time,
            row.type,
            row.source,
            row.sevLabel
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadReportData, 30000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
