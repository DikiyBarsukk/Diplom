"""
Модуль анализа инцидентов информационной безопасности.

Реализует:
- Rule-based анализ событий для выявления инцидентов ИБ
- Корреляцию событий по времени и паттернам
- Классификацию инцидентов по типам и критичности

Примеры правил:
- 5 неудачных логинов за 10 минут → brute-force
- Вход администратора ночью → аномалия
- Запуск powershell + download → подозрительное поведение
- Удаление логов → попытка сокрытия следов
- Корреляция: [4625] → [4625] → [4624] → [4672] → повышение привилегий
"""
import logging
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from collections import defaultdict

logger = logging.getLogger(__name__)


class IncidentType:
    """Типы инцидентов ИБ."""
    BRUTE_FORCE = "brute_force"
    UNAUTHORIZED_ACCESS = "unauthorized_access"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    LOG_TAMPERING = "log_tampering"
    PRIVILEGE_ESCALATION = "privilege_escalation"
    ANOMALY = "anomaly"
    MALWARE_INDICATOR = "malware_indicator"


class IncidentSeverity:
    """Критичность инцидентов."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class IncidentRule:
    """Базовый класс для правил выявления инцидентов."""
    
    def __init__(self, rule_id: str, name: str, description: str, 
                 severity: str, incident_type: str):
        self.rule_id = rule_id
        self.name = name
        self.description = description
        self.severity = severity
        self.incident_type = incident_type
    
    def check(self, events: List[Dict[str, Any]], context: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Проверяет события на соответствие правилу.
        
        Args:
            events: Список событий для анализа
            context: Дополнительный контекст (статистика, пользователи и т.д.)
        
        Returns:
            Dict с информацией об инциденте или None
        """
        raise NotImplementedError


