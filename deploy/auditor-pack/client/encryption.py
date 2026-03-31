"""
Модуль для шифрования данных при передаче от агентов.
"""
import base64
import os
import secrets
from cryptography.fernet import Fernet
from typing import Optional


class EncryptionManager:
    """Управление шифрованием данных."""
    
    def __init__(self, key: Optional[str] = None):
        """
        Инициализирует менеджер шифрования.
        
        Args:
            key: Ключ шифрования. Если None, пытается получить из переменной окружения
                 ENCRYPTION_KEY. Если и там нет, генерирует новый случайный ключ
                 (с предупреждением о небезопасности).
        
        Raises:
            ValueError: Если ключ невалидный
        """
        if key:
            # Пользователь предоставил ключ
            try:
                key_bytes = key.encode() if isinstance(key, str) else key
                # Проверяем, что ключ валидный для Fernet
                self.key = base64.urlsafe_b64decode(key_bytes) if len(key_bytes) == 32 else key_bytes
                # Проверяем, что ключ правильной длины для Fernet (32 байта после декодирования)
                if len(self.key) != 32:
                    # Если не 32 байта, пробуем использовать как есть (может быть уже в base64)
                    try:
                        self.key = base64.urlsafe_b64decode(key_bytes)
                        if len(self.key) != 32:
                            raise ValueError("Invalid key length for Fernet")
                    except Exception:
                        # Если не base64, генерируем ключ из этого значения
                        import hashlib
                        key_hash = hashlib.sha256(key_bytes).digest()
                        self.key = base64.urlsafe_b64encode(key_hash)
            except Exception as e:
                raise ValueError(f"Invalid encryption key: {e}")
        else:
            # Пытаемся получить из переменной окружения
            env_key = os.getenv("ENCRYPTION_KEY")
            if env_key:
                try:
                    key_bytes = env_key.encode() if isinstance(env_key, str) else env_key
                    # Пробуем декодировать как base64
                    try:
                        self.key = base64.urlsafe_b64decode(key_bytes)
                        if len(self.key) != 32:
                            # Если не 32 байта, генерируем из значения
                            import hashlib
                            key_hash = hashlib.sha256(key_bytes).digest()
                            self.key = base64.urlsafe_b64encode(key_hash)
                        else:
                            self.key = base64.urlsafe_b64encode(self.key)
                    except Exception:
                        # Если не base64, генерируем ключ из значения
                        import hashlib
                        key_hash = hashlib.sha256(key_bytes).digest()
                        self.key = base64.urlsafe_b64encode(key_hash)
                except Exception as e:
                    raise ValueError(f"Invalid ENCRYPTION_KEY from environment: {e}")
            else:
                # Генерируем новый случайный ключ (небезопасно для production!)
                import warnings
                warnings.warn(
                    "No encryption key provided! Generated a random key. "
                    "This is NOT secure for production. "
                    "Please set ENCRYPTION_KEY environment variable or provide key parameter.",
                    UserWarning
                )
                self.key = Fernet.generate_key()
        
        # Убеждаемся, что ключ в правильном формате
        if isinstance(self.key, str):
            self.key = self.key.encode()
        
        try:
            self.cipher = Fernet(self.key)
        except Exception as e:
            raise ValueError(f"Failed to initialize Fernet cipher: {e}")
    
    def encrypt(self, data: bytes) -> bytes:
        """Шифрует данные."""
        return self.cipher.encrypt(data)
    
    def decrypt(self, encrypted_data: bytes) -> bytes:
        """Расшифровывает данные."""
        return self.cipher.decrypt(encrypted_data)
    
    def encrypt_json(self, data: dict) -> str:
        """Шифрует JSON данные."""
        import json
        json_str = json.dumps(data)
        encrypted = self.encrypt(json_str.encode('utf-8'))
        return base64.b64encode(encrypted).decode('utf-8')
    
    def decrypt_json(self, encrypted_str: str) -> dict:
        """Расшифровывает JSON данные."""
        import json
        encrypted_bytes = base64.b64decode(encrypted_str.encode('utf-8'))
        decrypted = self.decrypt(encrypted_bytes)
        return json.loads(decrypted.decode('utf-8'))
    
    def get_key_string(self) -> str:
        """Возвращает ключ в виде строки для передачи."""
        return self.key.decode('utf-8')

