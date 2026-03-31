"""
Модуль для отправки логов через UDP/TCP протоколы.
"""
import logging
import socket
import json
import time
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Максимальный размер UDP пакета (65535 - 8 UDP header - 20 IP header)
MAX_UDP_PACKET_SIZE = 65507


class UDPClient:
    """Клиент для отправки логов через UDP."""
    
    def __init__(self, server_host: str, server_port: int):
        """
        Инициализирует UDP клиент.
        
        Args:
            server_host: Хост сервера
            server_port: Порт сервера
        """
        self.server_host = server_host
        self.server_port = server_port
        self.socket = None
    
    def connect(self):
        """Создает UDP сокет."""
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.socket.settimeout(5)
    
    def send_logs(self, logs: List[Dict[str, Any]]) -> bool:
        """
        Отправляет логи через UDP.
        
        Args:
            logs: Список логов для отправки
            
        Returns:
            True если отправка успешна
        """
        if not self.socket:
            self.connect()
        
        try:
            # Отправляем каждый лог отдельным пакетом
            sent_count = 0
            skipped_count = 0
            
            for log in logs:
                data = json.dumps(log).encode('utf-8')
                data_size = len(data)
                
                # Проверяем размер пакета
                if data_size > MAX_UDP_PACKET_SIZE:
                    logger.warning(
                        f"Log entry too large ({data_size} bytes, max {MAX_UDP_PACKET_SIZE}). "
                        f"Skipping entry. Consider using TCP protocol for large logs."
                    )
                    skipped_count += 1
                    continue
                
                try:
                    self.socket.sendto(data, (self.server_host, self.server_port))
                    sent_count += 1
                except socket.error as e:
                    logger.error(f"UDP send error for log entry: {e}")
                    skipped_count += 1
            
            if skipped_count > 0:
                logger.warning(f"Skipped {skipped_count} log entries due to errors or size limits")
            
            return sent_count > 0
        except Exception as e:
            logger.error(f"UDP send error: {e}", exc_info=True)
            return False
    
    def close(self):
        """Закрывает сокет."""
        if self.socket:
            self.socket.close()
            self.socket = None


class TCPClient:
    """Клиент для отправки логов через TCP."""
    
    def __init__(self, server_host: str, server_port: int):
        """
        Инициализирует TCP клиент.
        
        Args:
            server_host: Хост сервера
            server_port: Порт сервера
        """
        self.server_host = server_host
        self.server_port = server_port
        self.socket = None
    
    def connect(self):
        """Создает TCP соединение."""
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.settimeout(10)
        self.socket.connect((self.server_host, self.server_port))
    
    def send_logs(self, logs: List[Dict[str, Any]]) -> bool:
        """
        Отправляет логи через TCP.
        
        Args:
            logs: Список логов для отправки
            
        Returns:
            True если отправка успешна
        """
        if not self.socket:
            try:
                self.connect()
            except Exception as e:
                print(f"TCP connect error: {e}")
                return False
        
        try:
            # Отправляем все логи одним пакетом
            data = json.dumps(logs).encode('utf-8')
            data_size = len(data)
            
            # TCP может отправлять большие данные, но все равно логируем размер
            if data_size > 10 * 1024 * 1024:  # 10 MB
                logger.warning(f"Large TCP payload: {data_size} bytes")
            
            # Отправляем размер данных сначала
            size = data_size.to_bytes(4, byteorder='big')
            self.socket.sendall(size)
            # Затем сами данные
            self.socket.sendall(data)
            return True
        except socket.error as e:
            logger.error(f"TCP send error: {e}", exc_info=True)
            # Закрываем соединение при ошибке
            self.close()
            return False
        except Exception as e:
            logger.error(f"TCP send error: {e}", exc_info=True)
            # Закрываем соединение при ошибке
            self.close()
            return False
    
    def close(self):
        """Закрывает соединение."""
        if self.socket:
            try:
                self.socket.close()
            except:
                pass
            self.socket = None


def parse_server_url(server_url: str) -> tuple:
    """
    Парсит URL сервера и определяет протокол.
    
    Returns:
        (protocol, host, port)
    """
    if server_url.startswith('udp://'):
        url = urlparse(server_url)
        return ('udp', url.hostname or 'localhost', url.port or 8081)
    elif server_url.startswith('tcp://'):
        url = urlparse(server_url)
        return ('tcp', url.hostname or 'localhost', url.port or 8082)
    else:
        # HTTP по умолчанию
        url = urlparse(server_url if '://' in server_url else f'http://{server_url}')
        return ('http', url.hostname or 'localhost', url.port or 8080)

