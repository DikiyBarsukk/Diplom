const API_BASE = window.location.origin;
let autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await checkAuth();
        await loadInventory();
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
}

async function loadInventory() {
    const [agentsRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/agents/stats?window_minutes=5`, { credentials: 'include' }).catch(() => null),
        fetch(`${API_BASE}/stats`, { credentials: 'include' }).catch(() => null),
    ]);
    const agents = agentsRes?.ok ? await agentsRes.json() : null;
    const stats = statsRes?.ok ? await statsRes.json() : {};

    renderInventory(agents?.last_seen || {});
    updateCards(agents, stats);
}

function renderInventory(lastSeen) {
    const tbody = document.getElementById('inventoryTableBody');
    const footer = document.getElementById('inventoryFooter');
    if (!tbody || !footer) return;
    const hosts = Object.entries(lastSeen);
    if (!hosts.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="px-6 py-6 text-slate-500">Нет данных</td></tr>';
        footer.textContent = 'Показано 0 из 0';
        return;
    }
    tbody.innerHTML = hosts.slice(0, 20).map(([host, ts]) => {
        const status = ts ? 'Онлайн' : 'Офлайн';
        const statusClass = ts ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400';
        const lastSeenText = ts ? new Date(ts).toLocaleString('ru-RU') : '--';
        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-border-dark/30 transition-colors group">
                <td class="px-6 py-4">
                    <input class="rounded border-slate-300 dark:border-border-dark bg-transparent text-primary focus:ring-primary" type="checkbox"/>
                </td>
                <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                        <div class="size-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                            <span class="material-symbols-outlined text-lg">desktop_windows</span>
                        </div>
                        <span class="font-semibold text-slate-900 dark:text-white">${escapeHtml(host)}</span>
                    </div>
                </td>
                <td class="px-6 py-4 font-mono text-sm text-slate-600 dark:text-[#92b7c9]">—</td>
                <td class="px-6 py-4 text-sm text-slate-600 dark:text-slate-300">—</td>
                <td class="px-6 py-4">
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${statusClass}">
                        <span class="size-1.5 rounded-full bg-emerald-500"></span>
                        ${status}
                    </span>
                </td>
                <td class="px-6 py-4 text-sm text-slate-500 dark:text-slate-400">${lastSeenText}</td>
                <td class="px-6 py-4 text-right">
                    <div class="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <a href="/logs?host=${encodeURIComponent(host)}" class="p-1.5 rounded-md hover:bg-slate-200 dark:hover:bg-surface-dark text-slate-400 hover:text-primary">
                            <span class="material-symbols-outlined text-xl">play_circle</span>
                        </a>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
    footer.textContent = `Показано ${Math.min(hosts.length, 20)} из ${hosts.length}`;
}

function updateCards(agents, stats) {
    const total = agents?.total || 0;
    const online = agents?.online || 0;
    const logsCount = stats?.total_events || 0;
    const onlinePercent = total > 0 ? ((online / total) * 100).toFixed(1) : '0';

    setText('totalDevices', total);
    setText('onlineCount', online);
    setText('onlinePercent', `${onlinePercent}% подключений`);
    setText('logsCollected', logsCount.toLocaleString('ru-RU'));
}

function setupSearch() {
    const input = document.getElementById('pcSearch');
    if (!input) return;
    input.addEventListener('input', () => {
        const value = input.value.trim().toLowerCase();
        const rows = Array.from(document.querySelectorAll('#inventoryTableBody tr'));
        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(value) ? '' : 'none';
        });
    });
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadInventory, 30000);
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
