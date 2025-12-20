// API Base URL
const API_BASE = window.location.origin;

// State management
let currentPage = 1;
let pageSize = 50;
let totalEvents = 0;
let currentSort = { field: 'ts', direction: 'desc' };
let allEvents = [];
let autoRefreshInterval = null;
let refreshInterval = 30000; // 30 seconds default

// Initialize logs page
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    checkAuth();
    loadStats();
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
            document.getElementById('username').textContent = user.username || 'Администратор';
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
    // Refresh button
    document.getElementById('refreshBtn').addEventListener('click', () => {
        currentPage = 1;
        loadLogs();
    });
    
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
            sortAndDisplayEvents();
        }
    });
    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPage < Math.ceil(totalEvents / pageSize)) {
            currentPage++;
            sortAndDisplayEvents();
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
    document.getElementById('settingsSidebarBtn').addEventListener('click', showSettings);
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
    
    // Export
    document.getElementById('exportBtn').addEventListener('click', exportToCSV);
    
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

async function loadStats() {
    try {
        const response = await authenticatedFetch(`${API_BASE}/stats`);
        const stats = await response.json();
        updateHostFilter(stats);
        
        // Update alert count
        const severityCounts = stats.severity || {};
        const criticalCount = (severityCounts.emerg || 0) + 
                             (severityCounts.alert || 0) + 
                             (severityCounts.crit || 0);
        document.getElementById('alert-count').textContent = criticalCount;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

function updateHostFilter(stats) {
    const hostFilter = document.getElementById('hostFilter');
    const hosts = Object.keys(stats.hosts || {}).sort();
    
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
        
        let url = `${API_BASE}/api/logs?limit=10000`;
        if (severity) url += `&severity=${severity}`;
        if (host) url += `&host=${encodeURIComponent(host)}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        if (timeFilter && timeFilter !== 'custom') {
            const since = getSinceDate(timeFilter);
            if (since) url += `&since=${since}`;
        } else if (timeFilter === 'custom') {
            const dateFrom = document.getElementById('dateFrom').value;
            if (dateFrom) {
                url += `&since=${new Date(dateFrom).toISOString()}`;
            }
        }
        
        document.getElementById('table-info').textContent = 'Загрузка...';
        const response = await authenticatedFetch(url);
        const events = await response.json();
        
        allEvents = events;
        totalEvents = events.length;
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
    const sorted = [...allEvents].sort((a, b) => {
        let aVal = a[currentSort.field];
        let bVal = b[currentSort.field];
        
        if (currentSort.field === 'ts') {
            aVal = new Date(aVal || 0).getTime();
            bVal = new Date(bVal || 0).getTime();
        }
        
        if (currentSort.field === 'pid') {
            aVal = parseInt(aVal) || 0;
            bVal = parseInt(bVal) || 0;
        }
        
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        
        if (currentSort.direction === 'asc') {
            return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
            return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
    });
    
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
    
    document.getElementById('table-info').textContent = 
        `Показано ${Math.min((currentPage - 1) * pageSize + 1, total)}-${Math.min(currentPage * pageSize, total)} из ${total.toLocaleString('ru-RU')}`;
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
    
    events.forEach((event) => {
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
        autoRefreshInterval = setInterval(() => {
            loadStats();
            loadLogs();
        }, refreshInterval);
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

