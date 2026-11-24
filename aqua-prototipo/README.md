# AquaVisão Local

Central local para 100 reservatórios com MySQL, simulação, modo de produção, câmera assistida e telemetria ESP32 por MQTT/Wi‑Fi.

## Iniciar

1. Confirme que o MySQL local está ativo e ajuste `.env` se necessário.
2. Execute `npm run db:init` uma vez.
3. Execute `npm start`.
4. Abra `http://localhost:8000`.

O banco desta instalação foi criado como `aquavisao`. O schema completo está em `schema.sql`.

## ESP32 por Wi‑Fi

Instale um broker MQTT local, como Mosquitto, na mesma máquina ou rede. Ajuste `MQTT_URL` no `.env` e reinicie a aplicação. O firmware de exemplo está em `firmware/esp32_wifi_mqtt.ino`. Configure o IP do broker, rede Wi‑Fi, ID do dispositivo e ID do reservatório.

Tópico: `aquavisao/reservatorios/CAIXA-001/telemetria`

O navegador recebe atualizações em tempo real do servidor. Ele não se conecta diretamente aos ESP32.

## Câmera

Abra **Medir com câmera**, permita o acesso e arraste um retângulo sobre o reservatório. A tela acompanha o contorno selecionado, procura uma borda interna compatível com o fundo e informa confiança. Uma referência de tamanho conhecido precisa aparecer no mesmo plano para transformar pixels em centímetros. Toda medição é salva como rascunho para conferência.

## Modos

- **Parado:** não executa simulação.
- **Simulação:** gera leituras persistidas a cada três segundos.
- **Produção oficial:** interrompe a simulação e bloqueia a zeragem.

Esta versão é somente de monitoramento. Não aciona bombas ou válvulas.
