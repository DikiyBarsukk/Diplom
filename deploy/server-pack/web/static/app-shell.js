(() => {
    const apiBase = window.location.origin;
    const authClient = window.AuthClient;
    const RECENT_KEY = 'barsuksiem_recent_actions';
    const FAVORITES_KEY = 'barsuksiem_saved_filters';

    const severityMap = {
        emerg: { label: 'Критично', tone: 'danger' },
        alert: { label: 'Критично', tone: 'danger' },
        crit: { label: 'Критично', tone: 'danger' },
        critical: { label: 'Критично', tone: 'danger' },
        err: { label: 'Требует внимания', tone: 'warning' },
        high: { label: 'Требует внимания', tone: 'warning' },
        warn: { label: 'Требует внимания', tone: 'warning' },
        medium: { label: 'Требует внимания', tone: 'warning' },
        notice: { label: 'Норма', tone: 'success' },
        info: { label: 'Норма', tone: 'success' },
        low: { label: 'Норма', tone: 'success' },
        debug: { label: 'Норма', tone: 'success' },
    };

    const incidentStatusMap = {
        open: { label: 'Открыт', tone: 'danger' },
        investigating: { label: 'Расследуется', tone: 'warning' },
        closed: { label: 'Закрыт', tone: 'success' },
    };

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(value);
        return div.innerHTML;
    }

    function formatAgo(ts) {
        if (!ts) return '--';
        const timestamp = new Date(ts);
        const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp.getTime()) / 1000));
        if (diffSeconds < 60) return `${diffSeconds} сек назад`;
        if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} мин назад`;
        if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} ч назад`;
        return `${Math.floor(diffSeconds / 86400)} дн назад`;
    }

    function formatDateTimeRu(ts) {
        if (!ts) return '--';
        return new Date(ts).toLocaleString('ru-RU');
    }

    function getSeverityMeta(severity) {
        return severityMap[String(severity || 'info').toLowerCase()] || severityMap.info;
    }

    function getStatusMeta(status) {
        return incidentStatusMap[String(status || 'open').toLowerCase()] || incidentStatusMap.open;
    }

    function getSeverityLabel(severity) {
        return getSeverityMeta(severity).label;
    }

    function getSeverityTone(severity) {
        return getSeverityMeta(severity).tone;
    }

    function getToneClasses(tone) {
        if (tone === 'danger') return 'badge badge--danger';
        if (tone === 'warning') return 'badge badge--warning';
        return 'badge badge--success';
    }

    function getSeverityBadgeClass(labelOrSeverity) {
        const meta = ['Критично', 'Требует внимания', 'Норма'].includes(labelOrSeverity)
            ? { tone: labelOrSeverity === 'Критично' ? 'danger' : labelOrSeverity === 'Требует внимания' ? 'warning' : 'success' }
            : getSeverityMeta(labelOrSeverity);
        return getToneClasses(meta.tone);
    }

    function getStatusBadgeClass(status) {
        return getToneClasses(getStatusMeta(status).tone);
    }

    function getStatusInlineClass(tone) {
        if (tone === 'danger') return 'status-inline status-inline--danger';
        if (tone === 'warning') return 'status-inline status-inline--warning';
        return 'status-inline status-inline--success';
    }

    function debounce(func, wait) {
        let timeout;
        return function debounced(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function setupLogout(buttonId = 'logoutBtn') {
        const button = document.getElementById(buttonId);
        if (!button) return;
        button.addEventListener('click', async () => {
            try {
                await authClient.authenticatedFetch('/api/auth/logout', { method: 'POST' });
            } catch (error) {
                console.error('Logout failed:', error);
            } finally {
                window.location.href = '/login';
            }
        });
    }

    function createAutoRefreshController(loader, defaultInterval = 30000) {
        let timer = null;
        let intervalMs = defaultInterval;
        function stop() {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
        }
        function start(nextIntervalMs = intervalMs) {
            intervalMs = nextIntervalMs;
            stop();
            if (intervalMs > 0) {
                timer = setInterval(() => Promise.resolve(loader()).catch(console.error), intervalMs);
            }
        }
        return { start, stop, restart: start, getInterval: () => intervalMs };
    }

    async function fetchJson(url, fallback = null, options = {}) {
        const response = await authClient.authenticatedFetch(url, options);
        if (!response.ok) return fallback;
        return response.json();
    }

    function persistRecentAction(action) {
        const current = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
        const next = [action, ...current.filter((item) => item.url !== action.url)].slice(0, 6);
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    }

    function getRecentActions() {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    }

    function saveFavoriteFilter(filter) {
        const current = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
        const next = [filter, ...current.filter((item) => item.name !== filter.name)].slice(0, 6);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    }

    function getFavoriteFilters() {
        return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
    }

    function buildLogsUrl(params = {}) {
        const url = new URL('/logs', window.location.origin);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    }

    function setupGlobalSearch(inputId, resolver) {
        if (!inputId) return;
        const input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const query = input.value.trim();
            if (!query) return;
            const target = resolver(query);
            persistRecentAction({ title: `Поиск: ${query}`, url: target, ts: new Date().toISOString() });
            window.location.href = target;
        });
    }

    async function copyText(value) {
        await navigator.clipboard.writeText(value);
        return true;
    }

    function applyStatusBanner(elementId, label, tone, detail) {
        const element = document.getElementById(elementId);
        if (!element) return;
        element.className = getStatusInlineClass(tone);
        element.textContent = detail ? `${label} · ${detail}` : label;
    }

    window.AppShell = {
        apiBase,
        authenticatedFetch: authClient.authenticatedFetch,
        checkPageAuth: authClient.checkAuth,
        createAutoRefreshController,
        debounce,
        escapeHtml,
        fetchJson,
        formatAgo,
        formatDateTimeRu,
        getFavoriteFilters,
        getRecentActions,
        getSeverityBadgeClass,
        getSeverityLabel,
        getSeverityTone,
        getSeverityMeta,
        getStatusMeta,
        getStatusBadgeClass,
        getStatusInlineClass,
        persistRecentAction,
        saveFavoriteFilter,
        setText,
        setupGlobalSearch,
        setupLogout,
        buildLogsUrl,
        copyText,
        applyStatusBanner,
    };
})();
