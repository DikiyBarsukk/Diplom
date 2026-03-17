const {
    apiBase: API_BASE,
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
const { getIncidentStats, getIncidents, fetchJson } = window.DataClient || {};

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
    installIncidentUx();
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

function installIncidentUx() {
    const toolbar = document.querySelector('.flex.flex-wrap.items-center.justify-between.p-4.gap-4');
    if (toolbar && !document.getElementById('incidentPresetFilters')) {
        const presetBox = document.createElement('div');
        presetBox.id = 'incidentPresetFilters';
        presetBox.className = 'w-full flex flex-wrap gap-2 items-center';
        presetBox.innerHTML = PRESETS.map((preset, index) => `
            <button data-preset-index="${index}" class="px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-100 dark:bg-[#233c48] border border-slate-200 dark:border-[#233c48] hover:bg-slate-200 dark:hover:bg-[#2d4d5c] transition-colors">${preset.label}</button>
        `).join('') + `
            <button id="incidentResetFiltersBtn" class="px-3 py-1.5 text-xs font-bold rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors">Сбросить фильтры</button>
            <button id="incidentSaveFilterBtn" class="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-300 dark:border-[#233c48] text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-[#233c48] transition-colors">Сохранить фильтр</button>
            <span id="incidentResultSummary" class="text-xs text-slate-500 dark:text-[#92b7c9]"></span>
        `;
        toolbar.appendChild(presetBox);
    }

    const tableHeader = document.querySelector('table thead tr');
    if (tableHeader && !document.getElementById('incidentActionsHeader')) {
        const th = document.createElement('th');
        th.id = 'incidentActionsHeader';
        th.className = 'p-4 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-[#92b7c9] text-right';
        th.textContent = 'Действия';
        tableHeader.appendChild(th);
    }

    const footer = document.getElementById('table-info')?.parentElement;
    if (footer && !document.getElementById('incidentFavoritesWrap')) {
        const wrap = document.createElement('div');
        wrap.id = 'incidentFavoritesWrap';
        wrap.className = 'px-4 py-3 border-t border-slate-200 dark:border-[#233c48] bg-white/40 dark:bg-[#101c22]/40';
        wrap.innerHTML = '<div class="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-[#92b7c9] mb-2">Избранные фильтры</div><div id="incidentFavoriteFilters" class="flex flex-wrap gap-2"></div>';
        footer.after(wrap);
    }

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
    renderFavoriteFilters();
}

function renderFavoriteFilters() {
    const container = document.getElementById('incidentFavoriteFilters');
    if (!container) return;
    const items = getFavoriteFilters().filter((item) => item.params && ('status' in item.params || 'incident_type' in item.params || 'severity' in item.params));
    if (!items.length) {
        container.innerHTML = '<span class="text-xs text-slate-500 dark:text-[#92b7c9]">Нет сохраненных наборов</span>';
        return;
    }
    container.innerHTML = items.map((item, index) => `<button data-favorite-index="${index}" class="px-2.5 py-1 text-xs rounded border border-slate-200 dark:border-[#233c48] hover:bg-slate-100 dark:hover:bg-[#233c48] transition-colors">${escapeHtml(item.name)}</button>`).join('');
    container.onclick = async (event) => {
        const button = event.target.closest('[data-favorite-index]');
        if (!button) return;
        applyFilters(items[Number(button.dataset.favoriteIndex)].params);
        await loadIncidents();
    };
}

function setupEventListeners() {
    document.getElementById('refreshBtn')?.addEventListener('click', loadIncidents);
    document.getElementById('severityFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('statusFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('typeFilter')?.addEventListener('change', loadIncidents);
    document.getElementById('searchInput')?.addEventListener('input', debounce(loadIncidents, 400));
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
            }
            if (action.dataset.action === 'logs') {
                const url = buildLogsUrl({ host, search: incidentId });
                persistRecentAction({ title: `Связанные логи ${incidentId}`, url, ts: new Date().toISOString() });
                window.location.href = url;
            }
            if (action.dataset.action === 'copy') {
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
        const response = await authenticatedFetch(`${API_BASE}/api/incidents/rules`);
        if (!response.ok) return;
        const rules = await response.json();
        const select = document.getElementById('typeFilter');
        const currentValue = select.value;
        if (select) {
            const options = ['<option value="">Все</option>'];
            const unique = new Map();
            (rules || []).forEach((rule) => {
                if (rule.incident_type && !unique.has(rule.incident_type)) unique.set(rule.incident_type, rule.name || rule.incident_type);
            });
            unique.forEach((name, value) => options.push(`<option value="${escapeHtml(value)}">${escapeHtml(name)}</option>`));
            select.innerHTML = options.join('');
            select.value = currentValue;
        }
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
        const statsResponse = await authenticatedFetch(`${API_BASE}/api/incidents/stats`);
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
        document.getElementById('incidentsTableBody').innerHTML = '<tr><td colspan="8" class="p-6 text-center text-danger">Не удалось загрузить инциденты</td></tr>';
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
        tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-500 dark:text-[#92b7c9]">Инциденты по выбранным фильтрам не найдены</td></tr>';
        return;
    }

    tbody.innerHTML = incidents.map((incident) => {
        const incidentId = incident.id ? `INC-${incident.id}` : incident.rule_id || 'INC-—';
        const statusMeta = getStatusMeta(incident.status);
        const detected = formatDateTimeRu(incident.detected_at);
        return `
            <tr data-incident-id="${escapeHtml(incidentId)}" data-incident-host="${escapeHtml(incident.host || '')}" class="border-b border-border-muted/50 hover:bg-surface/30 cursor-pointer transition-colors">
                <td class="py-3 px-4"><input class="rounded bg-slate-100 dark:bg-[#233c48] border-slate-300 dark:border-slate-700 text-primary focus:ring-primary/50" type="checkbox"/></td>
                <td class="py-3 px-4 font-mono text-sm font-bold text-primary">${escapeHtml(incidentId)}</td>
                <td class="py-3 px-4"><div class="flex flex-col"><span class="text-sm font-semibold truncate">${escapeHtml(incident.title || 'Без названия')}</span><span class="text-xs text-[#92b7c9] truncate">${escapeHtml(incident.description || incident.details || '')}</span></div></td>
                <td class="py-3 px-4"><span class="px-2 py-1 rounded text-[10px] font-bold ${getStatusBadgeClass(incident.status)}">${statusMeta.label}</span></td>
                <td class="py-3 px-4"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getSeverityBadgeClass(incident.severity)}">${getSeverityLabel(incident.severity)}</span></td>
                <td class="py-3 px-4 font-mono text-xs">${escapeHtml(incident.host || '--')}</td>
                <td class="py-3 px-4 text-xs text-[#92b7c9]">${detected}</td>
                <td class="py-3 px-4 text-right">
                    <div class="flex justify-end gap-2">
                        <button data-action="open" class="text-xs font-bold text-primary hover:underline">Открыть</button>
                        <button data-action="logs" class="text-xs font-bold text-slate-500 dark:text-[#92b7c9] hover:text-primary">Связанные логи</button>
                        <button data-action="copy" class="text-xs font-bold text-slate-500 dark:text-[#92b7c9] hover:text-primary">Скопировать ID</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}
