/**
 * Security Overview Dashboard - BARSUKSIEM
 * Integrates with existing API: /stats, /api/logs, /api/incidents, /api/incidents/stats
 */
const API_BASE = window.location.origin;
let csrfToken = null;
let severityDonutChart = null;
let epsChart = null;
let autoRefreshInterval = null;
let refreshIntervalMs = 30000;

document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    try {
        await checkAuth();
        await loadDashboard();
        setupAutoRefresh();
    } catch (error) {
        console.error('Dashboard init error:', error);
    }
});

async function checkAuth() {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    if (response.ok) {
        const user = await response.json();
        const el = document.getElementById('username');
        if (el) el.textContent = user.username || 'Оператор';
    }
    return true;
}

async function authenticatedFetch(url, options = {}) {
    if (!csrfToken && options.method && options.method !== 'GET') {
        const meRes = await fetch('/api/auth/me', { credentials: 'include' });
        csrfToken = meRes.headers.get('X-CSRF-Token');
    }
    const headers = { ...options.headers, 'Content-Type': 'application/json' };
    if (csrfToken && options.method && options.method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
    }
    const res = await fetch(url, { ...options, credentials: 'include', headers });
    const newToken = res.headers.get('X-CSRF-Token');
    if (newToken) csrfToken = newToken;
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return res;
}

function setupEventListeners() {
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
        try {
            await authenticatedFetch('/api/auth/logout', { method: 'POST' });
        } catch (e) {}
        window.location.href = '/login';
    });

    document.getElementById('settingsNavBtn')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('settingsModal')?.classList.remove('hidden');
        document.getElementById('settingsModal')?.classList.add('flex');
    });

    document.getElementById('settingsClose')?.addEventListener('click', () => {
        document.getElementById('settingsModal')?.classList.add('hidden');
        document.getElementById('settingsModal')?.classList.remove('flex');
    });

    document.getElementById('globalSearch')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const q = document.getElementById('globalSearch').value.trim();
            if (q) window.location.href = `/logs?search=${encodeURIComponent(q)}`;
        }
    });

    document.getElementById('notificationsBtn')?.addEventListener('click', () => {
        window.location.href = '/incidents';
    });

    document.getElementById('refreshInterval')?.addEventListener('change', () => {
        refreshIntervalMs = parseInt(document.getElementById('refreshInterval').value) * 1000;
        setupAutoRefresh();
    });

    document.getElementById('autoRefreshEnabled')?.addEventListener('change', () => {
        const enabled = document.getElementById('autoRefreshEnabled').checked;
        if (enabled) setupAutoRefresh();
        else if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    });

    document.getElementById('clearResolvedBtn')?.addEventListener('click', () => {
        loadDashboard();
    });
}

