/*
 * AquaVisão — Firmware de Exemplo para ESP32 e HC-SR04
 * SENAI · Grupo 06 · Arena 3: Monitoramento de Nível de Reservatório
 * 
 * LIGAÇÃO DO CIRCUITO (ATENÇÃO AOS NÍVEIS DE TENSÃO):
 * - HC-SR04 VCC   --> 5V (Pino VIN do ESP32 conectado à USB)
 * - HC-SR04 GND   --> GND comum do ESP32
 * - HC-SR04 TRIG  --> Pino D5 (Saída digital 3.3V do ESP32 aciona o sensor normalmente)
 * - HC-SR04 ECHO  --> DIVISOR DE TENSÃO (O ECHO gera 5V; os pinos do ESP32 suportam 3.3V!):
 *                       ECHO ---> [ Resistor R1: 1kΩ ] ---> Pino D18 do ESP32
 *                                                      ---> [ Resistor R2: 2kΩ ] ---> GND
 *                       Tensão no pino D18: 5V * (2000 / 3000) = 3.33V (SEGURO)
 */

#include <WiFi.h>
#include <HTTPClient.h>

// 1. Configurações de Rede Wi-Fi (Preencher com a rede do laboratório/bancada)
const char* WIFI_SSID     = "SUA_REDE_WIFI";
const char* WIFI_PASSWORD = "SUA_SENHA_WIFI";

// 2. Endpoint da Central AquaVisão (IP do computador onde roda o server.py)
const char* CENTRAL_SERVER = "http://192.168.1.100:8080/api/telemetry";

// 3. Identificação do Dispositivo Físico
const char* DEVICE_ID = "CAIXA-001";

// 4. Pinagem do Sensor Ultrassônico HC-SR04
const int PIN_TRIG = 5;
const int PIN_ECHO = 18;

// Parâmetros de Filtro
const int NUM_SAMPLES = 5;
const unsigned long INTERVALO_LEITURA_MS = 2000; // Envia a cada 2 segundos

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=============================================");
  Serial.println("  AquaVisão — ESP32 + HC-SR04 Inicializado   ");
  Serial.println("=============================================");

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  // Conexão Wi-Fi
  Serial.print("Conectando ao Wi-Fi: ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int tentativas = 0;
  while (WiFi.status() != WL_CONNECTED && tentativas < 20) {
    delay(500);
    Serial.print(".");
    tentativas++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Conectado com sucesso!");
    Serial.print("[Wi-Fi] Endereço IP do ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[AVISO] Wi-Fi não conectado. O ESP32 continuará lendo o sensor localmente.");
  }
}

// Função de leitura individual com pulso de 10µs
float lerDistanciaCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // Timeout de 30ms (~5 metros de ida e volta)
  long duracao = pulseIn(PIN_ECHO, HIGH, 30000);

  if (duracao == 0) {
    return -1.0; // Sem eco (Timeout)
  }

  // Velocidade do som: ~340 m/s => 0.034 cm/µs. Distância = (duracao * 0.034) / 2
  float dist = (duracao * 0.0343) / 2.0;
  return dist;
}

// Filtro de Média/Mediana para eliminar ruídos de superfície
bool obterLeituraFiltrada(float &distanciaFinal, String &codigoStatus) {
  float amostras[NUM_SAMPLES];
  int validas = 0;

  for (int i = 0; i < NUM_SAMPLES; i++) {
    float d = lerDistanciaCm();
    if (d >= 2.0 && d <= 400.0) {
      amostras[validas++] = d;
    }
    delay(30);
  }

  if (validas == 0) {
    codigoStatus = "OUT_OF_RANGE";
    distanciaFinal = 0.0;
    return false;
  }

  // Ordenação para obter mediana
  for (int i = 0; i < validas - 1; i++) {
    for (int j = i + 1; j < validas; j++) {
      if (amostras[i] > amostras[j]) {
        float temp = amostras[i];
        amostras[i] = amostras[j];
        amostras[j] = temp;
      }
    }
  }

  distanciaFinal = amostras[validas / 2];
  codigoStatus = "OK";
  return true;
}

void loop() {
  float distancia = 0.0;
  String statusSensor = "OK";

  bool ok = obterLeituraFiltrada(distancia, statusSensor);

  Serial.println("---------------------------------------------");
  Serial.printf("Leitura Sensor: %.1f cm | Status: %s\n", distancia, statusSensor.c_str());

  // Envio de Telemetria HTTP POST
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(CENTRAL_SERVER);
    http.addHeader("Content-Type", "application/json");

    int rssi = WiFi.RSSI();

    // Montagem do Payload JSON estritamente conforme o contrato AquaVisão
    String payload = "{";
    payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
    payload += "\"distance_cm\":" + String(distancia, 1) + ",";
    payload += "\"unit\":\"cm\",";
    payload += "\"status\":\"" + statusSensor + "\",";
    payload += "\"rssi\":" + String(rssi) + ",";
    payload += "\"samples\":[" + String(distancia, 1) + "]";
    payload += "}";

    int httpCode = http.POST(payload);
    if (httpCode > 0) {
      String resposta = http.getString();
      Serial.printf("[HTTP POST] Sucesso (%d): %s\n", httpCode, resposta.c_str());
    } else {
      Serial.printf("[HTTP POST] Falha de envio. Erro: %s\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  } else {
    Serial.println("[Wi-Fi] Não conectado. Tentando reconectar...");
    WiFi.reconnect();
  }

  delay(INTERVALO_LEITURA_MS);
}
