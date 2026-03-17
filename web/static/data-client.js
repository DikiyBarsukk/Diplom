(() => {
    const { apiBase, fetchJson } = window.AppShell;

    function withQuery(basePath, params = {}) {
        const url = new URL(`${apiBase}${basePath}`);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== '') {
                url.searchParams.set(key, value);
            }
        });
        return url.toString();
    }

    async function getStats() {
        return fetchJson(withQuery('/api/stats'), {});
    }

    async function getLogs(params = {}) {
        return fetchJson(withQuery('/api/logs', params), []);
    }

    async function getIncidents(params = {}) {
        return fetchJson(withQuery('/api/incidents', params), []);
    }

    async function getIncidentStats() {
        return fetchJson(withQuery('/api/incidents/stats'), {});
    }

    async function getAgentStats(windowMinutes = 5) {
        return fetchJson(withQuery('/api/agents/stats', { window_minutes: windowMinutes }), null);
    }

    window.DataClient = {
        getAgentStats,
        getIncidentStats,
        getIncidents,
        getLogs,
        getStats,
    };
})();
