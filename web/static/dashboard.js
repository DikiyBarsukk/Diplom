// API Base URL
const API_BASE = window.location.origin;

// Chart instances
let severityChart = null;
let statusChart = null;
let hostsChart = null;
let severitiesChart = null;
let timelineChart = null;

// State management
let currentPage = 1;
let pageSize = 50;
let totalEvents = 0;
let currentSort = { field: 'ts', direction: 'desc' };
let allEvents = [];
let autoRefreshInterval = null;
let refreshInterval = 30000; // 30 seconds default

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    initTheme();
    setupEventListeners(); // Привязываем обработчики сразу после инициализации темы
    
    // Инициализируем время обновления сразу и обновляем каждую секунду
    updateLastUpdateTime();
    setInterval(() => {
        updateLastUpdateTime();
    }, 1000);
    
    // Сначала проверяем аутентификацию, затем загружаем данные
    try {
        await checkAuth();
        await loadDashboard();
        setupAutoRefresh();
    } catch (error) {
        console.error('Initialization error:', error);
        updateSystemStatus(false);
    }
});

// Проверка аутентификации
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            // Не авторизован - перенаправляем на страницу входа
            window.location.href = '/login';
            throw new Error('Unauthorized');
        }
        
        if (response.ok) {
            const user = await response.json();
            const usernameEl = document.getElementById('username');
            if (usernameEl) {
                usernameEl.textContent = user.username || 'Администратор';
            }
            return true;
        }
        
        throw new Error('Auth check failed');
    } catch (error) {
        console.error('Auth check failed:', error);
        throw error;
    }
}

// Обертка для fetch с обработкой ошибок аутентификации и CSRF защитой
let csrfToken = null;

async function authenticatedFetch(url, options = {}) {
    // Получаем CSRF токен из заголовка ответа при первом запросе
    if (!csrfToken && options.method && options.method !== 'GET') {
        // Для операций изменения данных нужен CSRF токен
        const meResponse = await fetch('/api/auth/me', {
            credentials: 'include'
        });
        csrfToken = meResponse.headers.get('X-CSRF-Token');
    }
    
    const headers = {
        ...options.headers,
        'Content-Type': 'application/json'
    };
    
    // Добавляем CSRF токен для операций изменения данных
    if (csrfToken && options.method && options.method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
    }
    
    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: headers
    });
    
    // Обновляем CSRF токен из ответа
    const newCsrfToken = response.headers.get('X-CSRF-Token');
    if (newCsrfToken) {
        csrfToken = newCsrfToken;
    }
    
    if (response.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    
    return response;
}

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const themeToggle = document.getElementById('themeToggle');
    
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        if (themeToggle) {
            themeToggle.textContent = '☀️';
        }
    } else if (themeToggle) {
        themeToggle.textContent = '🌙';
    }
}