class BruteForceRule(IncidentRule):
    """
    Правило 1.1: Выявление brute-force атак.
    
    Формула: COUNT(failed_login) >= 5 за TIME_WINDOW = 10 минут
    """
    
    def __init__(self):
        super().__init__(
            rule_id="R001",
            name="Brute Force Attack Detection",
            description="Обнаружено 5 или более неудачных попыток входа за 10 минут",
            severity=IncidentSeverity.HIGH,
            incident_type=IncidentType.BRUTE_FORCE
        )
        self.threshold = 5
        self.time_window = timedelta(minutes=10)
    
    def check(self, events: List[Dict[str, Any]], context: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Псевдокод:
        failed_logins = []
        FOR EACH event IN events:
            IF event.action == "login_failed":
                failed_logins.append(event)
        
        GROUP failed_logins BY (host, username)
        FOR EACH group:
            IF COUNT(group) >= threshold AND time_span <= time_window:
                RETURN incident
        """
        # Фильтруем неудачные попытки входа
        failed_logins = [
            e for e in events
            if e.get("message", "").lower().find("login_failed") != -1 or
               e.get("message", "").lower().find("authentication failed") != -1 or
               e.get("message", "").lower().find("invalid credentials") != -1 or
               e.get("message", "").lower().find("неверный пароль") != -1
        ]
        
        if len(failed_logins) < self.threshold:
            return None
        
        # Группируем по хосту и времени
        host_groups = defaultdict(list)
        for event in failed_logins:
            host = event.get("host", "unknown")
            host_groups[host].append(event)
        
        # Проверяем каждую группу
        for host, host_events in host_groups.items():
            if len(host_events) < self.threshold:
                continue
            
            # Сортируем по времени
            host_events.sort(key=lambda x: x.get("ts", ""))
            
            # Проверяем временное окно
            for i in range(len(host_events) - self.threshold + 1):
                window_events = host_events[i:i + self.threshold]
                first_time = datetime.fromisoformat(window_events[0].get("ts", "").replace("Z", "+00:00"))
                last_time = datetime.fromisoformat(window_events[-1].get("ts", "").replace("Z", "+00:00"))
                
                if last_time - first_time <= self.time_window:
                    # Найден инцидент
                    return {
                        "rule_id": self.rule_id,
                        "incident_type": self.incident_type,
                        "severity": self.severity,
                        "title": f"Brute Force Attack on {host}",
                        "description": self.description,
                        "host": host,
                        "event_count": len(window_events),
                        "time_window": str(self.time_window),
                        "first_event_time": window_events[0].get("ts"),
                        "last_event_time": window_events[-1].get("ts"),
                        "related_events": [e.get("id") for e in window_events if e.get("id")],
                    }
        
        return None


class UnauthorizedAccessRule(IncidentRule):
    """
    Правило 1.2: Выявление несанкционированного доступа.
    
    Формула: admin_login AND time IN [00:00, 06:00] → аномалия
    """
    
    def __init__(self):
        super().__init__(
            rule_id="R002",
            name="Unauthorized Access - Night Admin Login",
            description="Вход администратора в нерабочее время (00:00-06:00)",
            severity=IncidentSeverity.MEDIUM,
            incident_type=IncidentType.UNAUTHORIZED_ACCESS
        )
        self.night_start = 0  # 00:00
        self.night_end = 6    # 06:00
    
    def check(self, events: List[Dict[str, Any]], context: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Псевдокод:
        FOR EACH event IN events:
            IF event.action == "login_success" AND event.role == "admin":
                hour = EXTRACT_HOUR(event.timestamp)
                IF hour >= 0 AND hour < 6:
                    RETURN incident
        """
        admin_logins = []
        
        for event in events:
            message = event.get("message", "").lower()
            # Ищем успешные входы администратора
            if (("login_success" in message or "successful login" in message or 
                 "успешный вход" in message) and
                ("admin" in message or event.get("unit", "").lower() == "admin")):
                
                try:
                    ts = event.get("ts", "")
                    if ts:
                        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                        hour = dt.hour
                        
                        if self.night_start <= hour < self.night_end:
                            admin_logins.append(event)
                except Exception as e:
                    logger.warning(f"Error parsing timestamp: {e}")
                    continue
        
        if admin_logins:
            return {
                "rule_id": self.rule_id,
                "incident_type": self.incident_type,
                "severity": self.severity,
                "title": "Suspicious Admin Login at Night",
                "description": self.description,
                "event_count": len(admin_logins),
                "related_events": [e.get("id") for e in admin_logins if e.get("id")],
                "first_event_time": admin_logins[0].get("ts"),
            }
        
        return None


class SuspiciousActivityRule(IncidentRule):
    """
    Правило 1.3: Выявление подозрительной активности.
    
    Формула: powershell_execution AND network_download → подозрительное поведение
    """
    
    def __init__(self):
        super().__init__(
            rule_id="R003",
            name="Suspicious Activity - PowerShell Download",
            description="Запуск PowerShell с одновременной загрузкой данных из сети",
            severity=IncidentSeverity.HIGH,
            incident_type=IncidentType.SUSPICIOUS_ACTIVITY
        )
    
    def check(self, events: List[Dict[str, Any]], context: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Псевдокод:
        powershell_events = FILTER events WHERE process == "powershell"
        download_events = FILTER events WHERE message CONTAINS "download"
        
        FOR EACH ps_event IN powershell_events:
            FOR EACH dl_event IN download_events:
                IF time_diff(ps_event, dl_event) < 5 minutes:
                    RETURN incident
        """
        powershell_events = []
        download_events = []
        
        for event in events:
            message = event.get("message", "").lower()
            process = event.get("process", "").lower()
            
            # Ищем запуски PowerShell
            if ("powershell" in process or "powershell" in message or
                "pwsh" in process):
                powershell_events.append(event)
            
            # Ищем загрузки
            if (any(keyword in message for keyword in 
                   ["download", "загрузка", "wget", "curl", "invoke-webrequest", 
                    "downloadstring", "downloadfile"])):
                download_events.append(event)
        
        if not powershell_events or not download_events:
            return None
        
        # Проверяем временную корреляцию (в пределах 5 минут)
        correlation_window = timedelta(minutes=5)
        suspicious_pairs = []
        
        for ps_event in powershell_events:
            ps_time = datetime.fromisoformat(ps_event.get("ts", "").replace("Z", "+00:00"))
            
            for dl_event in download_events:
                dl_time = datetime.fromisoformat(dl_event.get("ts", "").replace("Z", "+00:00"))
                time_diff = abs(ps_time - dl_time)
                
                if time_diff <= correlation_window:
                    suspicious_pairs.append((ps_event, dl_event))
        
        if suspicious_pairs:
            return {
                "rule_id": self.rule_id,
                "incident_type": self.incident_type,
                "severity": self.severity,
                "title": "Suspicious PowerShell Activity with Download",
                "description": self.description,
                "event_count": len(suspicious_pairs) * 2,
                "related_events": [
                    e.get("id") for pair in suspicious_pairs 
                    for e in pair if e.get("id")
                ],
                "first_event_time": suspicious_pairs[0][0].get("ts"),
            }
        
        return None


class LogTamperingRule(IncidentRule):
    """
    Правило 1.4: Выявление попыток удаления/изменения логов.
    
    Формула: log_deletion OR log_modification → попытка сокрытия следов
    """
    
    def __init__(self):
        super().__init__(
            rule_id="R004",
            name="Log Tampering Detection",
            description="Обнаружена попытка удаления или изменения логов",
            severity=IncidentSeverity.CRITICAL,
            incident_type=IncidentType.LOG_TAMPERING
        )
    
    def check(self, events: List[Dict[str, Any]], context: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Псевдокод:
        FOR EACH event IN events:
            IF event.message CONTAINS ("log deletion" OR "log modification" OR 
                                        "journalctl --vacuum" OR "wevtutil cl"):
                RETURN incident
        """
        tampering_keywords = [
            "log deletion", "log deletion", "удаление логов",
            "journalctl --vacuum", "wevtutil cl", "clear event log",
            "log modification", "изменение логов", "log tampering",
            "rm /var/log", "del *.log", "clear-log"
        ]
        
        tampering_events = []
        
        for event in events:
            message = event.get("message", "").lower()
            process = event.get("process", "").lower()
            
            if any(keyword in message or keyword in process for keyword in tampering_keywords):
                tampering_events.append(event)
        
        if tampering_events:
            return {
                "rule_id": self.rule_id,
                "incident_type": self.incident_type,
                "severity": self.severity,
                "title": "Log Tampering Attempt Detected",
                "description": self.description,
                "event_count": len(tampering_events),
                "related_events": [e.get("id") for e in tampering_events if e.get("id")],
                "first_event_time": tampering_events[0].get("ts"),
            }
        
        return None


class PrivilegeEscalationRule(IncidentRule):
    """
    Правило 1.5: Выявление повышения привилегий.
    
    Корреляция: [4625] → [4625] → [4624] → [4672]
    = неудачные попытки входа → успешный вход → вход с повышенными правами
    """
    
    def __init__(self):
        super().__init__(
            rule_id="R005",
            name="Privilege Escalation Detection",
            description="Обнаружена последовательность событий, указывающая на повышение привилегий",
            severity=IncidentSeverity.CRITICAL,
            incident_type=IncidentType.PRIVILEGE_ESCALATION
        )
        self.correlation_window = timedelta(minutes=30)
    
    def check(self, events: List[Dict[str, Any]], context: Dict[str, Any] = None) -> Optional[Dict[str, Any]]:
        """
        Псевдокод (корреляция событий):
        failed_logins = FILTER events WHERE event_id == 4625
        successful_login = FILTER events WHERE event_id == 4624
        privileged_login = FILTER events WHERE event_id == 4672
        
        FOR EACH failed IN failed_logins:
            FOR EACH success IN successful_login:
                IF time_diff(failed, success) < window:
                    FOR EACH priv IN privileged_login:
                        IF time_diff(success, priv) < window:
                            RETURN incident
        """
        # Ищем паттерн: неудачные входы → успешный вход → вход с правами
        failed_logins = []
        successful_logins = []
        privileged_logins = []
        
        for event in events:
            message = event.get("message", "").lower()
            event_id = event.get("raw", {}).get("EventID") or event.get("raw", {}).get("event_id")
            
            # Windows Event ID 4625 = неудачный вход
            if (event_id == 4625 or 
                "failed login" in message or "неудачный вход" in message):
                failed_logins.append(event)
            
            # Windows Event ID 4624 = успешный вход
            if (event_id == 4624 or 
                ("successful login" in message and "privilege" not in message)):
                successful_logins.append(event)
            
            # Windows Event ID 4672 = вход с повышенными правами
            if (event_id == 4672 or 
                "privilege" in message and "login" in message or
                "повышенные права" in message):
                privileged_logins.append(event)
        
        # Проверяем корреляцию
        if len(failed_logins) >= 2 and successful_logins and privileged_logins:
            # Ищем последовательность
            for failed in failed_logins[:2]:  # Берем первые 2 неудачные попытки
                failed_time = datetime.fromisoformat(failed.get("ts", "").replace("Z", "+00:00"))
                
                for success in successful_logins:
                    success_time = datetime.fromisoformat(success.get("ts", "").replace("Z", "+00:00"))
                    
                    if success_time > failed_time and (success_time - failed_time) <= self.correlation_window:
                        for priv in privileged_logins:
                            priv_time = datetime.fromisoformat(priv.get("ts", "").replace("Z", "+00:00"))
                            
                            if priv_time > success_time and (priv_time - success_time) <= self.correlation_window:
                                return {
                                    "rule_id": self.rule_id,
                                    "incident_type": self.incident_type,
                                    "severity": self.severity,
                                    "title": "Privilege Escalation Detected",
                                    "description": self.description,
                                    "event_count": 4,
                                    "related_events": [
                                        e.get("id") for e in [failed, success, priv] if e.get("id")
                                    ],
                                    "correlation_pattern": "Failed Login → Successful Login → Privileged Login",
                                    "first_event_time": failed.get("ts"),
                                    "last_event_time": priv.get("ts"),
                                }
        
        return None


class IncidentAnalyzer:
    """Анализатор инцидентов ИБ."""
    
    def __init__(self):
        self.rules: List[IncidentRule] = [
            BruteForceRule(),
            UnauthorizedAccessRule(),
            SuspiciousActivityRule(),
            LogTamperingRule(),
            PrivilegeEscalationRule(),
        ]
        logger.info(f"Initialized IncidentAnalyzer with {len(self.rules)} rules")
    
    def analyze_events(self, events: List[Dict[str, Any]], 
                      context: Dict[str, Any] = None) -> List[Dict[str, Any]]:
        """
        Анализирует события и выявляет инциденты ИБ.
        
        Args:
            events: Список событий для анализа
            context: Дополнительный контекст (статистика, пользователи и т.д.)
        
        Returns:
            Список обнаруженных инцидентов
        """
        if not events:
            return []
        
        incidents = []
        
        # Применяем каждое правило
        for rule in self.rules:
            try:
                incident = rule.check(events, context)
                if incident:
                    # Добавляем метаданные
                    incident["detected_at"] = datetime.utcnow().isoformat()
                    incident["analyzer_version"] = "0.4"
                    incidents.append(incident)
                    logger.info(f"Incident detected: {incident['title']} (Rule: {rule.rule_id})")
            except Exception as e:
                logger.error(f"Error applying rule {rule.rule_id}: {e}", exc_info=True)
        
        return incidents
    
    def get_rules_info(self) -> List[Dict[str, Any]]:
        """Возвращает информацию о всех правилах."""
        return [
            {
                "rule_id": rule.rule_id,
                "name": rule.name,
                "description": rule.description,
                "severity": rule.severity,
                "incident_type": rule.incident_type,
            }
            for rule in self.rules
        ]


# Глобальный экземпляр анализатора
_analyzer = None


def get_analyzer() -> IncidentAnalyzer:
    """Получает глобальный экземпляр анализатора."""
    global _analyzer
    if _analyzer is None:
        _analyzer = IncidentAnalyzer()
    return _analyzer

