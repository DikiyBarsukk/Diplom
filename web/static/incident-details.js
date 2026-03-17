const {
    apiBase: API_BASE,
    authenticatedFetch,
    checkPageAuth,
    escapeHtml,
    formatAgo,
    formatDateTimeRu,
    getSeverityLabel,
    getSeverityBadgeClass,
    getStatusMeta,
    buildLogsUrl,
    persistRecentAction,
    setupGlobalSearch,
    setText,
} = window.AppShell;
const { getIncidents, getLogs } = window.DataClient;

let currentIncident = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupGlobalSearch(null, () => '/logs');
    const searchInput = document.querySelector('header input');
    if (searchInput && !searchInput.id) {
        searchInput.id = 'incidentHeaderSearch';
        window.AppShell.setupGlobalSearch('incidentHeaderSearch', (query) => buildLogsUrl({ search: query }));
    }
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        installInvestigationUx();
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

function installInvestigationUx() {
    const leftColumn = document.querySelector('.col-span-3.flex.flex-col.gap-4.overflow-hidden');
    if (leftColumn && !document.getElementById('incidentDecisionBox')) {
        const decision = document.createElement('div');
        decision.id = 'incidentDecisionBox';
        decision.className = 'bg-[#1a2b34] border border-[#233c48] rounded-lg p-4';
        decision.innerHTML = `
            <h3 class="text-xs font-bold uppercase text-primary mb-3">Что делать дальше</h3>
            <div class="space-y-2 text-sm text-[#92b7c9]" id="nextActionsList">
                <p>Загрузка рекомендаций...</p>
            </div>
            <div class="mt-4 flex flex-col gap-2">
                <a id="relatedLogsBtn" href="/logs" class="bg-primary/20 border border-primary/40 hover:bg-primary/30 text-primary font-bold py-2 rounded-lg text-xs text-center transition-colors">Открыть связанные логи</a>
                <button id="copyIncidentSummaryBtn" class="bg-[#233c48] hover:bg-[#2d4d5c] text-white font-bold py-2 rounded-lg text-xs transition-colors">Скопировать сводку</button>
            </div>
        `;
        leftColumn.prepend(decision);
    }
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
    setText('incidentSummary', 'Инцидент не найден или еще не загружен.');
    setText('incidentTitleId', '—');
    setText('incidentId', '—');
    document.getElementById('timelineList').innerHTML = '<p class="text-xs text-[#92b7c9]">Нет данных для расследования.</p>';
    document.getElementById('evidenceList').innerHTML = '<p class="text-xs text-[#92b7c9] p-2">Связанные события не найдены.</p>';
}

function renderIncident(incident) {
    const incidentId = incident.id ? `INC-${incident.id}` : incident.rule_id || 'INC-—';
    setText('incidentId', incidentId);
    setText('incidentTitleId', incidentId);
    setText('incidentSummary', incident.description || incident.details || 'Описание инцидента пока недоступно.');
    setText('incidentDetected', formatDateTimeRu(incident.detected_at));
    setText('incidentAssets', incident.host ? `1 хост (${incident.host})` : 'Не указан');
    setText('incidentCategory', incident.incident_type || 'Не определен');
    setText('incidentHost', incident.host || 'Не указан');
    setText('incidentOs', incident.os || 'Не определена');
    setText('incidentNetwork', incident.network || 'Внутренний сегмент');
    setText('incidentSeverity', getSeverityLabel(incident.severity));
    setText('incidentStatus', getStatusMeta(incident.status).label);

    const severityEl = document.getElementById('incidentSeverity');
    if (severityEl) severityEl.className = `text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${getSeverityBadgeClass(incident.severity)}`;
    const statusEl = document.getElementById('incidentStatus');
    if (statusEl) statusEl.className = `text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${window.AppShell.getStatusBadgeClass(incident.status)}`;

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
        'Проверьте связанные события и убедитесь, что инцидент не является шумом.',
        incident.host ? `Откройте логи хоста ${incident.host} и проверьте соседние события.` : 'Откройте связанные логи для проверки контекста.',
        incident.incident_type === 'brute_force' ? 'Оцените необходимость блокировки IP и смены пароля.' : 'Зафиксируйте выводы расследования в заметке.',
    ];
    list.innerHTML = suggestions.map((item) => `<p>• ${escapeHtml(item)}</p>`).join('');
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
        list.innerHTML = '<p class="text-xs text-[#92b7c9] p-2">Связанные события не найдены.</p>';
        return;
    }
    list.innerHTML = events.slice(0, 50).map((event) => `
        <div class="p-2 hover:bg-white/5 rounded border border-transparent hover:border-[#233c48]">
            <div class="flex justify-between text-[10px] mb-1">
                <span class="text-primary font-mono">${escapeHtml(formatDateTimeRu(event.ts))}</span>
                <span class="text-[#92b7c9]">${escapeHtml(event.host || event.source || '—')}</span>
            </div>
            <p class="text-[11px] font-mono leading-relaxed text-[#92b7c9]">${escapeHtml(event.message || 'Событие')}</p>
        </div>
    `).join('');
}

function renderTimeline(events) {
    const timeline = document.getElementById('timelineList');
    if (!timeline) return;
    if (!events.length) {
        timeline.innerHTML = '<p class="text-xs text-[#92b7c9]">Хронология пока пуста.</p>';
        return;
    }
    const sorted = [...events].sort((a, b) => new Date(a.ts || 0) - new Date(b.ts || 0));
    timeline.innerHTML = sorted.slice(0, 20).map((event) => `
        <div class="relative pl-12 mb-8">
            <div class="absolute left-0 top-1 w-10 h-10 rounded-full bg-primary/20 border border-primary flex items-center justify-center z-10">
                <span class="material-symbols-outlined text-primary">event</span>
            </div>
            <div class="bg-background-dark/50 p-4 rounded-lg border border-[#233c48]">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-bold text-sm">${escapeHtml(event.unit || event.source || 'Событие')}</h4>
                    <span class="text-xs text-[#92b7c9]">${escapeHtml(formatDateTimeRu(event.ts))}</span>
                </div>
                <p class="text-sm text-[#92b7c9] leading-relaxed">${escapeHtml(event.message || '')}</p>
            </div>
        </div>
    `).join('');
}