function setupEventListeners() {
    // Settings sidebar button
    const settingsSidebarBtn = document.getElementById('settingsSidebarBtn');
    if (settingsSidebarBtn) {
        settingsSidebarBtn.addEventListener('click', showSettings);
    }
    
    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadDashboard);
    }
    
    // Filters (только если элементы существуют)
    const severityFilter = document.getElementById('severityFilter');
    if (severityFilter) {
        severityFilter.addEventListener('change', () => {
            currentPage = 1;
            loadLogs();
        });
    }
    
    const hostFilter = document.getElementById('hostFilter');
    if (hostFilter) {
        hostFilter.addEventListener('change', () => {
            currentPage = 1;
            loadLogs();
        });
    }
    
    const timeFilter = document.getElementById('timeFilter');
    if (timeFilter) {
        timeFilter.addEventListener('change', handleTimeFilterChange);
    }
    
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(() => {
            currentPage = 1;
            loadLogs();
        }, 500));
    }
    
    // Pagination
    const prevPage = document.getElementById('prevPage');
    if (prevPage) {
        prevPage.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                loadLogs();
            }
        });
    }
    
    const nextPage = document.getElementById('nextPage');
    if (nextPage) {
        nextPage.addEventListener('click', () => {
            if (currentPage < Math.ceil(totalEvents / pageSize)) {
                currentPage++;
                loadLogs();
            }
        });
    }
    
    // Sorting
    document.querySelectorAll('.sortable').forEach(header => {
        header.addEventListener('click', () => {
            const field = header.dataset.sort;
            if (currentSort.field === field) {
                currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort.field = field;
                currentSort.direction = 'desc';
            }
            updateSortIndicators();
            sortAndDisplayEvents();
        });
    });
    
    // Table row clicks
    const logsTableBody = document.getElementById('logsTableBody');
    if (logsTableBody) {
        logsTableBody.addEventListener('click', (e) => {
            const row = e.target.closest('tr');
            if (row && row.dataset.eventIndex !== undefined) {
                showEventDetails(parseInt(row.dataset.eventIndex));
            }
        });
    }
    
    // Modal close
    const modalClose = document.getElementById('modalClose');
    if (modalClose) {
        modalClose.addEventListener('click', closeEventModal);
    }
    
    const settingsClose = document.getElementById('settingsClose');
    if (settingsClose) {
        settingsClose.addEventListener('click', closeSettingsModal);
    }
    
    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        // Используем onclick для надежности (работает даже если addEventListener не сработал)
        themeToggle.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleTheme();
            return false;
        };
        // Также добавляем через addEventListener для совместимости
        themeToggle.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            toggleTheme();
        });
    }
    
    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', showSettings);
    }
    
    const refreshInterval = document.getElementById('refreshInterval');
    if (refreshInterval) {
        refreshInterval.addEventListener('change', updateRefreshInterval);
    }
    
    const autoRefreshEnabled = document.getElementById('autoRefreshEnabled');
    if (autoRefreshEnabled) {
        autoRefreshEnabled.addEventListener('change', toggleAutoRefresh);
    }
    
    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await authenticatedFetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
            } catch (error) {
                window.location.href = '/login';
            }
        });
    }
    
    // Export
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportToCSV);
    }
    
    // Timeline period
    const timelinePeriod = document.getElementById('timelinePeriod');
    if (timelinePeriod) {
        timelinePeriod.addEventListener('change', updateTimelineChart);
    }
    
    // Close modals on outside click
    window.addEventListener('click', (e) => {
        const eventModal = document.getElementById('eventModal');
        const settingsModal = document.getElementById('settingsModal');
        if (e.target === eventModal) closeEventModal();
        if (e.target === settingsModal) closeSettingsModal();
    });
    
    // Notification bell click - открываем список инцидентов (если будет реализована страница)
    const notificationsEl = document.querySelector('.notifications');
    if (notificationsEl) {
        notificationsEl.addEventListener('click', () => {
            // Можно открыть модальное окно с инцидентами или перенаправить на страницу
            alert('Функция просмотра инцидентов будет реализована. Показывается количество необработанных инцидентов безопасности.');
            // В будущем: window.location.href = '/incidents';
        });
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function handleTimeFilterChange() {
    const timeFilterEl = document.getElementById('timeFilter');
    if (!timeFilterEl) return;
    
    const timeFilter = timeFilterEl.value;
    const customRange = document.getElementById('customDateRange');
    if (timeFilter === 'custom' && customRange) {
        customRange.style.display = 'flex';
    } else {
        if (customRange) customRange.style.display = 'none';
        currentPage = 1;
        loadLogs();
    }
}

async function loadDashboard() {
    try {
        console.log('Loading dashboard...');
        // Показываем статус "загрузка" перед запросами
        const statusEl = document.getElementById('system-status');
        if (statusEl) {
            statusEl.innerHTML = '<span class="status-dot" style="background: #f59e0b;"></span> Загрузка...';
        }
        
        // Load stats
        console.log('Fetching stats from:', `${API_BASE}/api/stats`);
        const statsResponse = await authenticatedFetch(`${API_BASE}/api/stats`);
        if (!statsResponse.ok) {
            const errorText = await statsResponse.text();
            console.error('Stats response error:', statsResponse.status, errorText);
            throw new Error(`Stats request failed: ${statsResponse.status}`);
        }
        const stats = await statsResponse.json();
        console.log('Stats received:', stats);
        
        // Load events for calculations
        console.log('Fetching events from:', `${API_BASE}/api/logs?limit=1000`);
        const eventsResponse = await authenticatedFetch(`${API_BASE}/api/logs?limit=1000`);
        if (!eventsResponse.ok) {
            const errorText = await eventsResponse.text();
            console.error('Events response error:', eventsResponse.status, errorText);
            throw new Error(`Events request failed: ${eventsResponse.status}`);
        }
        const events = await eventsResponse.json();
        console.log('Events received:', events?.length || 0, 'events');
        
        // Load incidents for alert count
        try {
            const incidentsStatsResponse = await authenticatedFetch(`${API_BASE}/api/incidents/stats`);
            if (incidentsStatsResponse.ok) {
                const incidentsStats = await incidentsStatsResponse.json();
                // Показываем количество открытых (необработанных) инцидентов
                const openIncidents = incidentsStats.open || 0;
                const alertCountEl = document.getElementById('alert-count');
                if (alertCountEl) {
                    alertCountEl.textContent = openIncidents;
                    // Скрываем бейдж, если инцидентов нет
                    alertCountEl.style.display = openIncidents > 0 ? 'flex' : 'none';
                }
                console.log('Incidents stats received:', incidentsStats);
            }
        } catch (error) {
            console.warn('Failed to load incidents stats:', error);
            // Если не удалось загрузить инциденты, показываем критические события
            const criticalCount = (stats.severity?.emerg || 0) + 
                                 (stats.severity?.alert || 0) + 
                                 (stats.severity?.crit || 0);
            const alertCountEl = document.getElementById('alert-count');
            if (alertCountEl) {
                alertCountEl.textContent = criticalCount;
                alertCountEl.style.display = criticalCount > 0 ? 'flex' : 'none';
            }
        }
        
        // Проверяем, что данные получены (events может быть пустым массивом - это нормально)
        if (!stats) {
            throw new Error('Invalid stats data received');
        }
        if (!Array.isArray(events)) {
            throw new Error('Invalid events data received');
        }
        
        console.log('Updating UI with data...');
        updateMetrics(stats, events);
        updateCharts(stats, events);
        updateHostFilter(stats);
        updateLastUpdateTime(); // Обновляем время после успешной загрузки
        updateSystemStatus(true); // Убеждаемся, что статус установлен как онлайн
        
        // Store all events for sorting/filtering
        allEvents = events;
        totalEvents = stats.total_events || 0;
        
        // Загружаем логи только если элементы существуют
        const logsTableBody = document.getElementById('logsTableBody');
        if (logsTableBody) {
            loadLogs();
        }
        
        console.log('Dashboard loaded successfully');
    } catch (error) {
        console.error('Error loading dashboard:', error);
        updateSystemStatus(false);
        
        // Показываем сообщение об ошибке пользователю
        const tableInfo = document.getElementById('table-info');
        if (tableInfo) {
            tableInfo.textContent = `Ошибка загрузки данных: ${error.message}`;
        }
        
        // Также показываем в консоли для отладки
        console.error('Full error:', error);
    }
}

function updateMetrics(stats, events) {
    const totalEvents = stats.total_events || 0;
    const severityCounts = stats.severity || {};
    
    // Calculate critical events (emerg, alert, crit)
    const criticalCount = (severityCounts.emerg || 0) + 
                         (severityCounts.alert || 0) + 
                         (severityCounts.crit || 0);
    
    const criticalPercent = totalEvents > 0 ? 
        ((criticalCount / totalEvents) * 100).toFixed(1) : 0;
    
    // Calculate average threshold (simplified)
    const avgThreshold = totalEvents > 0 ? 
        (totalEvents / Object.keys(stats.hosts || {}).length || 1).toFixed(1) : 0;
    
    // Analysis progress (events with severity analyzed)
    const analyzedCount = totalEvents - (severityCounts.debug || 0);
    const analysisProgress = totalEvents > 0 ? 
        ((analyzedCount / totalEvents) * 100).toFixed(1) : 0;
    
    // Response progress (simplified - events responded to)
    const responseProgress = criticalCount > 0 ? 
        ((criticalCount * 0.6) / criticalCount * 100).toFixed(1) : 0;
    
    const criticalPercentEl = document.getElementById('critical-percent');
    const criticalCountEl = document.getElementById('critical-count');
    const avgThresholdEl = document.getElementById('avg-threshold');
    const analysisProgressEl = document.getElementById('analysis-progress');
    const responseProgressEl = document.getElementById('response-progress');
    const totalEventsCountEl = document.getElementById('total-events-count');
    const alertCountEl = document.getElementById('alert-count');
    
    if (criticalPercentEl) criticalPercentEl.textContent = `${criticalPercent}%`;
    if (criticalCountEl) criticalCountEl.textContent = criticalCount;
    if (avgThresholdEl) avgThresholdEl.textContent = avgThreshold;
    if (analysisProgressEl) analysisProgressEl.textContent = `${analysisProgress}%`;
    if (responseProgressEl) responseProgressEl.textContent = `${responseProgress}%`;
    if (totalEventsCountEl) totalEventsCountEl.textContent = totalEvents.toLocaleString('ru-RU');
    
    // alert-count теперь обновляется из инцидентов в loadDashboard
    // Если инциденты не загрузились, показываем критические события как fallback
    if (alertCountEl && alertCountEl.textContent === '0' || !alertCountEl.textContent) {
        alertCountEl.textContent = criticalCount;
        alertCountEl.style.display = criticalCount > 0 ? 'flex' : 'none';
    }
}

function updateCharts(stats, events) {
    updateSeverityChart(stats);
    updateStatusChart(events);
    updateHostsChart(stats);
    updateSeveritiesChart(stats);
    updateHeatMap(events);
    updateTimelineChart(events);
}

function updateSeverityChart(stats) {
    const canvas = document.getElementById('severityChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const severityCounts = stats.severity || {};
    
    const severityLabels = {
        'emerg': 'Критический',
        'alert': 'Высокий',
        'crit': 'Высокий',
        'err': 'Средний',
        'warn': 'Средний',
        'notice': 'Низкий',
        'info': 'Низкий',
        'debug': 'Низкий'
    };
    
    // Group by risk level
    const grouped = {
        'Критический': 0,
        'Высокий': 0,
        'Средний': 0,
        'Низкий': 0
    };
    
    Object.entries(severityCounts).forEach(([sev, count]) => {
        const level = severityLabels[sev] || 'Низкий';
        grouped[level] = (grouped[level] || 0) + count;
    });
    
    const labels = Object.keys(grouped).filter(k => grouped[k] > 0);
    const data = labels.map(k => grouped[k]);
    const colors = labels.map(k => {
        if (k === 'Критический') return '#dc2626';
        if (k === 'Высокий') return '#f59e0b';
        if (k === 'Средний') return '#fbbf24';
        return '#10b981';
    });
    
    if (severityChart) {
        severityChart.destroy();
    }
    
    severityChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'right'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const label = labels[index];
                    // Filter by severity level
                    filterBySeverityLevel(label);
                }
            }
        }
    });
}

