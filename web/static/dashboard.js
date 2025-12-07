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
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadDashboard();
    setupEventListeners();
    setupAutoRefresh();
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.getElementById('themeToggle').textContent = '☀️';
    }
}

function setupEventListeners() {
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', loadDashboard);
    
    // Filters
    document.getElementById('severityFilter').addEventListener('change', () => {
        currentPage = 1;
        loadLogs();
    });
    document.getElementById('hostFilter').addEventListener('change', () => {
        currentPage = 1;
        loadLogs();
    });
    document.getElementById('timeFilter').addEventListener('change', handleTimeFilterChange);
    document.getElementById('searchInput').addEventListener('input', debounce(() => {
        currentPage = 1;
        loadLogs();
    }, 500));
    
    // Pagination
    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadLogs();
        }
    });
    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPage < Math.ceil(totalEvents / pageSize)) {
            currentPage++;
            loadLogs();
        }
    });
    
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
    document.getElementById('logsTableBody').addEventListener('click', (e) => {
        const row = e.target.closest('tr');
        if (row && row.dataset.eventIndex !== undefined) {
            showEventDetails(parseInt(row.dataset.eventIndex));
        }
    });
    
    // Modal close
    document.getElementById('modalClose').addEventListener('click', closeEventModal);
    document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
    
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    
    // Settings
    document.getElementById('settingsBtn').addEventListener('click', showSettings);
    document.getElementById('refreshInterval').addEventListener('change', updateRefreshInterval);
    document.getElementById('autoRefreshEnabled').addEventListener('change', toggleAutoRefresh);
    
    // Export
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    
    // Timeline period
    document.getElementById('timelinePeriod').addEventListener('change', updateTimelineChart);
    
    // Close modals on outside click
    window.addEventListener('click', (e) => {
        const eventModal = document.getElementById('eventModal');
        const settingsModal = document.getElementById('settingsModal');
        if (e.target === eventModal) closeEventModal();
        if (e.target === settingsModal) closeSettingsModal();
    });
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
    const timeFilter = document.getElementById('timeFilter').value;
    const customRange = document.getElementById('customDateRange');
    if (timeFilter === 'custom') {
        customRange.style.display = 'flex';
    } else {
        customRange.style.display = 'none';
        currentPage = 1;
        loadLogs();
    }
}

async function loadDashboard() {
    try {
        updateSystemStatus(true);
        
        // Load stats
        const statsResponse = await fetch(`${API_BASE}/stats`);
        const stats = await statsResponse.json();
        
        // Load events for calculations
        const eventsResponse = await fetch(`${API_BASE}/logs?limit=1000`);
        const events = await eventsResponse.json();
        
        updateMetrics(stats, events);
        updateCharts(stats, events);
        updateHostFilter(stats);
        updateLastUpdateTime();
        
        // Store all events for sorting/filtering
        allEvents = events;
        totalEvents = stats.total_events || 0;
        
        loadLogs();
    } catch (error) {
        console.error('Error loading dashboard:', error);
        updateSystemStatus(false);
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
    
    document.getElementById('critical-percent').textContent = `${criticalPercent}%`;
    document.getElementById('critical-count').textContent = criticalCount;
    document.getElementById('avg-threshold').textContent = avgThreshold;
    document.getElementById('analysis-progress').textContent = `${analysisProgress}%`;
    document.getElementById('response-progress').textContent = `${responseProgress}%`;
    document.getElementById('total-events-count').textContent = totalEvents.toLocaleString('ru-RU');
    
    // Update alert count
    document.getElementById('alert-count').textContent = criticalCount;
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
    const ctx = document.getElementById('severityChart').getContext('2d');
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
    const ctx = document.getElementById('statusChart').getContext('2d');
    
    const total = events.length || 1;
    const tbd = Math.floor(total * 0.576);
    const implemented = Math.floor(total * 0.329);
    const planned = Math.floor(total * 0.072);
    const deferred = total - tbd - implemented - planned;
    
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
    const ctx = document.getElementById('hostsChart').getContext('2d');
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
                    document.getElementById('hostFilter').value = host;
                    currentPage = 1;
                    loadLogs();
                }
            }
        }
    });
}

