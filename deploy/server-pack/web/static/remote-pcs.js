const {
    checkPageAuth,
    escapeHtml,
    setText,
    setupLogout,
} = window.AppShell;
const { getAgentStats, getStats } = window.DataClient;
let autoRefreshTimer = null;

document.addEventListener('DOMContentLoaded', async () => {
    setupLogout('logoutBtn');
    try {
        await checkPageAuth({ usernameElementId: 'username', fallbackUsername: 'Аудитор' });
        await loadInventory();
        setupSearch();
        setupAutoRefresh();
    } catch (error) {
        console.error(error);
    }
});

async function loadInventory() {
    const [agents, stats] = await Promise.all([
        getAgentStats(5).catch(() => null),
        getStats().catch(() => ({})),
    ]);
    renderInventory(agents?.last_seen || {});
    updateCards(agents, stats);
}

function renderInventory(lastSeen) {
    const tbody = document.getElementById('inventoryTableBody');
    const footer = document.getElementById('inventoryFooter');
    if (!tbody || !footer) return;
    const hosts = Object.entries(lastSeen);
    if (!hosts.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="table-empty">Агенты ещё не передавали данные.</td></tr>';
        footer.textContent = 'Показано 0 из 0';
        return;
    }
    tbody.innerHTML = hosts.slice(0, 20).map(([host, ts]) => {
        const status = ts ? 'Онлайн' : 'Офлайн';
        const statusClass = ts ? 'badge badge--success' : 'badge badge--danger';
        const lastSeenText = ts ? new Date(ts).toLocaleString('ru-RU') : '--';
        return `
            <tr>
                <td><input type="checkbox"></td>
                <td><strong>${escapeHtml(host)}</strong></td>
                <td class="mono">—</td>
                <td>Рабочая станция</td>
                <td><span class="${statusClass}">${status}</span></td>
                <td class="mono">${lastSeenText}</td>
                <td><div class="table-actions"><a href="/logs?host=${encodeURIComponent(host)}" class="action-link">Открыть логи</a></div></td>
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
    setText('onlinePercent', `${onlinePercent}% активных подключений`);
    setText('logsCollected', logsCount.toLocaleString('ru-RU'));
}

function setupSearch() {
    const input = document.getElementById('pcSearch');
    if (!input) return;
    input.addEventListener('input', () => {
        const value = input.value.trim().toLowerCase();
        const rows = Array.from(document.querySelectorAll('#inventoryTableBody tr'));
        rows.forEach((row) => {
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(value) ? '' : 'none';
        });
    });
}

function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(loadInventory, 30000);
}