async function loadDashboard() {
    try {
        const [statsRes, eventsRes, incidentsRes, incidentsStatsRes] = await Promise.all([
            authenticatedFetch(`${API_BASE}/stats`),
            authenticatedFetch(`${API_BASE}/api/logs?limit=1000`),
            authenticatedFetch(`${API_BASE}/api/incidents?limit=20`).catch(() => null),
            authenticatedFetch(`${API_BASE}/api/incidents/stats`).catch(() => null)
        ]);

        const stats = statsRes.ok ? await statsRes.json() : {};
        const events = eventsRes.ok ? await eventsRes.json() : [];
        const incidents = incidentsRes?.ok ? await incidentsRes.json() : [];
        const incidentsStats = incidentsStatsRes?.ok ? await incidentsStatsRes.json() : {};

        updateStats(stats, incidentsStats);
        updateThreatLevel(stats, incidentsStats);
        updateSeverityDistribution(stats);
        updateTopAssets(stats, events);
        updateCriticalFeed(incidents, events);
        updateEpsChart(events);
        updateIncidentsBadge(incidentsStats);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

function updateStats(stats, incidentsStats) {
    const total = stats.total_events || 0;
    const severity = stats.severity || {};
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const openIncidents = incidentsStats.by_status?.open ?? incidentsStats.open ?? 0;
    const closedIncidents = incidentsStats.by_status?.closed ?? incidentsStats.closed ?? 0;
    const processed = total - criticalCount;

    const totalEl = document.getElementById('total-events');
    if (totalEl) totalEl.textContent = total.toLocaleString();

    const incidentsEl = document.getElementById('active-incidents');
    if (incidentsEl) incidentsEl.textContent = openIncidents;

    const blockedEl = document.getElementById('blocked-attacks');
    if (blockedEl) blockedEl.textContent = (processed + closedIncidents).toLocaleString();

    const maxEvents = Math.max(total, 2000000);
    const eventsBar = document.getElementById('events-bar');
    if (eventsBar) eventsBar.style.width = `${Math.min(100, (total / maxEvents) * 100)}%`;

    const incidentsBar = document.getElementById('incidents-bar');
    if (incidentsBar) incidentsBar.style.width = `${Math.min(100, openIncidents * 4)}%`;

    const blockedBar = document.getElementById('blocked-bar');
    if (blockedBar) blockedBar.style.width = total > 0 ? `${Math.min(100, ((processed + closedIncidents) / total) * 100)}%` : '0%';
}

function updateThreatLevel(stats, incidentsStats) {
    const severity = stats.severity || {};
    const total = stats.total_events || 1;
    const criticalCount = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const openIncidents = incidentsStats.by_status?.open ?? incidentsStats.open ?? 0;
    const criticalRatio = criticalCount / total;
    const riskScore = Math.min(100, Math.round(criticalRatio * 150 + openIncidents * 5));

    let level = 'LOW';
    let color = '#22c55e';
    if (riskScore >= 70) {
        level = 'HIGH';
        color = '#ef4444';
    } else if (riskScore >= 40) {
        level = 'MEDIUM';
        color = '#f97316';
    }

    const gauge = document.getElementById('threat-gauge');
    if (gauge) {
        gauge.setAttribute('stroke', color);
        const angle = Math.PI * (1 - riskScore / 100);
        const x = 50 + 40 * Math.cos(angle);
        const y = 50 - 40 * Math.sin(angle);
        gauge.setAttribute('d', `M 10,50 A 40,40 0 0 1 ${x.toFixed(1)},${y.toFixed(1)}`);
    }

    const levelEl = document.getElementById('threat-level');
    if (levelEl) {
        levelEl.textContent = level;
        levelEl.className = `text-3xl font-bold ${level === 'HIGH' ? 'text-danger' : level === 'MEDIUM' ? 'text-warning' : 'text-success'}`;
    }

    const scoreEl = document.getElementById('risk-score');
    if (scoreEl) scoreEl.textContent = riskScore;

    const msgEl = document.getElementById('threat-message');
    if (msgEl) {
        if (openIncidents > 0) {
            msgEl.textContent = `${openIncidents} активн(ых) событий требуют внимания. Рекомендуется проверка.`;
        } else if (criticalCount > 0) {
            msgEl.textContent = `Повышенная критичность событий (${criticalCount}). Нужен контроль.`;
        } else {
            msgEl.textContent = 'Повышенных рисков не обнаружено. Система работает нормально.';
        }
    }
}

function updateSeverityDistribution(stats) {
    const severity = stats.severity || {};
    const total = stats.total_events || 0;

    const critical = (severity.emerg || 0) + (severity.alert || 0) + (severity.crit || 0);
    const high = severity.err || 0;
    const medium = (severity.warn || 0) + (severity.notice || 0);
    const low = (severity.info || 0) + (severity.debug || 0);

    const pct = (n) => total > 0 ? ((n / total) * 100).toFixed(0) : 0;

    document.getElementById('severity-total').textContent = total >= 1000 ? (total / 1000).toFixed(1) + 'k' : total;
    document.getElementById('sev-critical').textContent = pct(critical) + '%';
    document.getElementById('sev-high').textContent = pct(high) + '%';
    document.getElementById('sev-medium').textContent = pct(medium) + '%';
    document.getElementById('sev-low').textContent = pct(low) + '%';

    const canvas = document.getElementById('severityDonut');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const data = [critical, high, medium, low].filter(v => v > 0);
    const labels = ['Критические', 'Высокие', 'Средние/Инфо', 'Низкие'].filter((_, i) => [critical, high, medium, low][i] > 0);
    const colors = ['#ef4444', '#f97316', '#13a4ec', '#22c55e'];

    if (severityDonutChart) severityDonutChart.destroy();

    if (data.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    severityDonutChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors.slice(0, data.length),
                borderWidth: 0
            }]
        },
        options: {
            cutout: '65%',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function updateTopAssets(stats, events) {
    const hosts = stats.hosts || {};
    const severity = stats.severity || {};
    const hostCritical = {};

    events.forEach(ev => {
        const h = ev.host || 'unknown';
        const sev = (ev.severity || '').toLowerCase();
        if (['emerg', 'alert', 'crit'].includes(sev)) {
            hostCritical[h] = (hostCritical[h] || 0) + 1;
        }
    });

    const sorted = Object.entries(hosts)
        .map(([host, count]) => ({
            host,
            count,
            score: Math.min(100, 50 + (hostCritical[host] || 0) * 10)
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    const container = document.getElementById('top-assets');
    if (!container) return;

    const icons = ['database', 'router', 'language', 'computer', 'dns'];
    if (sorted.length === 0) {
        container.innerHTML = '<p class="text-[#92b7c9] text-sm">Пока нет данных по активам</p>';
        return;
    }

    container.innerHTML = sorted.map((item, i) => {
        const score = item.score;
        const colorClass = score >= 80 ? 'text-danger' : score >= 60 ? 'text-warning' : 'text-primary';
        const label = score >= 80 ? 'Критический' : score >= 60 ? 'Высокий' : 'Средний';
        return `
            <a href="/logs?host=${encodeURIComponent(item.host)}" class="flex items-center justify-between p-3 rounded-lg bg-surface/50 border border-border-muted/30 hover:border-primary/50 transition-colors no-underline">
                <div class="flex items-center gap-3">
                    <span class="material-symbols-outlined text-[#92b7c9]">${icons[i % icons.length]}</span>
                    <div>
                        <p class="text-sm font-medium text-white">${escapeHtml(item.host)}</p>
                        <p class="text-xs text-[#92b7c9] font-mono">${item.count} событий</p>
                    </div>
                </div>
                <div class="text-right">
                    <p class="${colorClass} font-bold text-sm">${score}/100</p>
                    <p class="text-[10px] text-[#92b7c9]">${label}</p>
                </div>
            </a>
        `;
    }).join('');
}

function updateCriticalFeed(incidents, events) {
    const container = document.getElementById('critical-feed');
    if (!container) return;

    const items = [];

    (incidents || []).forEach(inc => {
        const sev = (inc.severity || 'info').toLowerCase();
        const borderClass = sev === 'critical' ? 'border-danger' : sev === 'high' ? 'border-warning' : 'border-primary';
        const btnClass = sev === 'critical' ? 'bg-danger' : sev === 'high' ? 'bg-warning' : 'bg-primary';
        const timeAgo = formatTimeAgo(inc.detected_at || inc.created_at);
        items.push({
            severity: sev.toUpperCase(),
            title: inc.title || 'Инцидент',
            desc: inc.description || inc.details || '',
            time: timeAgo,
            borderClass,
            btnClass
        });
    });

    if (items.length === 0) {
        const critical = events.filter(e => ['emerg', 'alert', 'crit'].includes((e.severity || '').toLowerCase()));
        critical.slice(0, 5).forEach(ev => {
            const timeAgo = formatTimeAgo(ev.ts);
            items.push({
                severity: 'КРИТИЧЕСКИЙ',
                title: (ev.message || '').substring(0, 50) || 'Критическое событие',
                desc: `${ev.host || 'неизвестно'} - ${ev.unit || ''}`,
                time: timeAgo,
                borderClass: 'border-danger',
                btnClass: 'bg-danger'
            });
        });
    }

    if (items.length === 0) {
        container.innerHTML = '<p class="text-[#92b7c9] text-sm">Критических оповещений нет</p>';
        return;
    }

    container.innerHTML = items.map((item, i) => `
        <div class="bg-surface/30 border-l-4 ${item.borderClass} p-4 rounded-r-lg space-y-2 ${i > 2 ? 'opacity-80' : ''}">
            <div class="flex justify-between items-start">
                <span class="text-[10px] font-bold ${item.borderClass.replace('border-', 'text-')} uppercase tracking-widest">${item.severity}</span>
                <span class="text-[10px] text-[#92b7c9]">${item.time}</span>
            </div>
            <p class="text-sm font-semibold">${escapeHtml(item.title)}</p>
            <p class="text-xs text-[#92b7c9] line-clamp-2">${escapeHtml(item.desc)}</p>
            <div class="flex gap-2 pt-1">
                <a href="/incidents" class="flex-1 text-[10px] font-bold ${item.btnClass} py-1.5 rounded hover:opacity-90 transition-colors uppercase text-center no-underline">Разобрать</a>
            </div>
        </div>
    `).join('');
}

function formatTimeAgo(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)} сек назад`;
    if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
    return `${Math.floor(diff / 86400)} дн назад`;
}

function updateEpsChart(events) {
    const now = new Date();
    const slots = [];
    for (let i = 59; i >= 0; i--) {
        const t = new Date(now);
        t.setSeconds(t.getSeconds() - i);
        t.setMilliseconds(0);
        slots.push(t);
    }

    const counts = slots.map(() => 0);
    events.forEach(ev => {
        try {
            const d = new Date(ev.ts);
            const idx = Math.floor((d.getTime() - slots[0].getTime()) / 1000);
            if (idx >= 0 && idx < 60) counts[idx]++;
        } catch (e) {}
    });

    const eps = counts.length > 0 ? Math.round(counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.filter(c => c > 0).length || 1)) : 0;
    document.getElementById('eps-value').textContent = `${eps} EPS`;

    const canvas = document.getElementById('epsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (epsChart) epsChart.destroy();

    epsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: slots.map((_, i) => (i % 10 === 0 ? slots[i].toLocaleTimeString('ru-RU', { minute: '2-digit', second: '2-digit' }) : '')),
            datasets: [{
                label: 'Events',
                data: counts,
                borderColor: '#13a4ec',
                backgroundColor: 'rgba(19, 164, 236, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true },
                x: { display: true }
            }
        }
    });
}

function updateIncidentsBadge(stats) {
    const open = stats?.by_status?.open ?? stats?.open ?? 0;
    const badge = document.getElementById('incidents-badge');
    const navBadge = document.getElementById('incidents-badge');
    if (badge) {
        badge.textContent = open;
        badge.style.display = open > 0 ? 'inline-flex' : 'none';
    }
    const notifDot = document.getElementById('notif-dot');
    if (notifDot) notifDot.style.display = open > 0 ? 'block' : 'none';
}

function setupAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    const enabled = document.getElementById('autoRefreshEnabled')?.checked ?? true;
    if (enabled && refreshIntervalMs > 0) {
        autoRefreshInterval = setInterval(loadDashboard, refreshIntervalMs);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