function updateStatusChart(events) {
    const canvas = document.getElementById('statusChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Распределяем события по статусам на основе их severity
    let tbd = 0;        // Требует решения - критические события
    let implemented = 0; // Реализовано - обработанные ошибки
    let planned = 0;    // Запланировано - предупреждения
    let deferred = 0;   // Отложено - информационные события
    
    events.forEach(event => {
        const severity = (event.severity || 'info').toLowerCase();
        if (severity === 'emerg' || severity === 'alert' || severity === 'crit') {
            tbd++;
        } else if (severity === 'err') {
            implemented++;
        } else if (severity === 'warn') {
            planned++;
        } else {
            deferred++;
        }
    });
    
    // Если нет событий, используем демо-данные для визуализации
    const total = events.length || 1;
    if (total === 0 || (tbd === 0 && implemented === 0 && planned === 0 && deferred === 0)) {
        tbd = Math.floor(total * 0.576);
        implemented = Math.floor(total * 0.329);
        planned = Math.floor(total * 0.072);
        deferred = total - tbd - implemented - planned;
    }
    
    if (statusChart) {
        statusChart.destroy();
    }
    
    statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Требует решения', 'Реализовано', 'Запланировано', 'Отложено'],
            datasets: [{
                data: [tbd, implemented, planned, deferred],
                backgroundColor: [
                    '#ef4444',
                    '#10b981',
                    '#f59e0b',
                    '#6b7280'
                ],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'right'
                }
            }
        }
    });
}

