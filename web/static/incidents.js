/**
 * Incident Management page - BARSUKSIEM
 */
const API_BASE = window.location.origin;
let csrfToken = null;
let allIncidents = [];

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkAuth();
        await loadIncidentTypes();
        await loadIncidents();
        setupEventListeners();
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
    if (res.ok) {
        const user = await res.json();
        csrfToken = user.csrf_token || csrfToken;
        document.getElementById('username').textContent = user.username || 'Аудитор';
    }
}

async function authenticatedFetch(url, options = {}) {
    const headers = {
        ...options.headers
    };
    if (csrfToken && options.method && options.method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(url, { ...options, credentials: 'include', headers });
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return res;
}

function setupEventListeners() {
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        authenticatedFetch('/api/auth/logout', { method: 'POST' })
            .catch(() => {})
            .finally(() => {
                window.location.href = '/login';
            });
    });

    document.getElementById('refreshBtn')?.addEventListener('click', loadIncidents);
    document.getElementById('severityFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('statusFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('typeFilter')?.addEventListener('change', loadIncidents);
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            loadIncidents();
        }, 400));
    }
    document.getElementById('exportIncidentsBtn')?.addEventListener('click', exportIncidentsCsv);
}

async function loadIncidentTypes() {
    try {
        const res = await authenticatedFetch(`${API_BASE}/api/incidents/rules`);
        if (res.ok) {
            const rules = await res.json();
            const select = document.getElementById('typeFilter');
            if (Array.isArray(rules) && select) {
                const types = new Set();
                rules.forEach(r => {
                    const val = r.incident_type || r.rule_id || '';
                    if (val && !types.has(val)) {
                        types.add(val);
                        const opt = document.createElement('option');
                        opt.value = val;
                        opt.textContent = r.name || r.rule_id || r.incident_type || val;
                        select.appendChild(opt);
                    }
                });
            }
        }
    } catch (e) {
        console.warn('Could not load incident types', e);
    }
}

