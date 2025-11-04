from typing import Any, Dict, List

from PySide6 import QtCore, QtWidgets

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
        self.setWindowTitle("Audit Client (Minimal)")
        self.resize(1000, 600)

        self.client = ServerClient(server_url)

        central = QtWidgets.QWidget(self)
        layout = QtWidgets.QVBoxLayout(central)

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
        
        # Лимит
        ctrl_layout.addWidget(QtWidgets.QLabel("Limit:"))
        self.limit_spin = QtWidgets.QSpinBox()
        self.limit_spin.setRange(1, 1000)
        self.limit_spin.setValue(200)
        ctrl_layout.addWidget(self.limit_spin)
        
        # Кнопка обновления
        self.refresh_btn = QtWidgets.QPushButton("Fetch")
        ctrl_layout.addWidget(self.refresh_btn)
        
        # Статистика
        self.stats_btn = QtWidgets.QPushButton("Stats")
        ctrl_layout.addWidget(self.stats_btn)
        
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
        layout.addWidget(self.table)

        self.setCentralWidget(central)

        self.refresh_btn.clicked.connect(self.on_fetch_clicked)
        self.stats_btn.clicked.connect(self.on_stats_clicked)

        # initial fetch
        QtCore.QTimer.singleShot(100, self.on_fetch_clicked)

    def on_fetch_clicked(self):
        """Загружает логи с сервера с применением фильтров."""
        host = self.host_edit.text().strip() or None
        severity = self.severity_combo.currentText() or None
        limit = int(self.limit_spin.value())
        
        try:
            events = self.client.fetch_logs(
                host=host,
                severity=severity,
                limit=limit
            )
            self.model.set_rows(events)
            self.status_label.setText(f"Loaded: {len(events)} events")
        except Exception as ex:
            self.status_label.setText(f"Error: {ex}")

    def on_stats_clicked(self):
        """Показывает статистику по логам."""
        try:
            stats = self.client.get_stats()
            total = stats.get("total_events", 0)
            hosts = stats.get("hosts", {})
            severity = stats.get("severity", {})
            
            msg = f"Total: {total}\n"
            msg += f"Hosts: {len(hosts)}\n"
            msg += f"Severity: {', '.join(f'{k}={v}' for k, v in severity.items())}"
            
            QtWidgets.QMessageBox.information(self, "Statistics", msg)
        except Exception as ex:
            QtWidgets.QMessageBox.critical(self, "Error", f"Failed to get stats: {ex}")


def run_app(server_url: str) -> None:
    app = QtWidgets.QApplication([])
    win = MainWindow(server_url)
    win.show()
    app.exec()






