import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List

from PySide6 import QtCore, QtGui, QtWidgets, QtCharts
from PySide6.QtCharts import (
    QBarCategoryAxis,
    QBarSeries,
    QBarSet,
    QChart,
    QChartView,
    QDateTimeAxis,
    QLineSeries,
    QPieSeries,
    QValueAxis,
)

from client.connection import ServerClient

logger = logging.getLogger(__name__)

APP_STYLESHEET = """
QWidget {
    background: #08111a;
    color: #e7f3f8;
    font-family: 'Segoe UI Variable', 'Segoe UI', sans-serif;
    font-size: 10pt;
}
QMainWindow, QDialog, QScrollArea, QScrollArea > QWidget > QWidget {
    background: #08111a;
}
QTabWidget::pane {
    border: 1px solid #1e3342;
    border-radius: 16px;
    background: #0c1822;
    margin-top: 10px;
}
QTabBar::tab {
    min-width: 150px;
    padding: 10px 18px;
    margin-right: 8px;
    border-radius: 12px;
    background: #0f1e2a;
    color: #9bb8c8;
    border: 1px solid #1c3140;
    font-weight: 600;
}
QTabBar::tab:selected {
    background: #163141;
    color: #f2f7fb;
    border: 1px solid #35c6ff;
}
QPushButton {
    min-height: 38px;
    padding: 0 14px;
    border-radius: 12px;
    border: 1px solid #244356;
    background: #132734;
    color: #f2f7fb;
    font-weight: 700;
}
QPushButton:hover {
    background: #183241;
}
QPushButton:pressed {
    background: #10212c;
}
QLineEdit, QComboBox, QSpinBox, QDateTimeEdit, QTextEdit {
    min-height: 38px;
    padding: 6px 10px;
    border-radius: 12px;
    border: 1px solid #1f3848;
    background: #0b1822;
    color: #f2f7fb;
    selection-background-color: #1f9ed6;
}
QLineEdit:focus, QComboBox:focus, QSpinBox:focus, QDateTimeEdit:focus, QTextEdit:focus {
    border: 1px solid #35c6ff;
}
QLabel {
    color: #cfe3ee;
}
QHeaderView::section {
    background: #10202b;
    color: #9bb8c8;
    padding: 8px;
    border: 0;
    border-bottom: 1px solid #1e3342;
    font-weight: 700;
}
QTableView {
    border: 1px solid #1e3342;
    border-radius: 16px;
    background: #0b1720;
    gridline-color: #152734;
    selection-background-color: rgba(53, 198, 255, 0.18);
    selection-color: #f5fbff;
    alternate-background-color: #0d1b25;
}
QTableView::item {
    padding: 8px;
}
QScrollBar:vertical {
    background: #0a141d;
    width: 12px;
    margin: 4px;
    border-radius: 6px;
}
QScrollBar::handle:vertical {
    background: #234055;
    border-radius: 6px;
    min-height: 24px;
}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical,
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical,
QScrollBar:horizontal, QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal,
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {
    background: none;
    border: none;
}
QMessageBox {
    background: #0a141d;
}
QToolTip {
    border: 1px solid #1f9ed6;
    background: #08111a;
    color: #f2f7fb;
}
"""


class LogsTableModel(QtCore.QAbstractTableModel):
    def __init__(self, rows: List[Dict[str, Any]]):
        super().__init__()
        self._rows = rows
        self._cols = [
            ("ts", "Время"),
            ("severity", "Важность"),
            ("host", "Хост"),
            ("unit", "Служба"),
            ("pid", "PID"),
            ("message", "Сообщение"),
        ]

    def rowCount(self, parent: QtCore.QModelIndex = QtCore.QModelIndex()) -> int:  # type: ignore[override]
        return len(self._rows)

    def columnCount(self, parent: QtCore.QModelIndex = QtCore.QModelIndex()) -> int:  # type: ignore[override]
        return len(self._cols)

    def data(self, index: QtCore.QModelIndex, role: int = QtCore.Qt.DisplayRole):  # type: ignore[override]
        if not index.isValid():
            return None
        row = self._rows[index.row()]
        key = self._cols[index.column()][0]
        if role == QtCore.Qt.DisplayRole:
            value = row.get(key)
            return str(value) if value is not None else ""
        if role == QtCore.Qt.ToolTipRole and key == "message":
            return str(row.get(key) or "")
        return None

    def headerData(self, section: int, orientation: QtCore.Qt.Orientation, role: int = QtCore.Qt.DisplayRole):  # type: ignore[override]
        if role != QtCore.Qt.DisplayRole:
            return None
        if orientation == QtCore.Qt.Horizontal:
            return self._cols[section][1]
        return str(section + 1)

    def set_rows(self, rows: List[Dict[str, Any]]):
        self.beginResetModel()
        self._rows = rows
        self.endResetModel()


