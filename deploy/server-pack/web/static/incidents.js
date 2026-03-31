const {
    authenticatedFetch,
    checkPageAuth,
    debounce,
    escapeHtml,
    formatDateTimeRu,
    getSeverityBadgeClass,
    getSeverityLabel,
    getStatusBadgeClass,
    getStatusMeta,
    setupLogout,
    setupGlobalSearch,
    buildLogsUrl,
    copyText,
    persistRecentAction,
    saveFavoriteFilter,
    getFavoriteFilters,
    setText,
} = window.AppShell;
const { getIncidents } = window.DataClient;

let allIncidents = [];
const PRESETS = [
    { label: 'Открытые', params: { status: 'open' } },
    { label: 'Критичные', params: { severity: 'critical' } },
    { label: 'Brute Force', params: { incident_type: 'brute_force' } },
    { label: 'Ночные логины', params: { incident_type: 'unauthorized_access' } },
];

document.addEventListener('DOMContentLoaded', async () => {
    setupLogout('logoutBtn');
    setupGlobalSearch('searchInput', (query) => `/incidents?search=${encodeURIComponent(query)}`);
    renderPresetButtons();
    applyUrlFilters();
    setupEventListeners();
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        await loadIncidentTypes();
        await loadIncidents();
    } catch (error) {
        console.error(error);
    }
    setInterval(loadIncidents, 30000);
});

function renderPresetButtons() {
    const container = document.getElementById('incidentPresetFilters');
    if (container) {
        container.innerHTML = PRESETS.map((preset, index) => `<button data-preset-index="${index}" class="pill-button">${preset.label}</button>`).join('');
    }
    renderFavoriteFilters();
}

function renderFavoriteFilters() {
    const container = document.getElementById('incidentFavoriteFilters');
    if (!container) return;
    const items = getFavoriteFilters().filter((item) => item.params && ('status' in item.params || 'incident_type' in item.params || 'severity' in item.params));
    if (!items.length) {
        container.innerHTML = '<p class="helper-text">Нет сохранённых наборов.</p>';
        return;
    }
    container.innerHTML = items.map((item, index) => `<button data-favorite-index="${index}" class="favorite-item action-link muted-link">${escapeHtml(item.name)}</button>`).join('');
    container.onclick = async (event) => {
        const button = event.target.closest('[data-favorite-index]');
        if (!button) return;
        applyFilters(items[Number(button.dataset.favoriteIndex)].params);
        await loadIncidents();
    };
}

function setupEventListeners() {
    document.getElementById('incidentPresetFilters')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-preset-index]');
        if (!button) return;
        applyFilters(PRESETS[Number(button.dataset.presetIndex)].params);
        await loadIncidents();
    });
    document.getElementById('incidentResetFiltersBtn')?.addEventListener('click', async () => {
        applyFilters({});
        await loadIncidents();
    });
    document.getElementById('incidentSaveFilterBtn')?.addEventListener('click', () => {
        saveFavoriteFilter({ name: `Инциденты ${new Date().toLocaleTimeString('ru-RU')}`, params: getCurrentFilters() });
        renderFavoriteFilters();
    });
    document.getElementById('refreshBtn')?.addEventListener('click', loadIncidents);
    document.getElementById('severityFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('statusFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('typeFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('searchInput')?.addEventListener('input', debounce(loadIncidents, 350));
    document.getElementById('exportIncidentsBtn')?.addEventListener('click', exportIncidentsCsv);
    document.getElementById('incidentsTableBody')?.addEventListener('click', async (event) => {
        const action = event.target.closest('[data-action]');
        const row = event.target.closest('tr[data-incident-id]');
        if (!row) return;
        const incidentId = row.dataset.incidentId;
        const host = row.dataset.incidentHost || '';
        if (action) {
            if (action.dataset.action === 'open') {
                window.location.href = `/incidents/details?id=${encodeURIComponent(incidentId)}`;
            } else if (action.dataset.action === 'logs') {
                const url = buildLogsUrl({ host, search: incidentId });
                persistRecentAction({ title: `Связанные логи ${incidentId}`, url, ts: new Date().toISOString() });
                window.location.href = url;
            } else if (action.dataset.action === 'copy') {
                await copyText(incidentId);
                action.textContent = 'Скопировано';
                setTimeout(() => { action.textContent = 'Скопировать ID'; }, 1200);
            }
            return;
        }
        window.location.href = `/incidents/details?id=${encodeURIComponent(incidentId)}`;
    });
}

function getCurrentFilters() {
    return {
        severity: document.getElementById('severityFilter')?.value || '',
        status: document.getElementById('statusFilter')?.value || '',
        incident_type: document.getElementById('typeFilter')?.value || '',
        search: document.getElementById('searchInput')?.value.trim() || '',
    };
}

function applyUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    applyFilters({
        severity: params.get('severity') || '',
        status: params.get('status') || '',
        incident_type: params.get('incident_type') || '',
        search: params.get('search') || '',
    });
}

function applyFilters(filters) {
    document.getElementById('severityFilter').value = filters.severity || '';
    document.getElementById('statusFilter').value = filters.status || '';
    document.getElementById('typeFilter').value = filters.incident_type || '';
    document.getElementById('searchInput').value = filters.search || '';
}

