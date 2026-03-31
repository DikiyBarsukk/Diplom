const {
    checkPageAuth,
    escapeHtml,
    formatDateTimeRu,
    getSeverityLabel,
    getSeverityBadgeClass,
    getStatusMeta,
    getStatusBadgeClass,
    buildLogsUrl,
    persistRecentAction,
    setupGlobalSearch,
    setText,
} = window.AppShell;
const { getIncidents, getLogs } = window.DataClient;

let currentIncident = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupGlobalSearch('incidentHeaderSearch', (query) => buildLogsUrl({ search: query }));
    bindActions();
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        const idParam = new URLSearchParams(window.location.search).get('id') || '';
        const incident = await loadIncidentById(idParam);
        if (!incident) {
            renderEmptyIncident();
            return;
        }
        currentIncident = incident;
        renderIncident(incident);
        await loadEvidenceAndTimeline(incident);
        setInterval(async () => {
            const refreshed = await loadIncidentById(idParam);
            if (refreshed) {
                currentIncident = refreshed;
                renderIncident(refreshed);
                await loadEvidenceAndTimeline(refreshed);
            }
        }, 30000);
    } catch (error) {
        console.error(error);
    }
});

function bindActions() {
    document.getElementById('copyIncidentSummaryBtn')?.addEventListener('click', async () => {
        if (!currentIncident) return;
        const summary = [
            `Инцидент: ${currentIncident.id ? `INC-${currentIncident.id}` : currentIncident.rule_id || 'INC-—'}`,
            `Тип: ${currentIncident.incident_type || '--'}`,
            `Хост: ${currentIncident.host || '--'}`,
            `Важность: ${getSeverityLabel(currentIncident.severity)}`,
            `Статус: ${getStatusMeta(currentIncident.status).label}`,
            `Описание: ${currentIncident.description || currentIncident.details || '--'}`,
        ].join('\n');
        await navigator.clipboard.writeText(summary);
        const button = document.getElementById('copyIncidentSummaryBtn');
        if (button) {
            button.textContent = 'Сводка скопирована';
            setTimeout(() => { button.textContent = 'Скопировать сводку'; }, 1500);
        }
    });
}

async function loadIncidentById(idParam) {
    if (!idParam) return null;
    const idMatch = idParam.match(/\d+/);
    const id = idMatch ? idMatch[0] : '';
    const incidents = await getIncidents({ limit: 200 });
    if (!Array.isArray(incidents)) return null;
    return incidents.find((incident) => String(incident.id) === String(id)) || null;
}

function renderEmptyIncident() {
    setText('incidentSummary', 'Инцидент не найден или ещё не загружен.');
    setText('incidentTitleId', '—');
    setText('incidentId', '—');
    document.getElementById('timelineList').innerHTML = '<p class="helper-text">Нет данных для расследования.</p>';
    document.getElementById('evidenceList').innerHTML = '<p class="helper-text">Связанные события не найдены.</p>';
}

function renderIncident(incident) {
    const incidentId = incident.id ? `INC-${incident.id}` : incident.rule_id || 'INC-—';
    setText('incidentId', incidentId);
    setText('incidentTitleId', incidentId);
    setText('incidentSummary', incident.description || incident.details || 'Описание инцидента пока недоступно.');
    setText('incidentDetected', formatDateTimeRu(incident.detected_at));
    setText('incidentAssets', incident.host ? `1 хост (${incident.host})` : 'Не указан');
    setText('incidentCategory', incident.incident_type || 'Не определён');
    setText('incidentHost', incident.host || 'Не указан');
    setText('incidentOs', incident.os || 'Не определена');
    setText('incidentNetwork', incident.network || 'Внутренний сегмент');
    setText('incidentSeverity', getSeverityLabel(incident.severity));
    setText('incidentStatus', getStatusMeta(incident.status).label);

    const severityEl = document.getElementById('incidentSeverity');
    if (severityEl) severityEl.className = getSeverityBadgeClass(incident.severity);
    const statusEl = document.getElementById('incidentStatus');
    if (statusEl) statusEl.className = getStatusBadgeClass(incident.status);

    const relatedLogsBtn = document.getElementById('relatedLogsBtn');
    if (relatedLogsBtn) {
        relatedLogsBtn.href = buildLogsUrl({ host: incident.host || '', search: incident.rule_id || incidentId });
    }

    renderRecommendations(incident);
    persistRecentAction({ title: `Инцидент ${incidentId}`, url: window.location.href, ts: new Date().toISOString() });
}

function renderRecommendations(incident) {
    const list = document.getElementById('nextActionsList');
    if (!list) return;
    const suggestions = [
        'Проверьте соседние события и убедитесь, что сработавшее правило не является шумом.',
        incident.host ? `Откройте логи хоста ${incident.host} и изучите события до и после детекта.` : 'Откройте связанные логи для проверки контекста.',
        incident.incident_type === 'brute_force' ? 'Оцените необходимость блокировки IP и смены пароля.' : 'Зафиксируйте выводы расследования в комментарии и сводке.',
    ];
    list.innerHTML = suggestions.map((item) => `<div class="favorite-item">${escapeHtml(item)}</div>`).join('');
}

async function loadEvidenceAndTimeline(incident) {
    let events = [];
    if (incident.host) {
        events = await getLogs({ host: incident.host, since: incident.first_event_time || incident.detected_at || null, limit: 200 }).catch(() => []);
    }
    renderEvidence(events);
    renderTimeline(events);
}

function renderEvidence(events) {
    const list = document.getElementById('evidenceList');
    const count = document.getElementById('evidenceCount');
    if (!list || !count) return;
    count.textContent = `${events.length} событий`;
    if (!events.length) {
        list.innerHTML = '<p class="helper-text">Связанные события не найдены.</p>';
        return;
    }
    list.innerHTML = events.slice(0, 50).map((event) => `
        <div class="evidence-item">
            <strong>${escapeHtml(event.unit || event.source || 'Событие')}</strong>
            <time>${escapeHtml(formatDateTimeRu(event.ts))}</time>
            <p>${escapeHtml(event.message || 'Событие')}</p>
        </div>
    `).join('');
}

function renderTimeline(events) {
    const timeline = document.getElementById('timelineList');
    if (!timeline) return;
    if (!events.length) {
        timeline.innerHTML = '<p class="helper-text">Хронология пока пуста.</p>';
        return;
    }
    const sorted = [...events].sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));
    timeline.innerHTML = sorted.slice(0, 20).map((event) => `
        <div class="timeline-item">
            <strong>${escapeHtml(event.unit || event.source || 'Событие')}</strong>
            <time>${escapeHtml(formatDateTimeRu(event.ts))}</time>
            <p>${escapeHtml(event.message || '')}</p>
        </div>
    `).join('');
}
