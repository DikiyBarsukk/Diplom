// LEGACY ARCHIVE: historical frontend file, not part of the active UI runtime or deploy packs.
// API Base URL
const API_BASE = window.location.origin;

// Chart instances
let severityChart = null;
let statusChart = null;
let hostsChart = null;
let severitiesChart = null;
let timelineChart = null;

// State management
let autoRefreshInterval = null;
let refreshInterval = 30000; // 30 seconds default

// Initialize analytics page
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    checkAuth();
    loadAnalytics();
    setupEventListeners();
    setupAutoRefresh();
});

// Проверка аутентификации
async function checkAuth() {
    try {
        const response = await fetch('/api/auth/me', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            window.location.href = '/login';
            return;
        }
        
        if (response.ok) {
            const user = await response.json();
            document.getElementById('username').textContent = user.username || 'Аудитор';
            
            // Обновляем счетчик критических событий
            const statsResponse = await authenticatedFetch(`${API_BASE}/api/stats`);
            const stats = await statsResponse.json();
            const severityCounts = stats.severity || {};
            const criticalCount = (severityCounts.emerg || 0) + 
                                 (severityCounts.alert || 0) + 
                                 (severityCounts.crit || 0);
            document.getElementById('alert-count').textContent = criticalCount;
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

// Обертка для fetch с обработкой ошибок аутентификации и CSRF защитой
let csrfToken = null;

async function authenticatedFetch(url, options = {}) {
    if (!csrfToken && options.method && options.method !== 'GET') {
        const meResponse = await fetch('/api/auth/me', {
            credentials: 'include'
        });
        csrfToken = meResponse.headers.get('X-CSRF-Token');
    }
    
    const headers = {
        ...options.headers,
        'Content-Type': 'application/json'
    };
    
    if (csrfToken && options.method && options.method !== 'GET') {
        headers['X-CSRF-Token'] = csrfToken;
    }
    
    const response = await fetch(url, {
        ...options,
        credentials: 'include',
        headers: headers
    });
    
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
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.getElementById('themeToggle').textContent = '☀️';
    }
}

function setupEventListeners() {
    // Settings sidebar button
    const settingsSidebarBtn = document.getElementById('settingsSidebarBtn');
    if (settingsSidebarBtn) {
        settingsSidebarBtn.addEventListener('click', showSettings);
    }
    
    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);
    
    // Settings
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', showSettings);
    }
    document.getElementById('settingsClose').addEventListener('click', closeSettingsModal);
    document.getElementById('refreshInterval').addEventListener('change', updateRefreshInterval);
    document.getElementById('autoRefreshEnabled').addEventListener('change', toggleAutoRefresh);
    
    // Logout
    document.getElementById('logoutBtn').addEventListener('click', async () => {
        try {
            await authenticatedFetch('/api/auth/logout', { method: 'POST' });
            window.location.href = '/login';
        } catch (error) {
            window.location.href = '/login';
        }
    });
    
    // Timeline period
    document.getElementById('timelinePeriod').addEventListener('change', () => {
        loadAnalytics();
    });
    
    // Close modals on outside click
    window.addEventListener('click', (e) => {
        const settingsModal = document.getElementById('settingsModal');
        if (e.target === settingsModal) closeSettingsModal();
    });
}

async function loadAnalytics() {
    try {
        // Load stats
        const statsResponse = await authenticatedFetch(`${API_BASE}/api/stats`);
        const stats = await statsResponse.json();
        
        // Load events for charts
        const eventsResponse = await authenticatedFetch(`${API_BASE}/api/logs?limit=1000`);
        const events = await eventsResponse.json();
        
        updateCharts(stats, events);
        
        // Обновляем счетчик критических событий
        const severityCounts = stats.severity || {};
        const criticalCount = (severityCounts.emerg || 0) + 
                             (severityCounts.alert || 0) + 
                             (severityCounts.crit || 0);
        document.getElementById('alert-count').textContent = criticalCount;
    } catch (error) {
        console.error('Error loading analytics:', error);
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
                    window.location.href = '/logs';
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
                    window.location.href = '/logs';
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
        'alert': 'ОПОВЕЩЕНИЕ',
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
                    window.location.href = '/logs';
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
        autoRefreshInterval = setInterval(loadAnalytics, refreshInterval);
    }
}

function exportChart(chartId, name) {
    let chart = null;
    if (chartId === 'hostsChart') chart = hostsChart;
    else if (chartId === 'severitiesChart') chart = severitiesChart;
    else if (chartId === 'severityChart') chart = severityChart;
    else if (chartId === 'statusChart') chart = statusChart;
    else if (chartId === 'timelineChart') chart = timelineChart;
    
    if (!chart) return;
    
    const url = chart.toBase64Image();
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}_${new Date().toISOString().split('T')[0]}.png`;
    link.click();
}