function syncUrl(filters) {
    const url = new URL(window.location.href);
    ['severity', 'status', 'incident_type', 'search'].forEach((key) => {
        if (filters[key]) url.searchParams.set(key, filters[key]);
        else url.searchParams.delete(key);
    });
    window.history.replaceState({}, '', url);
}

async function loadIncidentTypes() {
    try {
        const response = await authenticatedFetch('/api/incidents/rules');
        if (!response.ok) return;
        const rules = await response.json();
        const select = document.getElementById('typeFilter');
        if (!select) return;
        const currentValue = select.value;
        const options = ['<option value="">Все типы</option>'];
        const unique = new Map();
        (rules || []).forEach((rule) => {
            if (rule.incident_type && !unique.has(rule.incident_type)) unique.set(rule.incident_type, rule.name || rule.incident_type);
        });
        unique.forEach((name, value) => options.push(`<option value="${escapeHtml(value)}">${escapeHtml(name)}</option>`));
        select.innerHTML = options.join('');
        select.value = currentValue;
    } catch (error) {
        console.warn('Could not load incident types', error);
    }
}

async function loadIncidents() {
    const filters = getCurrentFilters();
    syncUrl(filters);
    try {
        const incidents = await getIncidents({
            severity: filters.severity || null,
            status: filters.status || null,
            incident_type: filters.incident_type || null,
            search: filters.search || null,
            limit: 100,
        });
        const statsResponse = await authenticatedFetch('/api/incidents/stats');
        const stats = statsResponse.ok ? await statsResponse.json() : {};
        const openCount = stats.by_status?.open ?? stats.open ?? 0;
        const badge = document.getElementById('incidents-badge');
        if (badge) {
            badge.textContent = openCount;
            badge.style.display = openCount > 0 ? 'inline-flex' : 'none';
        }
        allIncidents = Array.isArray(incidents) ? incidents : [];
        renderIncidents(allIncidents);
        setText('table-info', allIncidents.length ? `Показано ${allIncidents.length} инцидентов` : 'Инциденты по выбранным фильтрам не найдены');
        const parts = [];
        if (filters.status) parts.push(`статус: ${filters.status}`);
        if (filters.severity) parts.push(`важность: ${filters.severity}`);
        if (filters.incident_type) parts.push(`тип: ${filters.incident_type}`);
        if (filters.search) parts.push(`поиск: ${filters.search}`);
        setText('incidentResultSummary', parts.length ? `Активные фильтры: ${parts.join(', ')}` : 'Без дополнительных фильтров');
        persistRecentAction({ title: 'Инциденты', url: window.location.href, ts: new Date().toISOString() });
    } catch (error) {
        console.error(error);
        document.getElementById('incidentsTableBody').innerHTML = '<tr><td colspan="8" class="table-empty text-danger">Не удалось загрузить инциденты</td></tr>';
    }
}

function exportIncidentsCsv() {
    if (!allIncidents.length) return;
    const header = ['ID', 'Название', 'Тип', 'Статус', 'Важность', 'Хост', 'Обнаружен'];
    const lines = [
        header.join(','),
        ...allIncidents.map((incident) => [
            incident.id ? `INC-${incident.id}` : incident.rule_id || 'INC-—',
            incident.title || '',
            incident.incident_type || '',
            getStatusMeta(incident.status).label,
            getSeverityLabel(incident.severity),
            incident.host || '',
            formatDateTimeRu(incident.detected_at),
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `incidents_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function renderIncidents(incidents) {
    const tbody = document.getElementById('incidentsTableBody');
    if (!tbody) return;
    if (!incidents.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="table-empty">Инциденты по выбранным фильтрам не найдены</td></tr>';
        return;
    }
    tbody.innerHTML = incidents.map((incident) => {
        const incidentId = incident.id ? `INC-${incident.id}` : incident.rule_id || 'INC-—';
        const statusMeta = getStatusMeta(incident.status);
        const detected = formatDateTimeRu(incident.detected_at);
        return `
            <tr data-incident-id="${escapeHtml(incidentId)}" data-incident-host="${escapeHtml(incident.host || '')}">
                <td><input type="checkbox"></td>
                <td class="mono"><strong>${escapeHtml(incidentId)}</strong></td>
                <td><div class="stack"><strong>${escapeHtml(incident.title || 'Без названия')}</strong><span class="helper-text">${escapeHtml(incident.description || incident.details || '')}</span></div></td>
                <td><span class="${getStatusBadgeClass(incident.status)}">${statusMeta.label}</span></td>
                <td><span class="${getSeverityBadgeClass(incident.severity)}">${getSeverityLabel(incident.severity)}</span></td>
                <td class="mono">${escapeHtml(incident.host || '--')}</td>
                <td class="mono">${detected}</td>
                <td><div class="table-actions"><button data-action="open" class="action-link">Открыть</button><button data-action="logs" class="action-link muted-link">Связанные логи</button><button data-action="copy" class="action-link muted-link">Скопировать ID</button></div></td>
            </tr>
        `;
    }).join('');
}
