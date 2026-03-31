const {
    setupLogout,
    checkPageAuth,
    debounce,
    escapeHtml,
    formatAgo,
    formatDateTimeRu,
    getSeverityBadgeClass,
    getSeverityLabel,
    persistRecentAction,
    saveFavoriteFilter,
    getFavoriteFilters,
    buildLogsUrl,
    setupGlobalSearch,
    setText,
} = window.AppShell;
const { getLogs, getStats } = window.DataClient;

let allEvents = [];
let currentPage = 1;
let pageSize = 50;
let currentSort = { field: 'ts', direction: 'desc' };
let refreshInterval = 30000;
let autoRefreshTimer = null;

const PRESETS = [
    { label: 'Критичные', params: { severity: 'crit', time: '24h' } },
    { label: 'За 1 час', params: { time: '1h' } },
    { label: '4625', params: { search: '4625', time: '24h' } },
    { label: 'Ошибки входа', params: { search: 'login_failed', time: '24h' } },
    { label: 'PowerShell', params: { search: 'powershell', time: '24h' } },
    { label: 'Этот хост', params: { host: 'CURRENT_HOST', time: '24h' } },
];

document.addEventListener('DOMContentLoaded', async () => {
    setupLogout('logoutBtn');
    setupGlobalSearch('searchInput', (query) => buildLogsUrl({ search: query }));
    renderPresetButtons();
    bindEvents();
    applyUrlFilters();
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        await loadStats();
        await loadLogs();
        setupAutoRefresh();
    } catch (error) {
        console.error(error);
    }
});

function bindEvents() {
    document.getElementById('refreshBtn')?.addEventListener('click', async () => {
        currentPage = 1;
        await loadLogs();
    });
    document.getElementById('severityFilter')?.addEventListener('change', onFilterChanged);
    document.getElementById('hostFilter')?.addEventListener('change', onFilterChanged);
    document.getElementById('timeFilter')?.addEventListener('change', () => {
        handleTimeFilterChange();
        onFilterChanged();
    });
    document.getElementById('searchInput')?.addEventListener('input', debounce(onFilterChanged, 350));
    document.getElementById('exportBtn')?.addEventListener('click', exportToCSV);
    document.getElementById('prevPage')?.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage -= 1;
            sortAndDisplayEvents();
        }
    });
    document.getElementById('nextPage')?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(allEvents.length / pageSize));
        if (currentPage < totalPages) {
            currentPage += 1;
            sortAndDisplayEvents();
        }
    });
    document.querySelectorAll('.sortable').forEach((header) => {
        header.addEventListener('click', () => {
            const field = header.dataset.sort;
            if (!field) return;
            currentSort = currentSort.field === field
                ? { field, direction: currentSort.direction === 'asc' ? 'desc' : 'asc' }
                : { field, direction: 'desc' };
            updateSortIndicators();
            sortAndDisplayEvents();
        });
    });
    document.getElementById('logsTableBody')?.addEventListener('click', (event) => {
        const row = event.target.closest('tr[data-event-index]');
        if (!row) return;
        showEventDetails(Number(row.dataset.eventIndex));
    });
    document.getElementById('modalClose')?.addEventListener('click', closeEventModal);
    document.getElementById('settingsClose')?.addEventListener('click', closeSettingsModal);
    document.getElementById('settingsBtn')?.addEventListener('click', showSettings);
    document.getElementById('settingsSidebarBtn')?.addEventListener('click', showSettings);
    document.getElementById('refreshInterval')?.addEventListener('change', updateRefreshInterval);
    document.getElementById('autoRefreshEnabled')?.addEventListener('change', toggleAutoRefresh);
    document.getElementById('presetFilters')?.addEventListener('click', async (event) => {
        const button = event.target.closest('[data-preset-index]');
        if (!button) return;
        applyPreset(PRESETS[Number(button.dataset.presetIndex)]);
        await loadLogs();
    });
    document.getElementById('resetFiltersBtn')?.addEventListener('click', async () => {
        resetFilters();
        await loadLogs();
    });
    document.getElementById('saveFilterBtn')?.addEventListener('click', () => {
        saveFavoriteFilter({
            name: `Логи ${new Date().toLocaleTimeString('ru-RU')}`,
            params: getCurrentFilters(),
        });
        renderFavoriteFilters();
    });
    window.addEventListener('click', (event) => {
        const eventModal = document.getElementById('eventModal');
        const settingsModal = document.getElementById('settingsModal');
        if (event.target === eventModal) closeEventModal();
        if (event.target === settingsModal) closeSettingsModal();
    });
}

async function onFilterChanged() {
    currentPage = 1;
    await loadLogs();
}

function renderPresetButtons() {
    const container = document.getElementById('presetFilters');
    if (container) {
        container.innerHTML = PRESETS.map((preset, index) => `<button data-preset-index="${index}" class="pill-button">${preset.label}</button>`).join('');
    }
    renderFavoriteFilters();
}

