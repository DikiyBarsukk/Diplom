from datetime import datetime, timedelta
from typing import Any, Dict, List

from PySide6 import QtCore, QtWidgets, QtCharts, QtGui
from PySide6.QtCharts import QChart, QChartView, QBarSet, QBarSeries, QBarCategoryAxis, QValueAxis, QPieSeries, QLineSeries, QDateTimeAxis

from client.connection import ServerClient


class LogsTableModel(QtCore.QAbstractTableModel):
    def __init__(self, rows: List[Dict[str, Any]]):
        super().__init__()
        self._rows = rows
        self._cols = ["ts", "severity", "host", "unit", "pid", "message"]

    def rowCount(self, parent: QtCore.QModelIndex = QtCore.QModelIndex()) -> int:  # type: ignore[override]
        return len(self._rows)

    def columnCount(self, parent: QtCore.QModelIndex = QtCore.QModelIndex()) -> int:  # type: ignore[override]
        return len(self._cols)

    def data(self, index: QtCore.QModelIndex, role: int = QtCore.Qt.DisplayRole):  # type: ignore[override]
        if not index.isValid() or role != QtCore.Qt.DisplayRole:
            return None
        row = self._rows[index.row()]
        key = self._cols[index.column()]
        val = row.get(key)
        return str(val) if val is not None else ""

    def headerData(self, section: int, orientation: QtCore.Qt.Orientation, role: int = QtCore.Qt.DisplayRole):  # type: ignore[override]
        if role != QtCore.Qt.DisplayRole:
            return None
        if orientation == QtCore.Qt.Horizontal:
            return self._cols[section]
        return str(section + 1)

    def set_rows(self, rows: List[Dict[str, Any]]):
        self.beginResetModel()
        self._rows = rows
        self.endResetModel()