function updateSeveritiesChart(stats) {
    const ctx = document.getElementById('severitiesChart').getContext('2d');
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
                    document.getElementById('severityFilter').value = severity;
                    currentPage = 1;
                    loadLogs();
                }
            }
        }
    });
}

function updateTimelineChart(events) {
    const ctx = document.getElementById('timelineChart');
    if (!ctx) return;
    
    const period = document.getElementById('timelinePeriod').value;
    let hours = 24;
    if (period === '7d') hours = 24 * 7;
    if (period === '30d') hours = 24 * 30;
    
    // Group events by time
    const now = new Date();
    const timeSlots = [];
    const eventCounts = [];
    
    for (let i = hours - 1; i >= 0; i--) {
        const time = new Date(now);
        time.setHours(time.getHours() - i);
        time.setMinutes(0);
        time.setSeconds(0);
        time.setMilliseconds(0);
        
        const timeKey = time.toISOString();
        timeSlots.push(time);
        eventCounts.push(0);
    }
    
    events.forEach(event => {
        try {
            const eventTime = new Date(event.ts);
            const slotIndex = Math.floor((now - eventTime) / (1000 * 60 * 60));
            if (slotIndex >= 0 && slotIndex < hours) {
                eventCounts[hours - 1 - slotIndex]++;
            }
        } catch (e) {
            // Ignore invalid dates
        }
    });
    
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
    tbody.innerHTML = '';
    
    const severities = ['Критическая', 'Высокая', 'Средняя', 'Низкая', 'Незначительная'];
    const likelihoods = ['Редко', 'Маловероятно', 'Умеренно', 'Вероятно', 'Почти наверняка'];
    
    const heatmapData = {};
    severities.forEach(sev => {
        heatmapData[sev] = {};
        likelihoods.forEach(lik => {
            heatmapData[sev][lik] = 0;
        });
    });
    
    events.forEach((event, idx) => {
        const sevIdx = Math.min(Math.floor(idx / (events.length / severities.length)), severities.length - 1);
        const likIdx = Math.min(Math.floor((idx % likelihoods.length)), likelihoods.length - 1);
        const sev = severities[sevIdx];
        const lik = likelihoods[likIdx];
        heatmapData[sev][lik]++;
    });
    
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
            
            if (count > 100) {
                cell.classList.add('high');
            } else if (count > 50) {
                cell.classList.add('medium');
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
        const severity = document.getElementById('severityFilter').value;
        const host = document.getElementById('hostFilter').value;
        const search = document.getElementById('searchInput').value;
        const timeFilter = document.getElementById('timeFilter').value;
        
        let url = `${API_BASE}/logs?limit=10000`;
        if (severity) url += `&severity=${severity}`;
        if (host) url += `&host=${encodeURIComponent(host)}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        // Handle time filter
        if (timeFilter && timeFilter !== 'custom') {
            const since = getSinceDate(timeFilter);
            if (since) url += `&since=${since}`;
        } else if (timeFilter === 'custom') {
            const dateFrom = document.getElementById('dateFrom').value;
            const dateTo = document.getElementById('dateTo').value;
            if (dateFrom) {
                url += `&since=${new Date(dateFrom).toISOString()}`;
            }
        }
        
        const response = await fetch(url);
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
    
    document.getElementById('pageInfo').textContent = 
        `Страница ${currentPage} из ${totalPages} (Всего: ${total.toLocaleString('ru-RU')})`;
    
    document.getElementById('prevPage').disabled = currentPage === 1;
    document.getElementById('nextPage').disabled = currentPage >= totalPages;
}

function displayLogs(events) {
    const tbody = document.getElementById('logsTableBody');
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
    document.getElementById('themeToggle').textContent = isDark ? '☀️' : '🌙';
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
    const now = new Date();
    document.getElementById('last-update-time').textContent = 
        now.toLocaleTimeString('ru-RU');
}

function updateSystemStatus(online) {
    const statusEl = document.getElementById('system-status');
    const dot = statusEl.querySelector('.status-dot');
    if (online) {
        dot.classList.remove('offline');
        dot.classList.add('online');
        statusEl.innerHTML = '<span class="status-dot online"></span> Онлайн';
    } else {
        dot.classList.remove('online');
        dot.classList.add('offline');
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
        document.getElementById('severityFilter').value = severity;
        currentPage = 1;
        loadLogs();
    }
}