class MainWindow(QtWidgets.QMainWindow):
    def __init__(self, server_url: str):
        super().__init__()
        self.client = ServerClient(server_url)
        title = "BARSUKSIEM | Клиент аудитора"
        if self.client.using_default_credentials:
            title += " [admin / admin123]"
        self.setWindowTitle(title)
        self.resize(1460, 860)

        self.connection_status = "не проверено"
        self._apply_theme()

        self.tabs = QtWidgets.QTabWidget()
        self.setCentralWidget(self.tabs)

        self.logs_tab = QtWidgets.QWidget()
        logs_layout = QtWidgets.QVBoxLayout(self.logs_tab)
        logs_layout.setContentsMargins(18, 18, 18, 18)
        logs_layout.setSpacing(16)
        self._setup_logs_tab(logs_layout)
        self.tabs.addTab(self.logs_tab, "Журналы")

        self.dashboard_tab = QtWidgets.QWidget()
        dashboard_layout = QtWidgets.QVBoxLayout(self.dashboard_tab)
        dashboard_layout.setContentsMargins(18, 18, 18, 18)
        dashboard_layout.setSpacing(16)
        self._setup_dashboard_tab(dashboard_layout)
        self.tabs.addTab(self.dashboard_tab, "Дашборд")

        QtCore.QTimer.singleShot(100, self.check_connection)
        QtCore.QTimer.singleShot(250, self.on_fetch_clicked)

    def _apply_theme(self):
        app = QtWidgets.QApplication.instance()
        if app is not None:
            app.setStyle("Fusion")
            app.setStyleSheet(APP_STYLESHEET)
        palette = self.palette()
        palette.setColor(QtGui.QPalette.Window, QtGui.QColor("#08111a"))
        palette.setColor(QtGui.QPalette.Base, QtGui.QColor("#0b1720"))
        palette.setColor(QtGui.QPalette.AlternateBase, QtGui.QColor("#0d1b25"))
        palette.setColor(QtGui.QPalette.Text, QtGui.QColor("#e7f3f8"))
        palette.setColor(QtGui.QPalette.ButtonText, QtGui.QColor("#e7f3f8"))
        palette.setColor(QtGui.QPalette.WindowText, QtGui.QColor("#e7f3f8"))
        self.setPalette(palette)

    def _setup_logs_tab(self, layout: QtWidgets.QVBoxLayout):
        ctrl_layout = QtWidgets.QHBoxLayout()
        ctrl_layout.setSpacing(12)

        ctrl_layout.addWidget(QtWidgets.QLabel("Хост:"))
        self.host_edit = QtWidgets.QLineEdit()
        self.host_edit.setPlaceholderText("Все хосты")
        ctrl_layout.addWidget(self.host_edit)

        ctrl_layout.addWidget(QtWidgets.QLabel("Важность:"))
        self.severity_combo = QtWidgets.QComboBox()
        self.severity_combo.addItems(["", "emerg", "alert", "crit", "err", "warn", "notice", "info", "debug"])
        ctrl_layout.addWidget(self.severity_combo)

        ctrl_layout.addWidget(QtWidgets.QLabel("Поиск:"))
        self.search_edit = QtWidgets.QLineEdit()
        self.search_edit.setPlaceholderText("PowerShell, 4625, пользователь, IP...")
        ctrl_layout.addWidget(self.search_edit)

        ctrl_layout.addWidget(QtWidgets.QLabel("Период:"))
        self.since_combo = QtWidgets.QComboBox()
        self.since_combo.addItems([
            "За всё время",
            "Последний час",
            "Последние 6 часов",
            "Последние 24 часа",
            "Последние 7 дней",
            "Свой диапазон",
        ])
        self.since_combo.currentTextChanged.connect(self.on_since_changed)
        ctrl_layout.addWidget(self.since_combo)

        self.since_custom = QtWidgets.QDateTimeEdit()
        self.since_custom.setCalendarPopup(True)
        self.since_custom.setDateTime(QtCore.QDateTime.currentDateTime().addDays(-1))
        self.since_custom.setDisplayFormat("yyyy-MM-dd HH:mm:ss")
        self.since_custom.hide()
        ctrl_layout.addWidget(self.since_custom)

        self.search_edit.returnPressed.connect(self.on_fetch_clicked)

        ctrl_layout.addWidget(QtWidgets.QLabel("Лимит:"))
        self.limit_spin = QtWidgets.QSpinBox()
        self.limit_spin.setRange(1, 1000)
        self.limit_spin.setValue(200)
        ctrl_layout.addWidget(self.limit_spin)

        self.refresh_btn = QtWidgets.QPushButton("Загрузить")
        ctrl_layout.addWidget(self.refresh_btn)

        self.check_connection_btn = QtWidgets.QPushButton("Проверить связь")
        ctrl_layout.addWidget(self.check_connection_btn)

        self.dashboard_btn = QtWidgets.QPushButton("Открыть дашборд")
        ctrl_layout.addWidget(self.dashboard_btn)

        ctrl_layout.addStretch()
        self.status_label = QtWidgets.QLabel("Готов к загрузке")
        ctrl_layout.addWidget(self.status_label)
        self.connection_label = QtWidgets.QLabel("Соединение: не проверено")
        self.connection_label.setStyleSheet("color: #93acba; font-weight: 700;")
        ctrl_layout.addWidget(self.connection_label)

        layout.addLayout(ctrl_layout)

        self.auth_mode_label = QtWidgets.QLabel(self.client.get_auth_mode_label())
        self.auth_mode_label.setStyleSheet("color: #7f97a7; font-size: 9pt;")
        layout.addWidget(self.auth_mode_label)

        self.table = QtWidgets.QTableView()
        self.model = LogsTableModel([])
        self.table.setModel(self.model)
        self.table.setSelectionBehavior(QtWidgets.QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QtWidgets.QAbstractItemView.SingleSelection)
        self.table.setAlternatingRowColors(True)
        self.table.horizontalHeader().setStretchLastSection(True)
        self.table.verticalHeader().setVisible(False)
        self.table.doubleClicked.connect(self.on_row_double_clicked)
        layout.addWidget(self.table, 1)

        self.refresh_btn.clicked.connect(self.on_fetch_clicked)
        self.check_connection_btn.clicked.connect(self.check_connection)
        self.dashboard_btn.clicked.connect(self.show_dashboard)

    def _setup_dashboard_tab(self, layout: QtWidgets.QVBoxLayout):
        refresh_layout = QtWidgets.QHBoxLayout()
        refresh_layout.setSpacing(12)
        title_box = QtWidgets.QVBoxLayout()
        title_label = QtWidgets.QLabel("Панель аналитики клиента")
        title_label.setStyleSheet("font-size: 18pt; font-weight: 800; color: #f2f7fb;")
        subtitle_label = QtWidgets.QLabel("Локальный дашборд повторяет логику веб-версии: важность событий, активные хосты и поток за 24 часа.")
        subtitle_label.setStyleSheet("color: #9bb8c8;")
        title_box.addWidget(title_label)
        title_box.addWidget(subtitle_label)
        refresh_layout.addLayout(title_box)
        refresh_layout.addStretch()
        self.dashboard_refresh_btn = QtWidgets.QPushButton("Обновить дашборд")
        refresh_layout.addWidget(self.dashboard_refresh_btn)
        layout.addLayout(refresh_layout)

        scroll = QtWidgets.QScrollArea()
        scroll.setWidgetResizable(True)
        scroll_widget = QtWidgets.QWidget()
        scroll_layout = QtWidgets.QVBoxLayout(scroll_widget)
        scroll_layout.setSpacing(18)

        self.severity_chart_view = self._create_chart_view(300)
        scroll_layout.addWidget(self._build_chart_panel("События по важности", "Распределение журнала по уровням значимости.", self.severity_chart_view))

        self.hosts_chart_view = self._create_chart_view(320)
        scroll_layout.addWidget(self._build_chart_panel("Топ хостов", "Хосты с наибольшим количеством событий за выбранный запрос.", self.hosts_chart_view))

        self.timeline_chart_view = self._create_chart_view(320)
        scroll_layout.addWidget(self._build_chart_panel("Лента за 24 часа", "Динамика потока событий по часу за последние сутки.", self.timeline_chart_view))

        scroll_layout.addStretch()
        scroll.setWidget(scroll_widget)
        layout.addWidget(scroll, 1)

        self.dashboard_refresh_btn.clicked.connect(self.update_dashboard)

    def _build_chart_panel(self, title: str, subtitle: str, chart_view: QChartView) -> QtWidgets.QWidget:
        panel = QtWidgets.QFrame()
        panel.setStyleSheet(
            "QFrame { background: #0d1822; border: 1px solid #1e3342; border-radius: 18px; }"
        )
        box = QtWidgets.QVBoxLayout(panel)
        box.setContentsMargins(18, 18, 18, 18)
        box.setSpacing(12)
        title_label = QtWidgets.QLabel(title)
        title_label.setStyleSheet("font-size: 11pt; font-weight: 800; color: #f2f7fb;")
        subtitle_label = QtWidgets.QLabel(subtitle)
        subtitle_label.setStyleSheet("color: #90a9b8;")
        box.addWidget(title_label)
        box.addWidget(subtitle_label)
        box.addWidget(chart_view)
        return panel

    def _create_chart_view(self, minimum_height: int) -> QChartView:
        view = QChartView()
        view.setMinimumHeight(minimum_height)
        view.setRenderHint(QtGui.QPainter.Antialiasing)
        view.setStyleSheet("background: transparent; border: none;")
        return view

    def on_since_changed(self, text: str):
        self.since_custom.setVisible(text == "Свой диапазон")

    def _get_since_iso(self) -> str | None:
        text = self.since_combo.currentText()
        now = datetime.utcnow()
        if text == "За всё время":
            return None
        if text == "Последний час":
            delta = timedelta(hours=1)
        elif text == "Последние 6 часов":
            delta = timedelta(hours=6)
        elif text == "Последние 24 часа":
            delta = timedelta(hours=24)
        elif text == "Последние 7 дней":
            delta = timedelta(days=7)
        elif text == "Свой диапазон":
            return self.since_custom.dateTime().toPython().isoformat()
        else:
            return None
        return (now - delta).isoformat()

    def on_fetch_clicked(self):
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
                limit=limit,
            )
            self.model.set_rows(events)
            self.status_label.setText(f"Загружено: {len(events)} событий")
            self.set_connection_state(True, "API доступен")
        except Exception as ex:
            logger.error("Error fetching logs: %s", ex, exc_info=True)
            self.status_label.setText(f"Ошибка: {ex}")
            self.set_connection_state(False, str(ex))

    def on_row_double_clicked(self, index: QtCore.QModelIndex):
        row = index.row()
        if row < 0 or row >= len(self.model._rows):
            return
        event = self.model._rows[row]

        dialog = QtWidgets.QDialog(self)
        dialog.setWindowTitle("Детали события")
        dialog.resize(760, 520)
        dialog.setStyleSheet("QDialog { background: #0a141d; color: #e7f3f8; }")
        layout = QtWidgets.QVBoxLayout(dialog)
        layout.setContentsMargins(18, 18, 18, 18)

        text_edit = QtWidgets.QTextEdit()
        text_edit.setReadOnly(True)
        text_edit.setFont(QtGui.QFont("Cascadia Mono", 9))

        info = [
            f"Время: {event.get('ts', 'N/A')}",
            f"Хост: {event.get('host', 'N/A')}",
            f"Источник: {event.get('source', 'N/A')}",
            f"Важность: {event.get('severity', 'N/A')}",
            f"Служба: {event.get('unit', 'N/A')}",
            f"Процесс: {event.get('process', 'N/A')}",
            f"PID: {event.get('pid', 'N/A')}",
            f"UID: {event.get('uid', 'N/A')}",
            "",
            f"Сообщение:\n{event.get('message', 'N/A')}",
        ]
        if event.get('raw'):
            info.append(f"\nRaw Data:\n{str(event.get('raw', {}))}")

        text_edit.setPlainText("\n".join(info))
        layout.addWidget(text_edit)

        btn_close = QtWidgets.QPushButton("Закрыть")
        btn_close.clicked.connect(dialog.close)
        layout.addWidget(btn_close)

        dialog.exec()

    def show_dashboard(self):
        self.tabs.setCurrentIndex(1)
        self.update_dashboard()

    def update_dashboard(self):
        try:
            stats = self.client.get_stats()
            events = self.client.fetch_logs(limit=1000)
            self._update_severity_chart(stats)
            self._update_hosts_chart(stats)
            self._update_timeline_chart(events)
            self.status_label.setText("Дашборд обновлён")
            self.set_connection_state(True, "графики обновлены")
        except Exception as ex:
            logger.error("Failed to update dashboard: %s", ex, exc_info=True)
            QtWidgets.QMessageBox.critical(self, "Ошибка", f"Не удалось обновить дашборд: {ex}")

    def set_connection_state(self, is_ok: bool, message: str):
        self.connection_status = message
        self.connection_label.setText(f"Соединение: {message}")
        color = "#46d6a8" if is_ok else "#ff6d5f"
        self.connection_label.setStyleSheet(f"color: {color}; font-weight: 800;")

    def check_connection(self):
        try:
            self.client.health()
            self.set_connection_state(True, "сервер доступен")
            self.status_label.setText(self.client.get_auth_mode_label())
        except Exception as ex:
            self.set_connection_state(False, f"ошибка: {ex}")
            self.status_label.setText("Не удалось проверить соединение с сервером")

    def _apply_chart_style(self, chart: QChart, title: str):
        chart.setTitle(title)
        chart.setTheme(QChart.ChartThemeDark)
        chart.setAnimationOptions(QChart.SeriesAnimations)
        chart.setBackgroundVisible(False)
        chart.setPlotAreaBackgroundVisible(False)
        chart.setMargins(QtCore.QMargins(10, 10, 10, 10))
        chart.setTitleBrush(QtGui.QBrush(QtGui.QColor("#f2f7fb")))
        chart.legend().setLabelColor(QtGui.QColor("#adc5d5"))
        chart.legend().setVisible(True)

    def _update_severity_chart(self, stats: Dict[str, Any]):
        severity_data = stats.get("severity", {})
        series = QPieSeries()
        colors = {
            "emerg": QtGui.QColor("#b42318"),
            "alert": QtGui.QColor("#ff6d5f"),
            "crit": QtGui.QColor("#f97316"),
            "err": QtGui.QColor("#f7b04f"),
            "warn": QtGui.QColor("#ffd166"),
            "notice": QtGui.QColor("#35c6ff"),
            "info": QtGui.QColor("#4f8cff"),
            "debug": QtGui.QColor("#78909c"),
        }
        total = 0
        for sev, count in sorted(severity_data.items(), key=lambda item: item[1], reverse=True):
            if count <= 0:
                continue
            slice_item = series.append(sev, count)
            slice_item.setColor(colors.get(sev, QtGui.QColor("#35c6ff")))
            total += count
        if total == 0:
            series.append("Нет данных", 1).setColor(QtGui.QColor("#3f5563"))
        chart = QChart()
        chart.addSeries(series)
        self._apply_chart_style(chart, "События по важности")
        chart.legend().setAlignment(QtCore.Qt.AlignRight)
        self.severity_chart_view.setChart(chart)
        self.severity_chart_view.setRenderHint(QtGui.QPainter.Antialiasing)

    def _update_hosts_chart(self, stats: Dict[str, Any]):
        hosts_data = stats.get("hosts", {})
        top_hosts = sorted(hosts_data.items(), key=lambda item: item[1], reverse=True)[:10]
        chart = QChart()
        self._apply_chart_style(chart, "Топ хостов")
        if not top_hosts:
            chart.legend().hide()
            self.hosts_chart_view.setChart(chart)
            return

        series = QBarSeries()
        bar_set = QBarSet("События")
        bar_set.setColor(QtGui.QColor("#35c6ff"))
        categories = []
        for host, count in top_hosts:
            bar_set.append(count)
            categories.append(host[:18])
        series.append(bar_set)
        chart.addSeries(series)

        axis_x = QBarCategoryAxis()
        axis_x.append(categories)
        axis_x.setLabelsColor(QtGui.QColor("#adc5d5"))
        axis_x.setTitleText("Хосты")
        chart.addAxis(axis_x, QtCore.Qt.AlignBottom)
        series.attachAxis(axis_x)

        axis_y = QValueAxis()
        axis_y.setLabelsColor(QtGui.QColor("#adc5d5"))
        axis_y.setTitleText("Количество")
        chart.addAxis(axis_y, QtCore.Qt.AlignLeft)
        series.attachAxis(axis_y)

        self.hosts_chart_view.setChart(chart)
        self.hosts_chart_view.setRenderHint(QtGui.QPainter.Antialiasing)

    def _update_timeline_chart(self, events: List[Dict[str, Any]]):
        now = datetime.utcnow()
        hours = {}
        hour_times = []
        for idx in range(24):
            hour_time = now - timedelta(hours=23 - idx)
            hour_key = hour_time.strftime("%Y-%m-%d %H:00")
            hours[hour_key] = 0
            hour_times.append((hour_key, hour_time))

        for event in events:
            try:
                ts_str = event.get("ts", "")
                if not ts_str:
                    continue
                event_time = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                hour_key = event_time.strftime("%Y-%m-%d %H:00")
                if hour_key in hours:
                    hours[hour_key] += 1
            except Exception:
                continue

        series = QLineSeries()
        series.setName("События")
        series.setColor(QtGui.QColor("#35c6ff"))
        pen = QtGui.QPen(QtGui.QColor("#35c6ff"), 2.4)
        series.setPen(pen)

        for hour_key, hour_dt in hour_times:
            timestamp_ms = int(hour_dt.timestamp() * 1000)
            series.append(timestamp_ms, hours[hour_key])

        chart = QChart()
        chart.addSeries(series)
        self._apply_chart_style(chart, "Лента событий за 24 часа")

        axis_x = QDateTimeAxis()
        axis_x.setFormat("HH:mm")
        axis_x.setTitleText("Время")
        axis_x.setLabelsColor(QtGui.QColor("#adc5d5"))
        if hour_times:
            first_time = hour_times[0][1]
            last_time = hour_times[-1][1]
            axis_x.setRange(
                QtCore.QDateTime.fromSecsSinceEpoch(int(first_time.timestamp())),
                QtCore.QDateTime.fromSecsSinceEpoch(int(last_time.timestamp())),
            )
        chart.addAxis(axis_x, QtCore.Qt.AlignBottom)
        series.attachAxis(axis_x)

        axis_y = QValueAxis()
        axis_y.setLabelsColor(QtGui.QColor("#adc5d5"))
        axis_y.setTitleText("Количество")
        chart.addAxis(axis_y, QtCore.Qt.AlignLeft)
        series.attachAxis(axis_y)

        self.timeline_chart_view.setChart(chart)
        self.timeline_chart_view.setRenderHint(QtGui.QPainter.Antialiasing)


def run_app(server_url: str) -> None:
    app = QtWidgets.QApplication([])
    app.setStyle("Fusion")
    app.setStyleSheet(APP_STYLESHEET)
    win = MainWindow(server_url)
    win.show()
    app.exec()