function updateHostsChart(stats) {
    const canvas = document.getElementById('hostsChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const hosts = stats.hosts || {};
    
    const sortedHosts = Object.entries(hosts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const labels = sortedHosts.map(([host]) => host);
    const data = sortedHosts.map(([, count]) => count);
    
    if (hostsChart) {
        hostsChart.destroy();
    }
    
    hostsChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'События',
                data: data,
                backgroundColor: '#3b82f6',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Событий: ${context.parsed.x}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const host = labels[index];
                    const hostFilter = document.getElementById('hostFilter');
                    if (hostFilter) {
                        hostFilter.value = host;
                        currentPage = 1;
                        loadLogs();
                    } else {
                        // Если на странице аналитики - перенаправляем на страницу логов
                        window.location.href = `/logs?host=${encodeURIComponent(host)}`;
                    }
                }
            }
        }
    });
}

function updateSeveritiesChart(stats) {
    const canvas = document.getElementById('severitiesChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const severityCounts = stats.severity || {};
    
    const sorted = Object.entries(severityCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    const severityTranslations = {
        'emerg': 'АВАРИЙНАЯ',
        'alert': 'ТРЕВОГА',
        'crit': 'КРИТИЧЕСКАЯ',
        'err': 'ОШИБКА',
        'warn': 'ПРЕДУПРЕЖДЕНИЕ',
        'notice': 'УВЕДОМЛЕНИЕ',
        'info': 'ИНФОРМАЦИЯ',
        'debug': 'ОТЛАДКА'
    };
    const labels = sorted.map(([sev]) => severityTranslations[sev] || sev.toUpperCase());
    const data = sorted.map(([, count]) => count);
    
    if (severitiesChart) {
        severitiesChart.destroy();
    }
    
    severitiesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'События',
                data: data,
                backgroundColor: '#8b5cf6',
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Событий: ${context.parsed.x}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true
                }
            },
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const severity = sorted[index][0];
                    const severityFilter = document.getElementById('severityFilter');
                    if (severityFilter) {
                        severityFilter.value = severity;
                        currentPage = 1;
                        loadLogs();
                    } else {
                        // Если на странице аналитики - перенаправляем на страницу логов
                        window.location.href = `/logs?severity=${encodeURIComponent(severity)}`;
                    }
                }
            }
        }
    });
}