function renderFavoriteFilters() {
    const container = document.getElementById('favoriteFiltersList');
    if (!container) return;
    const filters = getFavoriteFilters();
    if (!filters.length) {
        container.innerHTML = '<p class="helper-text">Сохранённых фильтров пока нет.</p>';
        return;
    }
    container.innerHTML = filters.map((filter, index) => `<button data-favorite-index="${index}" class="favorite-item action-link muted-link">${escapeHtml(filter.name)}</button>`).join('');
    container.onclick = async (event) => {
        const button = event.target.closest('[data-favorite-index]');
        if (!button) return;
        const selected = filters[Number(button.dataset.favoriteIndex)];
        applyFilters(selected.params || {});
        await loadLogs();
    };
}

function applyPreset(preset) {
    const params = { ...preset.params };
    if (params.host === 'CURRENT_HOST') {
        params.host = document.getElementById('hostFilter')?.value || '';
    }
    applyFilters(params);
}

function applyUrlFilters() {
    applyFilters(getUrlFilters());
}

function applyFilters(filters = {}) {
    document.getElementById('hostFilter').value = filters.host || '';
    document.getElementById('severityFilter').value = filters.severity || '';
    document.getElementById('searchInput').value = filters.search || '';
    document.getElementById('timeFilter').value = filters.time || '24h';
    handleTimeFilterChange();
}

function resetFilters() {
    applyFilters({ host: '', severity: '', search: '', time: '24h' });
}

function getUrlFilters() {
    const params = new URLSearchParams(window.location.search);
    return {
        host: params.get('host') || '',
        severity: params.get('severity') || '',
        search: params.get('search') || '',
        time: params.get('time') || '24h',
    };
}

function getCurrentFilters() {
    return {
        host: document.getElementById('hostFilter').value,
        severity: document.getElementById('severityFilter').value,
        search: document.getElementById('searchInput').value.trim(),
        time: document.getElementById('timeFilter').value,
    };
}

function syncUrl(filters) {
    const url = new URL(window.location.href);
    ['host', 'severity', 'search', 'time'].forEach((key) => {
        if (filters[key]) url.searchParams.set(key, filters[key]);
        else url.searchParams.delete(key);
    });
    window.history.replaceState({}, '', url);
}

function handleTimeFilterChange() {
    const timeFilter = document.getElementById('timeFilter').value;
    const customRange = document.getElementById('customDateRange');
    if (customRange) {
        customRange.classList.toggle('hidden', timeFilter !== 'custom');
    }
}

function getSinceValue() {
    const timeFilter = document.getElementById('timeFilter').value;
    const now = Date.now();
    const mapping = {
        '1h': 3600000,
        '6h': 21600000,
        '24h': 86400000,
        '7d': 604800000,
    };
    if (mapping[timeFilter]) {
        return new Date(now - mapping[timeFilter]).toISOString();
    }
    if (timeFilter === 'custom') {
        const dateValue = document.getElementById('dateFrom').value;
        return dateValue ? new Date(dateValue).toISOString() : null;
    }
    return null;
}

async function loadStats() {
    try {
        const stats = await getStats();
        const hosts = stats.hosts || {};
        const hostFilter = document.getElementById('hostFilter');
        if (!hostFilter) return;
        const currentValue = hostFilter.value;
        hostFilter.innerHTML = '<option value="">Все хосты</option>' + Object.keys(hosts).sort().map((host) => `<option value="${escapeHtml(host)}">${escapeHtml(host)}</option>`).join('');
        hostFilter.value = currentValue;
    } catch (error) {
        console.error('Stats load failed', error);
    }
}

async function loadLogs() {
    const filters = getCurrentFilters();
    syncUrl(filters);
    try {
        const logs = await getLogs({
            host: filters.host || null,
            severity: filters.severity || null,
            since: getSinceValue(),
            search: filters.search || null,
            limit: 500,
        });
        allEvents = Array.isArray(logs) ? logs : [];
        persistRecentAction({ title: filters.search ? `Логи: ${filters.search}` : 'Логи', url: window.location.href, ts: new Date().toISOString() });
        sortAndDisplayEvents();
        updateResultsSummary();
        const lastTs = allEvents[0]?.ts || null;
        setText('table-info', allEvents.length ? `Найдено ${allEvents.length}` : 'Событий пока нет');
        setText('agentSync', lastTs ? `Последнее событие ${formatAgo(lastTs)}` : 'Источники пока не передавали логи');
    } catch (error) {
        console.error('Error loading logs:', error);
        renderStateRow('Не удалось загрузить события. Проверьте соединение и повторите попытку.', 'danger');
        setText('table-info', 'Ошибка загрузки');
    }
}

