const API_BASE = window.location.origin;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkAuth();
        const idParam = new URLSearchParams(window.location.search).get('id') || '';
        const incident = await loadIncidentById(idParam);
        if (incident) {
            renderIncident(incident);
            await loadEvidenceAndTimeline(incident);
        }
        setInterval(async () => {
            const refreshed = await loadIncidentById(idParam);
            if (refreshed) {
                renderIncident(refreshed);
                await loadEvidenceAndTimeline(refreshed);
            }
        }, 30000);
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

async function loadIncidentById(idParam) {
    if (!idParam) return null;
    const idMatch = idParam.match(/\d+/);
    const id = idMatch ? idMatch[0] : '';
    const res = await fetch(`${API_BASE}/api/incidents?limit=200`, { credentials: 'include' });
    if (!res.ok) return null;
    const incidents = await res.json();
    if (!Array.isArray(incidents)) return null;
    return incidents.find(inc => String(inc.id) === String(id)) || incidents[0] || null;
}

function renderIncident(inc) {
    const incidentId = inc.id ? `INC-${inc.id}` : inc.rule_id || 'INC-—';
    setText('incidentId', incidentId);
    setText('incidentTitleId', incidentId);
    setText('incidentSummary', inc.description || inc.details || 'Описание недоступно.');
    setText('incidentDetected', inc.detected_at ? new Date(inc.detected_at).toLocaleString('ru-RU') : '--');
    setText('incidentAssets', inc.host ? `1 хост (${inc.host})` : '—');
    setText('incidentCategory', inc.incident_type || '—');
    setText('incidentHost', inc.host || '—');
    setText('incidentOs', inc.os || 'Windows / Linux');
    setText('incidentNetwork', inc.network || 'Внутренний сегмент');

    const severity = (inc.severity || 'info').toLowerCase();
    const sevLabel = severity === 'critical' ? 'Критический' : severity === 'high' ? 'Высокий' : severity === 'medium' ? 'Средний' : severity === 'low' ? 'Низкий' : 'Инфо';
    setText('incidentSeverity', sevLabel);

    const status = (inc.status || 'open').toLowerCase();
    const statusLabel = status === 'open' ? 'Открыт' : status === 'investigating' ? 'Расследуется' : 'Закрыт';
    setText('incidentStatus', statusLabel);
}

async function loadEvidenceAndTimeline(inc) {
    const evidence = Array.isArray(inc.related_events) ? inc.related_events : [];
    let events = evidence;

    if (!events.length && inc.host) {
        const since = inc.first_event_time || inc.detected_at;
        const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
        const res = await fetch(`${API_BASE}/api/logs?host=${encodeURIComponent(inc.host)}&limit=200${sinceParam}`, {
            credentials: 'include'
        });
        if (res.ok) {
            const logs = await res.json();
            if (Array.isArray(logs)) events = logs;
        }
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
        list.innerHTML = '<p class="text-xs text-[#92b7c9] p-2">Нет связанных событий.</p>';
        return;
    }

    list.innerHTML = events.slice(0, 50).map(ev => {
        const time = formatTime(ev.ts || ev.timestamp);
        const source = ev.host || ev.source || '—';
        const message = ev.message || ev.details || 'Событие';
        return `
            <div class="p-2 hover:bg-white/5 rounded border border-transparent hover:border-[#233c48] cursor-pointer group">
                <div class="flex justify-between text-[10px] mb-1">
                    <span class="text-primary font-mono">${time}</span>
                    <span class="text-[#92b7c9]">Источник: ${escapeHtml(source)}</span>
                </div>
                <p class="text-[11px] font-mono leading-relaxed text-[#92b7c9] group-hover:text-white truncate">
                    ${escapeHtml(message)}
                </p>
            </div>
        `;
    }).join('');
}

function renderTimeline(events) {
    const timeline = document.getElementById('timelineList');
    if (!timeline) return;
    if (!events.length) {
        timeline.innerHTML = '<p class="text-xs text-[#92b7c9]">Хронология пока пуста.</p>';
        return;
    }

    const sorted = [...events].sort((a, b) => new Date(a.ts || a.timestamp || 0) - new Date(b.ts || b.timestamp || 0));
    timeline.innerHTML = sorted.slice(0, 20).map(ev => {
        const time = formatTime(ev.ts || ev.timestamp, true);
        const title = ev.unit || ev.source || 'Событие';
        const message = ev.message || ev.details || '';
        return `
            <div class="relative pl-12 mb-8">
                <div class="absolute left-0 top-1 w-10 h-10 rounded-full bg-primary/20 border border-primary flex items-center justify-center z-10">
                    <span class="material-symbols-outlined text-primary">event</span>
                </div>
                <div class="bg-background-dark/50 p-4 rounded-lg border border-[#233c48]">
                    <div class="flex justify-between items-start mb-2">
                        <h4 class="font-bold text-sm">${escapeHtml(title)}</h4>
                        <span class="text-xs text-[#92b7c9]">${time}</span>
                    </div>
                    <p class="text-sm text-[#92b7c9] leading-relaxed">${escapeHtml(message)}</p>
                </div>
            </div>
        `;
    }).join('');
}

function formatTime(value, withDate = false) {
    if (!value) return '--';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '--';
    return withDate ? d.toLocaleString('ru-RU') : d.toLocaleTimeString('ru-RU');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}