function updateTimelineChart(events) {
    const ctx = document.getElementById('timelineChart');
    if (!ctx) return;
    
    const period = document.getElementById('timelinePeriod').value;
    const now = new Date();
    let timeSlots = [];
    let eventCounts = [];
    
    if (period === '24h') {
        // Группировка по часам для 24 часов
        for (let i = 23; i >= 0; i--) {
            const time = new Date(now);
            time.setHours(time.getHours() - i);
            time.setMinutes(0);
            time.setSeconds(0);
            time.setMilliseconds(0);
            timeSlots.push(time);
            eventCounts.push(0);
        }
        
        events.forEach(event => {
            try {
                const eventTime = new Date(event.ts);
                const hoursDiff = Math.floor((now - eventTime) / (1000 * 60 * 60));
                if (hoursDiff >= 0 && hoursDiff < 24) {
                    eventCounts[23 - hoursDiff]++;
                }
            } catch (e) {
                // Ignore invalid dates
            }
        });
    } else if (period === '7d') {
        // Группировка по дням для 7 дней
        for (let i = 6; i >= 0; i--) {
            const time = new Date(now);
            time.setDate(time.getDate() - i);
            time.setHours(0);
            time.setMinutes(0);
            time.setSeconds(0);
            time.setMilliseconds(0);
            timeSlots.push(time);
            eventCounts.push(0);
        }
        
        events.forEach(event => {
            try {
                const eventTime = new Date(event.ts);
                const daysDiff = Math.floor((now - eventTime) / (1000 * 60 * 60 * 24));
                if (daysDiff >= 0 && daysDiff < 7) {
                    eventCounts[6 - daysDiff]++;
                }
            } catch (e) {
                // Ignore invalid dates
            }
        });
    } else if (period === '30d') {
        // Группировка по дням для 30 дней
        for (let i = 29; i >= 0; i--) {
            const time = new Date(now);
            time.setDate(time.getDate() - i);
            time.setHours(0);
            time.setMinutes(0);
            time.setSeconds(0);
            time.setMilliseconds(0);
            timeSlots.push(time);
            eventCounts.push(0);
        }
        
        events.forEach(event => {
            try {
                const eventTime = new Date(event.ts);
                const daysDiff = Math.floor((now - eventTime) / (1000 * 60 * 60 * 24));
                if (daysDiff >= 0 && daysDiff < 30) {
                    eventCounts[29 - daysDiff]++;
                }
            } catch (e) {
                // Ignore invalid dates
            }
        });
    }
    
    if (timelineChart) {
        timelineChart.destroy();
    }
    
    const formatLabel = (date) => {
        if (period === '24h') {
            return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        } else {
            return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        }
    };
    
    timelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: timeSlots.map(formatLabel),
            datasets: [{
                label: 'События',
                data: eventCounts,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `Событий: ${context.parsed.y}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

function updateHeatMap(events) {
    const tbody = document.getElementById('heatmapBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    const severities = ['Критическая', 'Высокая', 'Средняя', 'Низкая', 'Незначительная'];
    const likelihoods = ['Редко', 'Маловероятно', 'Умеренно', 'Вероятно', 'Почти наверняка'];
    
    // Маппинг severity из события в категории тепловой карты
    const severityMap = {
        'emerg': 'Критическая',
        'alert': 'Высокая',
        'crit': 'Высокая',
        'err': 'Средняя',
        'warn': 'Средняя',
        'notice': 'Низкая',
        'info': 'Низкая',
        'debug': 'Незначительная'
    };
    
    // Подсчитываем частоту повторений сообщений и паттернов для определения likelihood
    const messageFrequency = {};
    const patternFrequency = {}; // Группировка по паттернам (без конкретных значений)
    
    events.forEach(event => {
        const message = (event.message || '').substring(0, 100);
        messageFrequency[message] = (messageFrequency[message] || 0) + 1;
        
        // Создаем паттерн из сообщения (убираем числа, IP адреса и т.д.)
        const pattern = message
            .replace(/\d+\.\d+\.\d+\.\d+/g, 'IP') // IP адреса
            .replace(/\d+/g, 'N') // Числа
            .replace(/\s+/g, ' ') // Множественные пробелы
            .trim();
        patternFrequency[pattern] = (patternFrequency[pattern] || 0) + 1;
    });
    
    // Определяем максимальную частоту для нормализации
    const maxFrequency = Math.max(...Object.values(messageFrequency), 1);
    const maxPatternFrequency = Math.max(...Object.values(patternFrequency), 1);
    
    // Подсчитываем частоту по хостам и процессам для дополнительного контекста
    const hostFrequency = {};
    const processFrequency = {};
    events.forEach(event => {
        const host = event.host || 'unknown';
        const process = event.process || 'unknown';
        hostFrequency[host] = (hostFrequency[host] || 0) + 1;
        processFrequency[process] = (processFrequency[process] || 0) + 1;
    });
    const maxHostFrequency = Math.max(...Object.values(hostFrequency), 1);
    const maxProcessFrequency = Math.max(...Object.values(processFrequency), 1);
    
    const heatmapData = {};
    severities.forEach(sev => {
        heatmapData[sev] = {};
        likelihoods.forEach(lik => {
            heatmapData[sev][lik] = 0;
        });
    });
    
    // Распределяем события по тепловой карте
    events.forEach(event => {
        // Определяем severity категорию
        const eventSeverity = (event.severity || 'info').toLowerCase();
        const severityCategory = severityMap[eventSeverity] || 'Низкая';
        
        // Определяем likelihood на основе комбинации факторов
        const message = (event.message || '').substring(0, 100);
        const messageFreq = messageFrequency[message] || 1;
        const messageRatio = messageFreq / maxFrequency;
        
        // Паттерн частоты
        const pattern = message
            .replace(/\d+\.\d+\.\d+\.\d+/g, 'IP')
            .replace(/\d+/g, 'N')
            .replace(/\s+/g, ' ')
            .trim();
        const patternFreq = patternFrequency[pattern] || 1;
        const patternRatio = patternFreq / maxPatternFrequency;
        
        // Частота хоста и процесса
        const host = event.host || 'unknown';
        const process = event.process || 'unknown';
        const hostRatio = (hostFrequency[host] || 1) / maxHostFrequency;
        const processRatio = (processFrequency[process] || 1) / maxProcessFrequency;
        
        // Комбинированный показатель likelihood (взвешенная сумма)
        // Больше веса у точных совпадений сообщений, меньше у паттернов
        const combinedRatio = (messageRatio * 0.5) + (patternRatio * 0.3) + 
                             (hostRatio * 0.1) + (processRatio * 0.1);
        
        let likelihoodCategory;
        if (combinedRatio >= 0.7) {
            likelihoodCategory = 'Почти наверняка';
        } else if (combinedRatio >= 0.5) {
            likelihoodCategory = 'Вероятно';
        } else if (combinedRatio >= 0.3) {
            likelihoodCategory = 'Умеренно';
        } else if (combinedRatio >= 0.15) {
            likelihoodCategory = 'Маловероятно';
        } else {
            likelihoodCategory = 'Редко';
        }
        
        heatmapData[severityCategory][likelihoodCategory]++;
    });
    
    // Находим максимальное значение для нормализации цветов
    let maxCount = 0;
    severities.forEach(sev => {
        likelihoods.forEach(lik => {
            maxCount = Math.max(maxCount, heatmapData[sev][lik]);
        });
    });
    
    // Отображаем тепловую карту
    severities.forEach(severity => {
        const row = document.createElement('tr');
        const severityCell = document.createElement('td');
        severityCell.textContent = severity;
        row.appendChild(severityCell);
        
        likelihoods.forEach(likelihood => {
            const cell = document.createElement('td');
            const count = heatmapData[severity][likelihood];
            cell.textContent = count;
            cell.className = 'heatmap-cell';
            
            // Динамическая окраска на основе относительного значения
            if (maxCount > 0) {
                const ratio = count / maxCount;
                if (ratio >= 0.7) {
                    cell.classList.add('high');
                } else if (ratio >= 0.4) {
                    cell.classList.add('medium');
                } else {
                    cell.classList.add('low');
                }
            } else {
                cell.classList.add('low');
            }
            
            row.appendChild(cell);
        });
        
        tbody.appendChild(row);
    });
}

function updateHostFilter(stats) {
    const hostFilter = document.getElementById('hostFilter');
    const hosts = Object.keys(stats.hosts || {}).sort();
    
    // Clear existing options except "All hosts"
    hostFilter.innerHTML = '<option value="">Все хосты</option>';
    
    hosts.forEach(host => {
        const option = document.createElement('option');
        option.value = host;
        option.textContent = host;
        hostFilter.appendChild(option);
    });
}

async function loadLogs() {
    try {
        const severityFilter = document.getElementById('severityFilter');
        const hostFilter = document.getElementById('hostFilter');
        const searchInput = document.getElementById('searchInput');
        const timeFilterEl = document.getElementById('timeFilter');
        
        // Если элементов нет (например, на странице аналитики), не загружаем логи
        if (!severityFilter || !hostFilter || !searchInput || !timeFilterEl) {
            return;
        }
        
        const severity = severityFilter.value;
        const host = hostFilter.value;
        const search = searchInput.value;
        const timeFilter = timeFilterEl.value;
        
        let url = `${API_BASE}/api/logs?limit=10000`;
        if (severity) url += `&severity=${severity}`;
        if (host) url += `&host=${encodeURIComponent(host)}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        // Handle time filter
        if (timeFilter && timeFilter !== 'custom') {
            const since = getSinceDate(timeFilter);
            if (since) url += `&since=${since}`;
        } else if (timeFilter === 'custom') {
            const dateFrom = document.getElementById('dateFrom');
            const dateTo = document.getElementById('dateTo');
            if (dateFrom && dateFrom.value) {
                url += `&since=${new Date(dateFrom.value).toISOString()}`;
            }
        }
        
        const response = await authenticatedFetch(url);
        const events = await response.json();
        
        allEvents = events;
        sortAndDisplayEvents();
    } catch (error) {
        console.error('Error loading logs:', error);
        document.getElementById('table-info').textContent = 'Ошибка загрузки данных';
    }
}

function getSinceDate(period) {
    const now = new Date();
    let since;
    
    switch(period) {
        case '1h':
            since = new Date(now.getTime() - 60 * 60 * 1000);
            break;
        case '6h':
            since = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            break;
        case '24h':
            since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case '7d':
            since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        default:
            return null;
    }
    
    return since.toISOString();
}

function sortAndDisplayEvents() {
    // Sort events
    const sorted = [...allEvents].sort((a, b) => {
        let aVal = a[currentSort.field];
        let bVal = b[currentSort.field];
        
        // Handle dates
        if (currentSort.field === 'ts') {
            aVal = new Date(aVal || 0).getTime();
            bVal = new Date(bVal || 0).getTime();
        }
        
        // Handle numbers
        if (currentSort.field === 'pid') {
            aVal = parseInt(aVal) || 0;
            bVal = parseInt(bVal) || 0;
        }
        
        // Handle strings
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        
        if (currentSort.direction === 'asc') {
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
            return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
    });
    
    // Paginate
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginated = sorted.slice(start, end);
    
    displayLogs(paginated);
    updatePaginationInfo(sorted.length);
}

function updateSortIndicators() {
    document.querySelectorAll('.sortable').forEach(header => {
        header.classList.remove('asc', 'desc');
        if (header.dataset.sort === currentSort.field) {
            header.classList.add(currentSort.direction);
        }
    });
}

function updatePaginationInfo(total) {
    totalEvents = total;
    const totalPages = Math.ceil(total / pageSize);
    
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) {
        pageInfo.textContent = 
            `Страница ${currentPage} из ${totalPages} (Всего: ${total.toLocaleString('ru-RU')})`;
    }
    
    const prevPage = document.getElementById('prevPage');
    if (prevPage) {
        prevPage.disabled = currentPage === 1;
    }
    
    const nextPage = document.getElementById('nextPage');
    if (nextPage) {
        nextPage.disabled = currentPage >= totalPages;
    }
}

function displayLogs(events) {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    if (events.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = '<td colspan="6" class="loading">События не найдены</td>';
        tbody.appendChild(row);
        return;
    }
    
    events.forEach((event, index) => {
        const row = document.createElement('tr');
        row.dataset.eventIndex = allEvents.indexOf(event);
        
        const formatDate = (dateStr) => {
            if (!dateStr) return 'Н/Д';
            try {
                const date = new Date(dateStr);
                return date.toLocaleString('ru-RU');
            } catch {
                return dateStr;
            }
        };
        
        const severity = event.severity || 'info';
        const severityClass = `severity-${severity}`;
        
        const severityTranslations = {
            'emerg': 'Аварийная',
            'alert': 'Тревога',
            'crit': 'Критическая',
            'err': 'Ошибка',
            'warn': 'Предупреждение',
            'notice': 'Уведомление',
            'info': 'Информация',
            'debug': 'Отладка'
        };
        const severityLabel = severityTranslations[severity] || severity;
        
        row.innerHTML = `
            <td>${formatDate(event.ts)}</td>
            <td><span class="severity-badge ${severityClass}">${severityLabel}</span></td>
            <td>${event.host || 'Н/Д'}</td>
            <td>${event.unit || 'Н/Д'}</td>
            <td>${event.pid || 'Н/Д'}</td>
            <td>${(event.message || '').substring(0, 100)}${(event.message || '').length > 100 ? '...' : ''}</td>
        `;
        
        tbody.appendChild(row);
    });
}

function showEventDetails(eventIndex) {
    const event = allEvents[eventIndex];
    if (!event) return;
    
    const modal = document.getElementById('eventModal');
    const body = document.getElementById('modalBody');
    
    const severityTranslations = {
        'emerg': 'Аварийная',
        'alert': 'Тревога',
        'crit': 'Критическая',
        'err': 'Ошибка',
        'warn': 'Предупреждение',
        'notice': 'Уведомление',
        'info': 'Информация',
        'debug': 'Отладка'
    };
    
    const formatDate = (dateStr) => {
        if (!dateStr) return 'Н/Д';
        try {
            const date = new Date(dateStr);
            return date.toLocaleString('ru-RU');
        } catch {
            return dateStr;
        }
    };
    
    body.innerHTML = `
        <div class="event-detail-item">
            <div class="event-detail-label">Время</div>
            <div class="event-detail-value">${formatDate(event.ts)}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">Уровень важности</div>
            <div class="event-detail-value">${severityTranslations[event.severity] || event.severity}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">Хост</div>
            <div class="event-detail-value">${event.host || 'Н/Д'}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">Источник</div>
            <div class="event-detail-value">${event.source || 'Н/Д'}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">Служба</div>
            <div class="event-detail-value">${event.unit || 'Н/Д'}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">Процесс</div>
            <div class="event-detail-value">${event.process || 'Н/Д'}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">PID</div>
            <div class="event-detail-value">${event.pid || 'Н/Д'}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">UID</div>
            <div class="event-detail-value">${event.uid || 'Н/Д'}</div>
        </div>
        <div class="event-detail-item">
            <div class="event-detail-label">Сообщение</div>
            <div class="event-detail-value">${event.message || 'Н/Д'}</div>
        </div>
        ${event.raw ? `
        <div class="event-detail-item">
            <div class="event-detail-label">Исходные данные</div>
            <div class="event-detail-value">
                <pre>${JSON.stringify(event.raw, null, 2)}</pre>
            </div>
        </div>
        ` : ''}
    `;
    
    modal.classList.add('show');
}

function closeEventModal() {
    document.getElementById('eventModal').classList.remove('show');
}

function showSettings() {
    document.getElementById('settingsModal').classList.add('show');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
}

function toggleTheme() {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    const themeToggle = document.getElementById('themeToggle');
    
    if (themeToggle) {
        themeToggle.textContent = isDark ? '☀️' : '🌙';
    }
    
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function updateRefreshInterval() {
    refreshInterval = parseInt(document.getElementById('refreshInterval').value) * 1000;
    setupAutoRefresh();
}

function toggleAutoRefresh() {
    const enabled = document.getElementById('autoRefreshEnabled').checked;
    if (enabled) {
        setupAutoRefresh();
    } else {
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            autoRefreshInterval = null;
        }
    }
}

function setupAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    const enabled = document.getElementById('autoRefreshEnabled')?.checked ?? true;
    if (enabled && refreshInterval > 0) {
        autoRefreshInterval = setInterval(loadDashboard, refreshInterval);
    }
}