async function loadIncidents() {
    const severity = document.getElementById('severityFilter')?.value;
    const status = document.getElementById('statusFilter')?.value;
    const type = document.getElementById('typeFilter')?.value;
    const search = document.getElementById('searchInput')?.value?.trim();

    let url = `${API_BASE}/api/incidents?limit=100`;
    if (severity) url += `&severity=${severity}`;
    if (status) url += `&status=${status}`;
    if (type) url += `&incident_type=${type}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;

    try {
        const res = await authenticatedFetch(url);
        const incidents = res.ok ? await res.json() : [];

        const statsRes = await authenticatedFetch(`${API_BASE}/api/incidents/stats`);
        const stats = statsRes.ok ? await statsRes.json() : {};
        const openCount = stats.by_status?.open ?? 0;
        const badge = document.getElementById('incidents-badge');
        if (badge) {
            badge.textContent = openCount;
            badge.style.display = openCount > 0 ? 'inline-flex' : 'none';
        }

        allIncidents = incidents;
        renderIncidents(incidents);
        updateTableInfo(incidents.length);
    } catch (e) {
        document.getElementById('incidentsTableBody').innerHTML =
            '<tr><td colspan="7" class="py-8 text-center text-danger">Ошибка загрузки инцидентов</td></tr>';
    }
}

function applySearchFilter() {
    const query = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
    if (!query) return allIncidents;
    return allIncidents.filter(inc => {
        const fields = [
            inc.title,
            inc.description,
            inc.details,
            inc.host,
            inc.incident_type,
            inc.rule_id,
            inc.id ? `INC-${inc.id}` : ''
        ].filter(Boolean).join(' ').toLowerCase();
        return fields.includes(query);
    });
}

function debounce(fn, wait) {
    let t;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

function updateTableInfo(count) {
    const info = document.getElementById('table-info');
    if (info) info.textContent = `Показано: ${count}`;
}

function setupAutoRefresh() {
    setInterval(loadIncidents, 30000);
}

function exportIncidentsCsv() {
    const rows = applySearchFilter();
    if (!rows.length) return;
    const header = ['ID', 'Название', 'Тип', 'Статус', 'Важность', 'Хост', 'Обнаружен'];
    const lines = [
        header.join(','),
        ...rows.map(inc => {
            const id = inc.id ? `INC-${inc.id}` : inc.rule_id || 'INC-—';
            const status = (inc.status || 'open').toLowerCase();
            const statusLabel = status === 'open' ? 'открыт' : status === 'investigating' ? 'расследуется' : 'закрыт';
            const sev = (inc.severity || 'info').toLowerCase();
            const sevLabel = sev === 'critical' ? 'критическая' : sev === 'high' ? 'высокая' : sev === 'medium' ? 'средняя' : sev === 'low' ? 'низкая' : 'инфо';
            const detected = inc.detected_at ? new Date(inc.detected_at).toLocaleString('ru-RU') : '--';
            return [
                id,
                inc.title || '',
                inc.incident_type || '',
                statusLabel,
                sevLabel,
                inc.host || '',
                detected
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        })
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `incidents_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function renderIncidents(incidents) {
    const tbody = document.getElementById('incidentsTableBody');
    if (!incidents || incidents.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="py-8 text-center text-[#92b7c9]">Инциденты не найдены</td></tr>';
        updateTableInfo(0);
        return;
    }

    tbody.innerHTML = incidents.map(inc => {
        const sev = (inc.severity || 'info').toLowerCase();
        const sevClass = sev === 'critical' ? 'bg-danger/20 text-danger' : sev === 'high' ? 'bg-warning/20 text-warning' : sev === 'medium' ? 'bg-primary/20 text-primary' : 'bg-success/20 text-success';
        const status = (inc.status || 'open').toLowerCase();
        const statusClass = status === 'open' ? 'text-danger' : status === 'investigating' ? 'text-warning' : 'text-success';
        const sevLabel = sev === 'critical' ? 'критическая' : sev === 'high' ? 'высокая' : sev === 'medium' ? 'средняя' : sev === 'low' ? 'низкая' : 'инфо';
        const statusLabel = status === 'open' ? 'открыт' : status === 'investigating' ? 'расследуется' : 'закрыт';
        const detected = inc.detected_at ? new Date(inc.detected_at).toLocaleString('ru-RU') : '--';
        const incidentId = inc.id ? `INC-${inc.id}` : inc.rule_id || 'INC-—';
        const detailsUrl = `/incidents/details?id=${encodeURIComponent(incidentId)}`;

        return `
            <tr class="border-b border-border-muted/50 hover:bg-surface/30">
                <td class="py-3 px-4">
                    <input class="rounded bg-slate-100 dark:bg-[#233c48] border-slate-300 dark:border-slate-700 text-primary focus:ring-primary/50" type="checkbox"/>
                </td>
                <td class="py-3 px-4 font-mono text-sm font-bold text-primary">
                    <a class="hover:underline" href="${detailsUrl}">${escapeHtml(incidentId)}</a>
                </td>
                <td class="py-3 px-4">
                    <div class="flex flex-col">
                        <span class="text-sm font-semibold truncate">${escapeHtml(inc.title || 'Без названия')}</span>
                        <span class="text-xs text-[#92b7c9] truncate">${escapeHtml(inc.description || inc.details || '')}</span>
                    </div>
                </td>
                <td class="py-3 px-4 ${statusClass} capitalize">${statusLabel}</td>
                <td class="py-3 px-4">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${sevClass}">${sevLabel}</span>
                </td>
                <td class="py-3 px-4 font-mono text-xs">${escapeHtml(inc.host || '--')}</td>
                <td class="py-3 px-4 text-xs text-[#92b7c9]">${detected}</td>
            </tr>
        `;
    }).join('');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
