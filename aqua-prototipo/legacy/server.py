import http.server
import json
import os
import sys
from datetime import datetime, timezone

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

# In-memory storage for real telemetry incoming from ESP32 or test client
latest_telemetry = {}
telemetry_history = []

class AquaHttpHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Enable CORS for local testing and disable cache for fresh telemetry
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/telemetry'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.end_headers()
            response_data = {
                "server_time": datetime.now(timezone.utc).isoformat(),
                "telemetry": latest_telemetry,
                "history_count": len(telemetry_history)
            }
            self.wfile.write(json.dumps(response_data).encode('utf-8'))
            return
        elif self.path.startswith('/api/health'):
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "running", "service": "AquaVisão Ingestion Gateway"}).encode('utf-8'))
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/telemetry'):
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body.decode('utf-8'))
                device_id = payload.get('device_id', 'CAIXA-001')
                payload['server_received_at'] = datetime.now(timezone.utc).isoformat()
                
                # Store latest state
                latest_telemetry[device_id] = payload
                telemetry_history.append(payload)
                if len(telemetry_history) > 1000:
                    telemetry_history.pop(0)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                response = {
                    "status": "success",
                    "message": f"Telemetria recebida para {device_id}",
                    "received": payload
                }
                self.wfile.write(json.dumps(response).encode('utf-8'))
                print(f"[GATEWAY] Telemetria recebida de {device_id}: {payload.get('distance_cm')} cm | Status: {payload.get('status', 'OK')}")
            except Exception as e:
                self.send_response(400)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"status": "error", "message": str(e)}).encode('utf-8'))
            return

        self.send_response(404)
        self.end_headers()

def run():
    print(f"Iniciando Central AquaVisão Gateway na porta {PORT}...")
    server = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), AquaHttpHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == '__main__':
    run()
