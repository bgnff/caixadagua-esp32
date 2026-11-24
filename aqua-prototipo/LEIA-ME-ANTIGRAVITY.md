# AquaVisão — Debate entre equipes: 100 reservatórios

## Cenário
Grupo 6, Arena 3: defender o ESP32 em uma proposta de 100 dispositivos para medição de nível de caixas-d'água, identificados individualmente, com leituras reunidas em uma central web. O protótipo físico em desenvolvimento utiliza ESP32, HC-SR04, LCD 1602A, LEDs e buzzer; a montagem e a disponibilidade dos componentes devem ser verificadas antes da integração. Uma caixa de referência tem 500 L; as demais são exemplos, não equipamentos instalados.

## Abrir e apresentar
Extraia o ZIP e abra `index.html`. Projeto HTML/CSS/JS independente, sem servidor ou bibliotecas externas. Mostra 100 dispositivos fictícios, numerados CAIXA-001 a CAIXA-100, com busca, filtro, paginação, indicadores e seleção para detalhes. Selecione um cartão e abra Simulação para definir nível, usar cenários de 0–110% ou simular perda de comunicação. O histórico registra alterações simuladas; o gráfico de 24 horas é ilustrativo. Alterações são salvas no localStorage; Reiniciar apaga os dados locais deste protótipo e restaura os exemplos.

Nenhum ESP32 está conectado e nenhuma caixa é real nesta versão. Cenários acima de 100% são apenas teste de interface: não demonstram detecção real pelo HC-SR04, que depende do posicionamento e limites do sensor. A água visual é limitada ao topo, sem estimar litros além da capacidade. Não há transmissão, backend, banco, login, comando de bomba, ou acionamento real de LED ou buzzer.

## Estados da demonstração
Porcentagens representam altura útil estimada, não porcentagem volumétrica. 0–20% baixo; acima de 20% até 60% médio; acima de 60% até 100% alto; em 100% exibir caixa cheia; acima de 100% até 105% acima do limite; acima de 105% transbordo. Buzzer físico e alertas reais são escopo futuro e dependem da montagem e programação validadas. Falha de comunicação simulada é apresentada separadamente e oculta a leitura numérica.

## Medição e calibração
A configuração permite editar capacidade nominal, altura útil, distância entre sensor e superfície no nível cheio e diâmetros inferior e superior. Para a caixa de referência são usados valores aproximados derivados das dimensões externas (altura 58 cm, diâmetros 95 e 122 cm) e distância ao nível cheio de 5 cm meramente ilustrativa. Verifique medidas internas e calibre no equipamento. Estimativa da altura: altura útil menos a diferença entre distância atual sensor/água e distância de cheio; limitar ao intervalo válido. Para litros em 0–100%, usa-se razão de volumes de um tronco de cone e normalização pela capacidade nominal. Dimensões externas não são medidas internas exatas; indicar volume como estimado e considerar calibração por pontos. Para acima de 100%, não converter para litros.

## Evolução pedida ao Antigravity
1. Preserve a interface, os 100 IDs, busca, filtros, paginação, seleção, cenários e configuração de cada caixa.
2. Separe dados simulados e reais. Proponha contrato de telemetria (ID, distância, unidade, timestamp, estado e qualidade), transporte conforme infraestrutura escolhida e uma API/serviço central; não presuma protocolo, credenciais ou infraestrutura existentes. Evite comunicação do navegador com IPs de 100 ESP32.
3. Implemente integração de teste com um ESP32 físico quando endereço, firmware, protocolo e formato reais forem fornecidos. As outras 99 caixas continuam simuladas e identificadas. Só declare conexão após receber e validar dados reais.
4. Identifique origem, horário, idade, erro do sensor e estado de comunicação. Configure limiares de expiração; exiba leituras antigas como desatualizadas e rejeite valores impossíveis.
5. Projete ingestão e persistência para 100 dispositivos, sem complexidade desnecessária: armazenamento durável, controle de acesso, reconexão e observabilidade como evolução. Histórico real só após coleta e armazenamento.
6. Alertas de nível, cheio e falha; transbordamento deve ser validado com estratégia fisicamente viável. Queda rápida indica possível anomalia, não comprova vazamento. Abastecimento e previsão de autonomia dependem de dados suficientes.
7. Para HC-SR04 convencional, adeque ECHO de 5 V à entrada 3,3 V do ESP32, mantenha referência comum e valide o circuito. Considere faixa mínima, geometria, interferências, umidade e condensação.
8. Não implemente comando real de bomba sem requisitos, circuito e proteções definidos. Separe ações físicas e simulação.

Não alegar que já existem 100 dispositivos físicos ou telemetria funcional. Teste filtros, página final, dimensões, valores acima de 100%, falha, reinício e persistência. Texto em português brasileiro.
