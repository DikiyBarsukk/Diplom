const API_BASE = window.location.origin;
let autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkAuth();
        await loadAuditData();
        setupSearch();
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
        const username = document.getElementById('username');
        if (username) username.textContent = user.username || 'Аудитор';
    }
}

async function loadAuditData() {
    const [statsRes, incidentsRes, logsRes, agentsRes] = await Promise.all([
        fetch(`${API_BASE}/stats`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/incidents?limit=20`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/logs?limit=100`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/api/agents/stats?window_minutes=5`, { credentials: 'include' }).catch(() => null),
    ]);

    const stats = statsRes.ok ? await statsRes.json() : {};
    const incidents = incidentsRes?.ok ? await incidentsRes.json() : [];
    const logs = logsRes?.ok ? await logsRes.json() : [];
    const agents = agentsRes?.ok ? await agentsRes.json() : null;

    updateAgentStats(stats, agents);
    updateAuditSummary(stats);
    updatePriorityTargets(stats, logs);
    updateAuditFeed(incidents, logs);
    updateSyncStatus(stats);
}

function setupSearch() {
    const input = document.getElementById('targetSearch');
    if (!input) return;
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const value = input.value.trim();
            if (!value) return;
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
                window.location.href = `/logs?host=${encodeURIComponent(value)}`;
            } else {
                window.location.href = `/logs?search=${encodeURIComponent(value)}`;
            }
        }
    });
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadAuditData, 30000);
}

function updateAgentStats(stats, agents) {
    const criticalCount = (stats.severity?.emerg || 0) + (stats.severity?.alert || 0) + (stats.severity?.crit || 0);

    if (agents) {
        setText('totalAgents', agents.total || 0);
        setText('onlineAgents', agents.online || 0);
        setText('offlineAgents', agents.offline || 0);
    } else {
        const hosts = Object.keys(stats.hosts || {});
        const total = hosts.length;
        setText('totalAgents', total);
        setText('onlineAgents', total);
        setText('offlineAgents', 0);
    }
    setText('auditErrors', criticalCount);
}

function updateAuditSummary(stats) {
    const severity = stats.severity || {};
    setText('authFailures', (severity.alert || 0) + (severity.emerg || 0));
    setText('registryMods', severity.warn || 0);
    setText('policyViolations', severity.err || 0);
    setText('softwareInstalls', severity.notice || 0);
}

function updatePriorityTargets(stats, logs) {
    const container = document.getElementById('priorityTargets');
    if (!container) return;
    const hosts = stats.hosts || {};
    const sorted = Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (!sorted.length) {
        container.innerHTML = '<p class="text-[#92b7c9] text-sm">Данные пока отсутствуют</p>';
        return;
    }
    container.innerHTML = sorted.map(([host, count]) => `
        <div class="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border-muted/30">
            <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-[#92b7c9]">desktop_windows</span>
                <div>
                    <p class="text-sm font-medium">${escapeHtml(host)}</p>
                    <p class="text-xs text-[#92b7c9] font-mono">Событий: ${count}</p>
                </div>
            </div>
            <div class="text-right">
                <p class="text-primary font-bold text-sm">Приоритет</p>
                <p class="text-[10px] text-[#92b7c9]">Аудит</p>
            </div>
        </div>
    `).join('');
}

function updateAuditFeed(incidents, logs) {
    const container = document.getElementById('auditFeed');
    if (!container) return;
    let items = [];
    if (Array.isArray(incidents) && incidents.length) {
        items = incidents.slice(0, 6).map(inc => ({
            title: inc.title || 'Событие ИБ',
            desc: inc.description || inc.details || '',
            time: formatAgo(inc.detected_at),
            severity: (inc.severity || 'info').toLowerCase()
        }));
    } else if (Array.isArray(logs) && logs.length) {
        items = logs.slice(0, 6).map(ev => ({
            title: ev.message || 'Событие журнала',
            desc: `${ev.host || '—'} • ${ev.unit || ev.source || ''}`,
            time: formatAgo(ev.ts),
            severity: (ev.severity || 'info').toLowerCase()
        }));
    }

    if (!items.length) {
        container.innerHTML = '<p class="text-[#92b7c9] text-sm">Нет событий для отображения</p>';
        return;
    }

    container.innerHTML = items.map(item => {
        const color = item.severity === 'critical' || item.severity === 'emerg' || item.severity === 'alert' ? 'danger' :
            item.severity === 'high' || item.severity === 'err' ? 'warning' : 'primary';
        return `
            <div class="bg-surface/30 border-l-4 border-${color} p-4 rounded-r-lg space-y-2">
                <div class="flex justify-between items-start">
                    <span class="text-[10px] font-bold text-${color} uppercase tracking-widest">${labelSeverity(item.severity)}</span>
                    <span class="text-[10px] text-[#92b7c9]">${item.time}</span>
                </div>
                <p class="text-sm font-semibold">${escapeHtml(item.title)}</p>
                <p class="text-xs text-[#92b7c9] line-clamp-2">${escapeHtml(item.desc)}</p>
                <div class="flex gap-2 pt-1">
                    <button class="flex-1 text-[10px] font-bold bg-${color} py-1.5 rounded hover:bg-${color}/80 transition-colors uppercase">Подробнее</button>
                </div>
            </div>
        `;
    }).join('');
}

function updateSyncStatus(stats) {
    const el = document.getElementById('agentSync');
    if (!el) return;
    el.textContent = '0.4с назад';
}

function labelSeverity(sev) {
    if (['critical', 'emerg', 'alert', 'crit'].includes(sev)) return 'КРИТИЧЕСКОЕ';
    if (['high', 'err'].includes(sev)) return 'ВЫСОКОЕ';
    if (['warn', 'medium'].includes(sev)) return 'СРЕДНЕЕ';
    return 'ИНФО';
}

function formatAgo(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)} сек назад`;
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
    return `${Math.floor(diff / 86400)} дн назад`;
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