function updateLastUpdateTime() {
    const timeEl = document.getElementById('last-update-time');
    if (!timeEl) return;
    
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('ru-RU');
}

function updateSystemStatus(online) {
    const statusEl = document.getElementById('system-status');
    if (!statusEl) return;
    
    if (online) {
        statusEl.innerHTML = '<span class="status-dot online"></span> Онлайн';
    } else {
        statusEl.innerHTML = '<span class="status-dot offline"></span> Оффлайн';
    }
}

function exportToCSV() {
    const headers = ['Время', 'Важность', 'Хост', 'Служба', 'PID', 'Сообщение'];
    const rows = allEvents.map(event => {
        const formatDate = (dateStr) => {
            if (!dateStr) return 'Н/Д';
            try {
                return new Date(dateStr).toLocaleString('ru-RU');
            } catch {
                return dateStr;
            }
        };
        
        const severityTranslations = {
            'emerg': 'Аварийная',
            'alert': 'Тревога',
            'crit': 'Критическая',
            'err': 'Ошибка',
            'warn': 'Предупреждение',
            'notice': 'Уведомление',
            'info': 'Информация',
            'debug': 'Отладка'
        };
        
        return [
            formatDate(event.ts),
            severityTranslations[event.severity] || event.severity,
            event.host || 'Н/Д',
            event.unit || 'Н/Д',
            event.pid || 'Н/Д',
            `"${(event.message || '').replace(/"/g, '""')}"`
        ];
    });
    
    const csv = [
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `events_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

function exportChart(chartId, name) {
    const chart = chartId === 'hostsChart' ? hostsChart : 
                  chartId === 'severitiesChart' ? severitiesChart : null;
    
    if (!chart) return;
    
    const url = chart.toBase64Image();
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}_${new Date().toISOString().split('T')[0]}.png`;
    link.click();
}

function filterBySeverityLevel(level) {
    const severityMap = {
        'Критический': 'emerg',
        'Высокий': 'alert',
        'Средний': 'err',
        'Низкий': 'info'
    };
    
    const severity = severityMap[level];
    if (severity) {
        const severityFilter = document.getElementById('severityFilter');
        if (severityFilter) {
            severityFilter.value = severity;
            currentPage = 1;
            loadLogs();
        } else {
            // Если на странице аналитики - перенаправляем на страницу логов
            window.location.href = `/logs?severity=${encodeURIComponent(severity)}`;
        }
    }
}


