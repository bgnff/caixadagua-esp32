#include <WiFi.h>
#include <PubSubClient.h>

// Preencha antes de gravar. Em produção, use provisionamento e credenciais por dispositivo.
const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_PASSWORD = "SUA_SENHA";
const char* MQTT_HOST = "192.168.0.10"; // IP do computador com AquaVisão e broker MQTT
const int MQTT_PORT = 1883;
const char* DEVICE_ID = "ESP32-001";
const char* RESERVOIR_ID = "CAIXA-001";
const int TRIGGER_PIN = 5;
const int ECHO_PIN = 18; // Use divisor de tensão: ECHO do HC-SR04 é 5 V; ESP32 é 3,3 V.

WiFiClient wifiClient;
PubSubClient mqtt(wifiClient);

float readDistanceCm() {
  digitalWrite(TRIGGER_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIGGER_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIGGER_PIN, LOW);
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (!duration) return -1;
  return duration * 0.0343f / 2.0f;
}

void ensureConnections() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    while (WiFi.status() != WL_CONNECTED) delay(500);
  }
  while (!mqtt.connected()) {
    String clientId = String("aquavisao-") + DEVICE_ID + "-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (!mqtt.connect(clientId.c_str())) delay(2000);
  }
}

void setup() {
  pinMode(TRIGGER_PIN, OUTPUT); pinMode(ECHO_PIN, INPUT);
  Serial.begin(115200); mqtt.setServer(MQTT_HOST, MQTT_PORT);
}

void loop() {
  ensureConnections(); mqtt.loop();
  float distance = readDistanceCm();
  if (distance > 0 && distance < 500) {
    char payload[320];
    snprintf(payload, sizeof(payload),
      "{\"device_id\":\"%s\",\"reservoir_id\":\"%s\",\"distance_cm\":%.2f,\"signal_rssi\":%ld,\"firmware_version\":\"1.0.0\",\"quality\":95}",
      DEVICE_ID, RESERVOIR_ID, distance, WiFi.RSSI());
    String topic = String("aquavisao/reservatorios/") + RESERVOIR_ID + "/telemetria";
    mqtt.publish(topic.c_str(), payload, true);
    Serial.println(payload); // Continua compatível com manutenção por USB.
  }
  delay(3000);
}