class MainWindow(QtWidgets.QMainWindow):
    def __init__(self, server_url: str):
        super().__init__()
        self.setWindowTitle("Audit Client")
        self.resize(1400, 800)

        self.client = ServerClient(server_url)

        # Создаем вкладки
        self.tabs = QtWidgets.QTabWidget()
        self.setCentralWidget(self.tabs)

        # Вкладка с логами
        self.logs_tab = QtWidgets.QWidget()
        logs_layout = QtWidgets.QVBoxLayout(self.logs_tab)
        self._setup_logs_tab(logs_layout)
        self.tabs.addTab(self.logs_tab, "Logs")

        # Вкладка с дашбордом
        self.dashboard_tab = QtWidgets.QWidget()
        dashboard_layout = QtWidgets.QVBoxLayout(self.dashboard_tab)
        self._setup_dashboard_tab(dashboard_layout)
        self.tabs.addTab(self.dashboard_tab, "Dashboard")

        # initial fetch
        QtCore.QTimer.singleShot(100, self.on_fetch_clicked)

    def _setup_logs_tab(self, layout: QtWidgets.QVBoxLayout):
        """Настройка вкладки с логами."""
        # controls
        ctrl_layout = QtWidgets.QHBoxLayout()
        
        # Фильтр по хосту
        ctrl_layout.addWidget(QtWidgets.QLabel("Host:"))
        self.host_edit = QtWidgets.QLineEdit()
        self.host_edit.setPlaceholderText("All hosts")
        ctrl_layout.addWidget(self.host_edit)
        
        # Фильтр по уровню важности
        ctrl_layout.addWidget(QtWidgets.QLabel("Severity:"))
        self.severity_combo = QtWidgets.QComboBox()
        self.severity_combo.addItems(["", "emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"])
        ctrl_layout.addWidget(self.severity_combo)
        
        # Поиск по содержимому
        ctrl_layout.addWidget(QtWidgets.QLabel("Search:"))
        self.search_edit = QtWidgets.QLineEdit()
        self.search_edit.setPlaceholderText("Search in messages...")
        ctrl_layout.addWidget(self.search_edit)
        
        # Фильтр по времени
        ctrl_layout.addWidget(QtWidgets.QLabel("Since:"))
        self.since_combo = QtWidgets.QComboBox()
        self.since_combo.addItems([
            "All time",
            "Last hour",
            "Last 6 hours",
            "Last 24 hours",
            "Last 7 days",
            "Custom..."
        ])
        self.since_combo.currentTextChanged.connect(self.on_since_changed)
        ctrl_layout.addWidget(self.since_combo)
        
        self.since_custom = QtWidgets.QDateTimeEdit()
        self.since_custom.setCalendarPopup(True)
        self.since_custom.setDateTime(QtCore.QDateTime.currentDateTime().addDays(-1))
        self.since_custom.setDisplayFormat("yyyy-MM-dd HH:mm:ss")
        self.since_custom.hide()
        ctrl_layout.addWidget(self.since_custom)
        
        # Разрешаем поиск по Enter
        self.search_edit.returnPressed.connect(self.on_fetch_clicked)
        
        # Лимит
        ctrl_layout.addWidget(QtWidgets.QLabel("Limit:"))
        self.limit_spin = QtWidgets.QSpinBox()
        self.limit_spin.setRange(1, 1000)
        self.limit_spin.setValue(200)
        ctrl_layout.addWidget(self.limit_spin)
        
        # Кнопка обновления
        self.refresh_btn = QtWidgets.QPushButton("Fetch")
        ctrl_layout.addWidget(self.refresh_btn)
        
        # Дашборд
        self.dashboard_btn = QtWidgets.QPushButton("Dashboard")
        ctrl_layout.addWidget(self.dashboard_btn)
        
        ctrl_layout.addStretch()
        self.status_label = QtWidgets.QLabel("")
        ctrl_layout.addWidget(self.status_label)

        layout.addLayout(ctrl_layout)

        # table
        self.table = QtWidgets.QTableView()
        self.model = LogsTableModel([])
        self.table.setModel(self.model)
        self.table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QtWidgets.QAbstractItemView.SingleSelection)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.doubleClicked.connect(self.on_row_double_clicked)
        layout.addWidget(self.table)

        self.refresh_btn.clicked.connect(self.on_fetch_clicked)
        self.dashboard_btn.clicked.connect(self.show_dashboard)

    def _setup_dashboard_tab(self, layout: QtWidgets.QVBoxLayout):
        """Настройка вкладки с дашбордом."""
        # Кнопка обновления дашборда
        refresh_layout = QtWidgets.QHBoxLayout()
        self.dashboard_refresh_btn = QtWidgets.QPushButton("Refresh Dashboard")
        refresh_layout.addWidget(self.dashboard_refresh_btn)
        refresh_layout.addStretch()
        layout.addLayout(refresh_layout)

        # Scroll area для графиков
        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll_widget = QtWidgets.QWidget()
        scroll_layout = QtWidgets.QVBoxLayout(scroll_widget)

        # График распределения по severity
        self.severity_chart_view = QtCharts.QChartView()
        scroll_layout.addWidget(QtWidgets.QLabel("Events by Severity"))
        scroll_layout.addWidget(self.severity_chart_view)

        # График распределения по хостам
        self.hosts_chart_view = QtCharts.QChartView()
        scroll_layout.addWidget(QtWidgets.QLabel("Events by Host (Top 10)"))
        scroll_layout.addWidget(self.hosts_chart_view)

        # График временной линии
        self.timeline_chart_view = QtCharts.QChartView()
        scroll_layout.addWidget(QtWidgets.QLabel("Events Timeline (Last 24 hours)"))
        scroll_layout.addWidget(self.timeline_chart_view)

        scroll_layout.addStretch()
        scroll.setWidget(scroll_widget)
        layout.addWidget(scroll)

        self.dashboard_refresh_btn.clicked.connect(self.update_dashboard)

    def on_since_changed(self, text: str):
        """Обработчик изменения фильтра по времени."""
        if text == "Custom...":
            self.since_custom.show()
        else:
            self.since_custom.hide()

    def _get_since_iso(self) -> str | None:
        """Получает ISO строку для фильтра since."""
        text = self.since_combo.currentText()
        now = datetime.utcnow()
        
        if text == "All time":
            return None
        elif text == "Last hour":
            delta = timedelta(hours=1)
        elif text == "Last 6 hours":
            delta = timedelta(hours=6)
        elif text == "Last 24 hours":
            delta = timedelta(hours=24)
        elif text == "Last 7 days":
            delta = timedelta(days=7)
        elif text == "Custom...":
            qdt = self.since_custom.dateTime()
            # Конвертируем в UTC datetime
            dt = qdt.toPython()
            # Если нет timezone, считаем локальным временем
            if dt.tzinfo is None:
                # Просто возвращаем ISO строку
                return dt.isoformat()
            return dt.isoformat()
        else:
            return None
        
        if text != "Custom...":
            since_time = now - delta
            return since_time.isoformat()
        
        return None

    def on_fetch_clicked(self):
        """Загружает логи с сервера с применением фильтров."""
        host = self.host_edit.text().strip() or None
        severity = self.severity_combo.currentText() or None
        search = self.search_edit.text().strip() or None
        since = self._get_since_iso()
        limit = int(self.limit_spin.value())
        
        try:
            events = self.client.fetch_logs(
                host=host,
                severity=severity,
                search=search,
                since=since,
                limit=limit
            )
            self.model.set_rows(events)
            self.status_label.setText(f"Loaded: {len(events)} events")
        except Exception as ex:
            self.status_label.setText(f"Error: {ex}")

    def on_row_double_clicked(self, index: QtCore.QModelIndex):
        """Показывает детальную информацию о событии."""
        row = index.row()
        if row < 0 or row >= len(self.model._rows):
            return
        
        event = self.model._rows[row]
        
        # Создаем диалог с детальной информацией
        dialog = QtWidgets.QDialog(self)
        dialog.setWindowTitle("Event Details")
        dialog.resize(700, 500)
        
        layout = QtWidgets.QVBoxLayout(dialog)
        
        # Текстовое поле с информацией
        text_edit = QtWidgets.QTextEdit()
        text_edit.setReadOnly(True)
        text_edit.setFont(QtWidgets.QFont("Courier", 9))
        
        # Форматируем информацию о событии
        info = []
        info.append(f"Timestamp: {event.get('ts', 'N/A')}")
        info.append(f"Host: {event.get('host', 'N/A')}")
        info.append(f"Source: {event.get('source', 'N/A')}")
        info.append(f"Severity: {event.get('severity', 'N/A')}")
        info.append(f"Unit: {event.get('unit', 'N/A')}")
        info.append(f"Process: {event.get('process', 'N/A')}")
        info.append(f"PID: {event.get('pid', 'N/A')}")
        info.append(f"UID: {event.get('uid', 'N/A')}")
        info.append(f"\nMessage:\n{event.get('message', 'N/A')}")
        
        if event.get('raw'):
            info.append(f"\nRaw Data:\n{str(event.get('raw', {}))}")
        
        text_edit.setPlainText("\n".join(info))
        layout.addWidget(text_edit)
        
        # Кнопка закрытия
        btn_close = QtWidgets.QPushButton("Close")
        btn_close.clicked.connect(dialog.close)
        layout.addWidget(btn_close)
        
        dialog.exec()

    def show_dashboard(self):
        """Переключается на вкладку дашборда и обновляет его."""
        self.tabs.setCurrentIndex(1)
        self.update_dashboard()

    def update_dashboard(self):
        """Обновляет все графики на дашборде."""
        try:
            stats = self.client.get_stats()
            events = self.client.fetch_logs(limit=1000)
            
            # График распределения по severity
            self._update_severity_chart(stats)
            
            # График распределения по хостам
            self._update_hosts_chart(stats)
            
            # График временной линии
            self._update_timeline_chart(events)
            
        except Exception as ex:
            QtWidgets.QMessageBox.critical(self, "Error", f"Failed to update dashboard: {ex}")

    def _update_severity_chart(self, stats: Dict[str, Any]):
        """Обновляет график распределения по severity."""
        severity_data = stats.get("severity", {})
        
        series = QPieSeries()
        colors = {
            "emerg": QtGui.QColor(139, 0, 0),      # Dark red
            "alert": QtGui.QColor(255, 0, 0),     # Red
            "crit": QtGui.QColor(220, 20, 60),     # Crimson
            "err": QtGui.QColor(255, 69, 0),      # Orange red
            "warn": QtGui.QColor(255, 165, 0),    # Orange
            "notice": QtGui.QColor(255, 215, 0),  # Gold
            "info": QtGui.QColor(65, 105, 225),    # Royal blue
            "debug": QtGui.QColor(128, 128, 128)   # Gray
        }
        
        for sev, count in sorted(severity_data.items(), key=lambda x: x[1], reverse=True):
            if count > 0:
                slice = series.append(sev, count)
                if sev in colors:
                    slice.setColor(colors[sev])
        
        chart = QChart()
        chart.addSeries(series)
        chart.setTitle("Events by Severity")
        chart.legend().setAlignment(QtCore.Qt.AlignRight)
        
        self.severity_chart_view.setChart(chart)
        self.severity_chart_view.setRenderHint(QtWidgets.QPainter.Antialiasing)

    def _update_hosts_chart(self, stats: Dict[str, Any]):
        """Обновляет график распределения по хостам."""
        hosts_data = stats.get("hosts", {})
        
        # Берем топ 10 хостов
        top_hosts = sorted(hosts_data.items(), key=lambda x: x[1], reverse=True)[:10]
        
        if not top_hosts:
            chart = QChart()
            chart.setTitle("No data")
            self.hosts_chart_view.setChart(chart)
            return
        
        series = QBarSeries()
        bar_set = QBarSet("Events")
        
        categories = []
        for host, count in top_hosts:
            bar_set.append(count)
            categories.append(host[:20])  # Ограничиваем длину имени
        
        series.append(bar_set)
        
        chart = QChart()
        chart.addSeries(series)
        chart.setTitle("Events by Host (Top 10)")
        
        axis_x = QBarCategoryAxis()
        axis_x.append(categories)
        chart.addAxis(axis_x, QtCore.Qt.AlignBottom)
        series.attachAxis(axis_x)
        
        axis_y = QValueAxis()
        chart.addAxis(axis_y, QtCore.Qt.AlignLeft)
        series.attachAxis(axis_y)
        
        chart.legend().setVisible(False)
        
        self.hosts_chart_view.setChart(chart)
        self.hosts_chart_view.setRenderHint(QtWidgets.QPainter.Antialiasing)

    def _update_timeline_chart(self, events: List[Dict[str, Any]]):
        """Обновляет график временной линии."""
        # Группируем события по часам за последние 24 часа
        now = datetime.utcnow()
        hours = {}
        hour_times = []
        for i in range(24):
            hour_time = now - timedelta(hours=23-i)
            hour_key = hour_time.strftime("%Y-%m-%d %H:00")
            hours[hour_key] = 0
            hour_times.append((hour_key, hour_time))
        
        for event in events:
            try:
                ts_str = event.get("ts", "")
                if ts_str:
                    event_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    # Округляем до часа
                    hour_key = event_time.strftime("%Y-%m-%d %H:00")
                    if hour_key in hours:
                        hours[hour_key] += 1
            except Exception:
                continue
        
        series = QLineSeries()
        series.setName("Events")
        
        # Используем QDateTime для оси X
        for hour_key, hour_dt in hour_times:
            # Конвертируем datetime в миллисекунды с начала эпохи
            timestamp_ms = int(hour_dt.timestamp() * 1000)
            count = hours[hour_key]
            series.append(timestamp_ms, count)
        
        chart = QChart()
        chart.addSeries(series)
        chart.setTitle("Events Timeline (Last 24 hours)")
        
        # Используем QDateTimeAxis для оси X
        axis_x = QDateTimeAxis()
        axis_x.setFormat("HH:mm")
        axis_x.setTitleText("Time")
        if hour_times:
            first_time = hour_times[0][1]
            last_time = hour_times[-1][1]
            axis_x.setRange(
                QtCore.QDateTime.fromSecsSinceEpoch(int(first_time.timestamp())),
                QtCore.QDateTime.fromSecsSinceEpoch(int(last_time.timestamp()))
            )
        chart.addAxis(axis_x, QtCore.Qt.AlignBottom)
        series.attachAxis(axis_x)
        
        axis_y = QValueAxis()
        axis_y.setTitleText("Count")
        chart.addAxis(axis_y, QtCore.Qt.AlignLeft)
        series.attachAxis(axis_y)
        
        self.timeline_chart_view.setChart(chart)
        self.timeline_chart_view.setRenderHint(QtWidgets.QPainter.Antialiasing)


def run_app(server_url: str) -> None:
    app = QtWidgets.QApplication([])
    win = MainWindow(server_url)
    win.show()
    app.exec()






