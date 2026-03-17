import argparse
import time
from typing import Any, Dict, List, Optional

import requests

from server.app_factory import create_app


def run_server(host: str, port: int, db_path: str = "logs.db", ssl_cert: str = None, ssl_key: str = None) -> None:
    import uvicorn

    app = create_app(db_path=db_path)

    ssl_config = {}
    if ssl_cert and ssl_key:
        ssl_config = {
            "ssl_certfile": ssl_cert,
            "ssl_keyfile": ssl_key,
        }

    uvicorn.run(app, host=host, port=port, **ssl_config)


def run_client(server_url: str) -> None:
    from client.gui import run_app

    run_app(server_url)


def run_agent(
    server_url: str,
    source: str = "auto",
    limit: int = 200,
    interval: int = 60,
    encrypt: bool = False,
    encryption_key: str = None,
) -> None:
    from client.agent import collect_logs
    from client.encryption import EncryptionManager
    from client.udp_client import TCPClient, UDPClient, parse_server_url

    protocol, host, port = parse_server_url(server_url)

    print(f"Agent started. Collecting logs from: {source}")
    print(f"Protocol: {protocol.upper()}")
    print(f"Sending to: {host}:{port}")
    print(f"Interval: {interval} seconds")
    if encrypt:
        print("Encryption: ENABLED")
    print("Press Ctrl+C to stop\n")

    if protocol == "udp":
        client = UDPClient(host, port)
    elif protocol == "tcp":
        client = TCPClient(host, port)
    else:
        client = None

    enc_manager = EncryptionManager(encryption_key) if encrypt else None

    try:
        while True:
            raw_logs = collect_logs(source=source, limit=limit)

            if not raw_logs:
                print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] No logs collected")
            else:
                try:
                    logs_to_send = enc_manager.encrypt_json(raw_logs) if encrypt and enc_manager else raw_logs

                    if protocol == "udp":
                        success = client.send_logs(logs_to_send)
                        if success:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Sent {len(raw_logs)} logs via UDP")
                        else:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] UDP send failed")
                    elif protocol == "tcp":
                        success = client.send_logs(logs_to_send)
                        if success:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Sent {len(raw_logs)} logs via TCP")
                        else:
                            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] TCP send failed")
                    else:
                        response = requests.post(
                            f"{server_url.rstrip('/')}/api/logs",
                            json=logs_to_send,
                            timeout=30,
                        )
                        response.raise_for_status()
                        result = response.json()
                        print(
                            f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] "
                            f"Sent {result.get('received', 0)} logs, "
                            f"saved {result.get('saved', 0)}, "
                            f"skipped {result.get('skipped', 0)}"
                        )
                except Exception as exc:
                    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Error sending logs: {exc}")

            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nAgent stopped.")
    finally:
        if client:
            client.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="audit-app",
        description="Client-server log audit application with agent support",
    )
    subs = parser.add_subparsers(dest="mode", required=True)

    sp_server = subs.add_parser("server", help="Run server for receiving and processing logs")
    sp_server.add_argument("--host", default="0.0.0.0", help="Host to bind to")
    sp_server.add_argument("--port", type=int, default=8080, help="Port to bind to")
    sp_server.add_argument("--db", default="logs.db", help="Path to SQLite database")
    sp_server.add_argument("--ssl-cert", help="Path to SSL certificate file (for HTTPS)")
    sp_server.add_argument("--ssl-key", help="Path to SSL private key file (for HTTPS)")

    sp_client = subs.add_parser("client", help="Run client GUI (auditor) to view logs")
    sp_client.add_argument("--server", required=True, help="Server base URL, e.g. http://127.0.0.1:8080")

    sp_agent = subs.add_parser("agent", help="Run agent to collect logs and send to server")
    sp_agent.add_argument("--server", required=True, help="Server URL: http://, udp://, or tcp://")
    sp_agent.add_argument("--source", default="auto", help="Log source: auto, journal, eventlog, file")
    sp_agent.add_argument("--limit", type=int, default=200, help="Number of events to collect per cycle")
    sp_agent.add_argument("--interval", type=int, default=60, help="Interval between sends (seconds)")
    sp_agent.add_argument("--encrypt", action="store_true", help="Enable encryption for data transmission")
    sp_agent.add_argument("--encryption-key", help="Encryption key")

    args = parser.parse_args()

    if args.mode == "server":
        run_server(args.host, args.port, args.db, args.ssl_cert, args.ssl_key)
        return
    if args.mode == "client":
        run_client(args.server)
        return
    if args.mode == "agent":
        run_agent(args.server, args.source, args.limit, args.interval, args.encrypt, args.encryption_key)
        return


if __name__ == "__main__":
    main()