function updateResultsSummary() {
    const summary = document.getElementById('resultsSummary');
    if (!summary) return;
    const filters = getCurrentFilters();
    const parts = [];
    if (filters.host) parts.push(`хост: ${filters.host}`);
    if (filters.severity) parts.push(`уровень: ${filters.severity}`);
    if (filters.search) parts.push(`поиск: ${filters.search}`);
    parts.push(`период: ${filters.time}`);
    summary.textContent = allEvents.length
        ? `Показано ${allEvents.length} событий. Активные фильтры: ${parts.join(', ')}`
        : 'Событий по выбранным фильтрам не найдено';
}

function renderStateRow(message, tone = 'muted') {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    const toneClass = tone === 'danger' ? 'text-danger' : 'helper-text';
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty ${toneClass}">${escapeHtml(message)}</td></tr>`;
}

function sortAndDisplayEvents() {
    if (!allEvents.length) {
        renderStateRow('Событий по выбранным фильтрам не найдено');
        updatePagination(0);
        return;
    }
    const sorted = [...allEvents].sort((left, right) => {
        let aVal = left[currentSort.field];
        let bVal = right[currentSort.field];
        if (currentSort.field === 'ts') {
            aVal = new Date(aVal || 0).getTime();
            bVal = new Date(bVal || 0).getTime();
        }
        if (aVal < bVal) return currentSort.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
    const start = (currentPage - 1) * pageSize;
    const paged = sorted.slice(start, start + pageSize);
    renderRows(paged, start);
    updatePagination(sorted.length);
}

function renderRows(events, offset) {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    tbody.innerHTML = events.map((event, index) => `
        <tr data-event-index="${offset + index}">
            <td class="mono">${escapeHtml(formatDateTimeRu(event.ts))}</td>
            <td><span class="${getSeverityBadgeClass(event.severity)}">${getSeverityLabel(event.severity)}</span></td>
            <td class="mono">${escapeHtml(event.host || '--')}</td>
            <td>${escapeHtml(event.unit || event.source || '--')}</td>
            <td class="mono">${escapeHtml(event.pid || '--')}</td>
            <td>${escapeHtml(event.message || '')}</td>
        </tr>
    `).join('');
}

function updatePagination(total) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    setText('pageInfo', `Страница ${currentPage} из ${totalPages} · всего ${total.toLocaleString('ru-RU')}`);
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage === totalPages;
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach((header) => {
        header.classList.remove('asc', 'desc');
        if (header.dataset.sort === currentSort.field) {
            header.classList.add(currentSort.direction);
        }
    });
}

function showEventDetails(eventIndex) {
    const event = allEvents[eventIndex];
    if (!event) return;
    const modal = document.getElementById('eventModal');
    const modalBody = document.getElementById('modalBody');
    if (!modal || !modalBody) return;
    modalBody.innerHTML = `
        <div class="stack">
            <div><strong>Время:</strong> ${escapeHtml(formatDateTimeRu(event.ts))}</div>
            <div><strong>Важность:</strong> ${escapeHtml(getSeverityLabel(event.severity))}</div>
            <div><strong>Хост:</strong> ${escapeHtml(event.host || '--')}</div>
            <div><strong>Источник:</strong> ${escapeHtml(event.source || '--')}</div>
            <div><strong>Служба:</strong> ${escapeHtml(event.unit || '--')}</div>
            <div><strong>PID:</strong> ${escapeHtml(event.pid || '--')}</div>
            <div><strong>Сообщение:</strong><br>${escapeHtml(event.message || '')}</div>
        </div>
    `;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeEventModal() {
    const modal = document.getElementById('eventModal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function showSettings() {
    const modal = document.getElementById('settingsModal');
    modal?.classList.remove('hidden');
    modal?.classList.add('flex');
}

function closeSettingsModal() {
    const modal = document.getElementById('settingsModal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

function updateRefreshInterval() {
    refreshInterval = Number(document.getElementById('refreshInterval')?.value || 30) * 1000;
    setupAutoRefresh();
}

function toggleAutoRefresh() {
    const enabled = document.getElementById('autoRefreshEnabled')?.checked;
    if (!enabled) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
        return;
    }
    setupAutoRefresh();
}

function setupAutoRefresh() {
    clearInterval(autoRefreshTimer);
    if (refreshInterval > 0) {
        autoRefreshTimer = setInterval(async () => {
            await loadStats();
            await loadLogs();
        }, refreshInterval);
    }
}

function exportToCSV() {
    if (!allEvents.length) return;
    const headers = ['Время', 'Важность', 'Хост', 'Служба', 'PID', 'Сообщение'];
    const lines = [
        headers.join(','),
        ...allEvents.map((event) => [
            formatDateTimeRu(event.ts),
            getSeverityLabel(event.severity),
            event.host || '',
            event.unit || event.source || '',
            event.pid || '',
            event.message || '',
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')),
    ];
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `logs_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}
