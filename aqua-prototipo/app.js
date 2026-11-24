/**
 * AquaVisão — Central IHM de Monitoramento de Reservatórios
 * SENAI · Grupo 06 · Arena 3: Arquitetura com ESP32 e Ultrassom HC-SR04
 * 
 * Regras estritas:
 * 1. Apenas CAIXA-001 recebe dados físicos reais do ESP32. As demais 99 são simuladas.
 * 2. Nenhuma conexão real é declarada sem pacotes recebidos e validados.
 * 3. Cálculos de altura útil, limites de transbordo e aproximação de volume por geometria.
 */

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const STORAGE_KEY = 'aquavisao_ihm_v3_senai';

const LOCATIONS = [
  'Prédio principal', 'Bloco administrativo', 'Escola técnica', 'Laboratório central',
  'Ginásio poliesportivo', 'Centro comunitário', 'Unidade de saúde', 'Biblioteca',
  'Anexo industrial', 'Área de utilidades'
];

// Gerador de dados padrão (100 reservatórios)
function generateDefaults() {
  return Array.from({ length: 100 }, (_, i) => {
    const isReal = (i === 0);
    const id = `CAIXA-${String(i + 1).padStart(3, '0')}`;
    const name = isReal ? 'Reservatório Principal (ESP32 Bancada)' : `Reservatório Setor ${String(i + 1).padStart(3, '0')}`;
    const location = LOCATIONS[i % LOCATIONS.length];
    
    // Calibração de referência:
    // Distância vazio: 63 cm (fundo da caixa)
    // Distância cheio: 5 cm (offset seguro do sensor HC-SR04)
    // Altura útil: 58 cm
    const distEmpty = 63.0;
    const distFull = 5.0;
    const initialLevelPct = isReal ? 72 : (15 + (i * 33) % 75);
    const initialDistance = distEmpty - (initialLevelPct / 100) * (distEmpty - distFull);

    return {
      id,
      name,
      location,
      isReal,
      capacity: 500, // Litros nominais de referência
      geometry: 'tronco_cone', // 'tronco_cone' | 'cilindro' | 'retangular'
      base: 95.0, // cm
      top: 122.0, // cm
      extHeight: 58.0, // cm
      diameter: 100.0,
      width: 80.0,
      length: 120.0,
      
      // Pontos de calibração
      distEmpty: distEmpty,
      distFull: distFull,

      // Telemetria dinâmica
      distance: Number(initialDistance.toFixed(1)),
      status: 'OK', // 'OK' | 'OUT_OF_RANGE' | 'ECHO_TIMEOUT' | 'NOISY_READING'
      rssi: -65,
      lastUpdated: isReal ? null : (Date.now() - (i % 5) * 4000), // CAIXA-001 começa sem leitura real
      hasReceivedRealData: false,
      offline: (!isReal && i > 0 && i % 23 === 0), // alguns exemplos simulados offline
      events: [
        {
          text: isReal ? 'Inicializado: aguardando primeiro pacote de telemetria do ESP32 físico' : 'Sistema inicializado em modo simulação',
          at: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · Sistema'
        }
      ]
    };
  });
}

// Estado da Aplicação
let reservoirs = [];
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    reservoirs = JSON.parse(saved);
  }
  if (!Array.isArray(reservoirs) || reservoirs.length !== 100) {
    reservoirs = generateDefaults();
  }
} catch (e) {
  reservoirs = generateDefaults();
}

let selectedIndex = 0;
let currentPage = 1;
const PAGE_SIZE = 12;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reservoirs));
  } catch (e) {
    console.warn('Falha ao salvar localStorage:', e);
  }
}

// Formatação
const fmt = n => new Intl.NumberFormat('pt-BR').format(n);
function safe(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Adiciona evento ao reservatório
function logEvent(item, text, source = 'Operação') {
  if (!item.events) item.events = [];
  item.events.unshift({
    text,
    at: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ` · ${source}`
  });
  item.events = item.events.slice(0, 10);
  saveState();
}

// Cálculo de Altura Útil e Nível Percentual
function computeLevel(item) {
  const span = item.distEmpty - item.distFull;
  if (span <= 0) return { pct: 0, waterHeight: 0, valid: false };

  // Verificação de erro de sensor ou offline
  if (item.offline || item.status !== 'OK') {
    return { pct: null, waterHeight: null, valid: false };
  }

  // Se CAIXA-001 ainda não recebeu telemetria real
  if (item.isReal && !item.hasReceivedRealData) {
    return { pct: null, waterHeight: null, valid: false, waitingReal: true };
  }

  const waterHeight = item.distEmpty - item.distance;
  const pct = (waterHeight / span) * 100;

  return {
    pct: Number(pct.toFixed(1)),
    waterHeight: Number(Math.max(0, waterHeight).toFixed(1)),
    valid: true
  };
}

// Estados e Situação Operacional
function getOperationalState(item) {
  // CAIXA-001 aguardando conexão física real
  if (item.isReal && !item.hasReceivedRealData) {
    return {
      text: 'Aguardando ESP32 Físico',
      cls: 'gray',
      key: 'offline',
      detail: 'Nenhum pacote real recebido ainda'
    };
  }

  if (item.offline) {
    return {
      text: 'Sem Comunicação',
      cls: 'gray',
      key: 'offline',
      detail: 'Dispositivo inacessível na rede'
    };
  }

  // Verificação de expiração / staleness (> 90 segundos sem novos dados na CAIXA-001)
  if (item.isReal && item.lastUpdated && (Date.now() - item.lastUpdated > 90000)) {
    return {
      text: 'Dado Desatualizado / Timeout',
      cls: 'gray',
      key: 'offline',
      detail: 'Sem atualização há mais de 90 segundos'
    };
  }

  if (item.status === 'OUT_OF_RANGE') {
    return {
      text: 'Sensor Fora de Faixa',
      cls: 'amber',
      key: 'sensor_error',
      detail: 'Leitura ultrassônica fora de 2-400 cm'
    };
  }

  if (item.status === 'ECHO_TIMEOUT' || item.status === 'NOISY_READING') {
    return {
      text: 'Falha no Sensor HC-SR04',
      cls: 'amber',
      key: 'sensor_error',
      detail: 'Sem eco ou ruído excessivo de reflexão'
    };
  }

  const { pct, valid } = computeLevel(item);
  if (!valid || pct === null) {
    return { text: 'Leitura Indisponível', cls: 'gray', key: 'offline', detail: 'Dados inválidos' };
  }

  if (pct > 105) {
    return {
      text: 'Transbordo [Demonstrativo]',
      cls: 'purple',
      key: 'transbordo',
      detail: 'Nível acima de 105% da capacidade útil'
    };
  }

  if (pct > 100) {
    return {
      text: 'Acima do Limite [Demonstrativo]',
      cls: 'red',
      key: 'extremo',
      detail: 'Lâmina d\'água superior ao nível cheio de calibração'
    };
  }

  if (pct <= 20) {
    return {
      text: 'Nível Crítico Baixo',
      cls: 'red',
      key: 'baixo',
      detail: 'Risco de esgotamento'
    };
  }

  if (pct <= 60) {
    return {
      text: 'Nível Médio',
      cls: 'amber',
      key: 'medio',
      detail: 'Operação moderada'
    };
  }

  if (pct >= 100) {
    return {
      text: 'Reservatório Cheio',
      cls: 'green',
      key: 'alto',
      detail: 'No limite seguro de calibração'
    };
  }

  return {
    text: 'Nível Adequado',
    cls: 'green',
    key: 'alto',
    detail: 'Faixa operacional ideal'
  };
}

// Estimativa de Volume por Geometria
function computeEstimatedVolume(item) {
  const { pct, valid } = computeLevel(item);
  // Regra do documento: acima de 100% ou sem dados válidos, NÃO converter em litros
  if (!valid || pct === null || pct > 100 || pct < 0) {
    return '—';
  }

  const hFrac = pct / 100;

  if (item.geometry === 'cilindro' || item.geometry === 'retangular') {
    const liters = Math.round(item.capacity * hFrac);
    return `≈ ${fmt(liters)} L (Estimado)`;
  }

  // Geometria padrão: Tronco de Cone
  const rBase = (item.base || 95) / 2;
  const rTop = (item.top || 122) / 2;
  
  if (rBase === rTop) {
    const liters = Math.round(item.capacity * hFrac);
    return `≈ ${fmt(liters)} L (Estimado)`;
  }

  const volFraction = ((rBase + (rTop - rBase) * hFrac) ** 3 - rBase ** 3) / (rTop ** 3 - rBase ** 3);
  const estimatedLiters = Math.round(item.capacity * Math.max(0, Math.min(1, volFraction)));
  return `≈ ${fmt(estimatedLiters)} L (Estimado)`;
}

// Filtros de Pesquisa
function getFilteredReservoirs() {
  const query = ($('#search').value || '').trim().toLowerCase();
  const statusFilter = $('#statusFilter').value;
  const geomFilter = $('#geometryFilter').value;

  return reservoirs.map((item, index) => ({ item, index })).filter(({ item }) => {
    const state = getOperationalState(item);

    // Filtro por texto
    const textMatch = !query || 
      `${item.id} ${item.name} ${item.location}`.toLowerCase().includes(query);

    // Filtro por situação
    let statusMatch = (statusFilter === 'todos');
    if (statusFilter === 'real') {
      statusMatch = item.isReal;
    } else if (statusFilter === state.key) {
      statusMatch = true;
    }

    // Filtro por geometria
    const geomMatch = (geomFilter === 'todos' || item.geometry === geomFilter);

    return textMatch && statusMatch && geomMatch;
  });
}

// Formatação do tempo decorrido
function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Sem registro';
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 5) return 'Dado recente (há 4s)';
  if (diffSec < 60) return `Dado recente (há ${diffSec}s)`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Atualizado há ${diffMin} min`;
  return `Atualizado há ${Math.floor(diffMin / 60)}h`;
}

// Renderização Principal
function renderApp() {
  const current = reservoirs[selectedIndex];
  const currentState = getOperationalState(current);
  const currentCalc = computeLevel(current);

  // 1. Atualizar Header e Clock
  const now = new Date();
  $('#clockTime').textContent = now.toLocaleTimeString('pt-BR');

  const esp001 = reservoirs[0];
  const espState = getOperationalState(esp001);
  const espHeader = $('#espHeaderStatus');
  const espTitle = $('#espHeaderTitle');
  const espSubtitle = $('#espHeaderSubtitle');
  const espDot = espHeader.querySelector('.dot');

  if (esp001.hasReceivedRealData && !esp001.offline && (Date.now() - esp001.lastUpdated <= 45000)) {
    espDot.className = 'dot green';
    espTitle.textContent = 'ESP32 (CAIXA-001): Online';
    espSubtitle.textContent = `Recebendo telemetria real (${esp001.distance} cm)`;
  } else if (esp001.hasReceivedRealData && (Date.now() - esp001.lastUpdated <= 90000)) {
    espDot.className = 'dot yellow';
    espTitle.textContent = 'ESP32 (CAIXA-001): Atrasado';
    espSubtitle.textContent = 'Atraso na recepção de pacotes';
  } else {
    espDot.className = 'dot yellow';
    espTitle.textContent = 'ESP32 (CAIXA-001): Bancada';
    espSubtitle.textContent = esp001.hasReceivedRealData ? 'Comunicação perdida' : 'Aguardando telemetria real';
  }

  // 2. Contadores das Estatísticas Gerais
  let normalCount = 0;
  let attentionCount = 0;
  let criticalCount = 0;

  reservoirs.forEach(res => {
    const st = getOperationalState(res);
    if (st.key === 'alto') normalCount++;
    else if (st.key === 'medio' || st.key === 'baixo') attentionCount++;
    else criticalCount++; // offline, transbordo, erro de sensor
  });

  $('#normalCount').textContent = String(normalCount).padStart(2, '0');
  $('#attentionCount').textContent = String(attentionCount).padStart(2, '0');
  $('#criticalCount').textContent = String(criticalCount).padStart(2, '0');

  // 3. Grid dos Reservatórios com Paginação
  const filteredList = getFilteredReservoirs();
  const totalPages = Math.max(1, Math.ceil(filteredList.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);

  const pagedItems = filteredList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const gridContainer = $('#reservoirs');
  if (pagedItems.length === 0) {
    gridContainer.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; background: #fff; border-radius: 12px; border: 1px solid #cbd5e1;">
        <span style="font-size: 32px;">🔍</span>
        <h3 style="margin: 10px 0 6px;">Nenhum reservatório encontrado</h3>
        <p style="color: #64748b; margin: 0;">Tente alterar os termos de busca ou filtros aplicados.</p>
      </div>
    `;
  } else {
    gridContainer.innerHTML = pagedItems.map(({ item, index }) => {
      const isSelected = (index === selectedIndex);
      const st = getOperationalState(item);
      const calc = computeLevel(item);
      const displayLevel = (calc.valid && calc.pct !== null) ? `${calc.pct}%` : '—';
      const waterHeightPct = (calc.valid && calc.pct !== null) ? Math.min(100, Math.max(0, calc.pct)) : 0;
      const originBadge = item.isReal 
        ? `<span class="origin-badge real">ESP32 REAL</span>` 
        : `<span class="origin-badge sim">SIMULADO</span>`;
      const timeAgo = formatTimeAgo(item.lastUpdated);

      return `
        <div class="reservoir-card ${isSelected ? 'selected' : ''}" data-index="${index}">
          <div class="res-header">
            <div>
              <span class="res-id">${safe(item.id)}</span>
              <span class="res-name" title="${safe(item.name)}">${safe(item.name)}</span>
            </div>
            ${originBadge}
          </div>

          <div class="res-body">
            <div class="mini-tank">
              <div class="mini-tank-water" style="height: ${waterHeightPct}%;"></div>
              <div class="mini-tank-lines"></div>
            </div>
            <div class="res-metrics">
              <div class="res-level">${displayLevel}</div>
              <span class="res-level-label">Altura Útil</span>
              <span class="res-volume-sub">${computeEstimatedVolume(item)}</span>
            </div>
          </div>

          <div class="res-footer">
            <span class="status-chip ${st.cls}">● ${st.text}</span>
            <span class="res-age">${timeAgo}</span>
          </div>
        </div>
      `;
    }).join('');

    $$('.reservoir-card').forEach(card => {
      card.onclick = () => {
        selectedIndex = Number(card.dataset.index);
        renderApp();
        // Rola suavemente até o painel analítico
        $('#analyticalPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
    });
  }

  $('#resultCount').textContent = `${filteredList.length} de 100 tanques`;
  $('#pageInfo').textContent = `Página ${currentPage} de ${totalPages}`;
  $('#prev').disabled = (currentPage === 1);
  $('#next').disabled = (currentPage === totalPages);

  // 4. Painel de Análise Detalhada do Reservatório Selecionado
  $('#detailTitle').textContent = `Reservatório Selecionado: ${current.id} — ${current.name}`;
  $('#detailSubtitle').textContent = `${current.location} · Capacidade Nominal: ${fmt(current.capacity)} L · Geometria: ${formatGeometryName(current.geometry)}`;

  // Gauge gráfico com cálculo da linha de eco
  const tankWater = $('#detailWater');
  const detailLevelLarge = $('#detailLevelLarge');
  const detailStatusTag = $('#detailStatusTag');
  const beamLine = $('#beamLine');

  if (currentCalc.valid && currentCalc.pct !== null) {
    const clampedPct = Math.min(100, Math.max(0, currentCalc.pct));
    tankWater.style.height = `${clampedPct}%`;
    detailLevelLarge.textContent = `${currentCalc.pct}%`;
    
    // Altura da linha pontilhada do ultrassom até a água
    const beamHeight = 100 - clampedPct;
    beamLine.style.height = `${Math.max(10, beamHeight * 1.8)}px`;
    beamLine.style.display = 'block';
  } else {
    tankWater.style.height = '0%';
    detailLevelLarge.textContent = '—';
    beamLine.style.display = 'none';
  }

  detailStatusTag.className = `status-chip ${currentState.cls}`;
  detailStatusTag.textContent = `● ${currentState.text}`;

  // Métricas do painel analítico
  $('#detailWaterHeight').textContent = (currentCalc.valid && currentCalc.waterHeight !== null)
    ? `${currentCalc.waterHeight.toFixed(1).replace('.', ',')} cm`
    : '—';
  
  $('#detailDistance').textContent = (current.offline || current.status !== 'OK')
    ? '—'
    : `${current.distance.toFixed(1).replace('.', ',')} cm`;

  $('#detailVolume').textContent = computeEstimatedVolume(current);
  $('#detailCapacity').textContent = `${fmt(current.capacity)} L`;

  // Resumo da Calibração
  $('#detailCalFull').textContent = `${current.distFull.toFixed(1).replace('.', ',')} cm`;
  $('#detailCalEmpty').textContent = `${current.distEmpty.toFixed(1).replace('.', ',')} cm`;
  $('#detailCalSpan').textContent = `${(current.distEmpty - current.distFull).toFixed(1).replace('.', ',')} cm`;
  $('#detailGeometry').textContent = formatGeometryName(current.geometry);

  // Saúde e Origem
  const originBadgeEl = $('#detailOriginBadge');
  if (current.isReal) {
    originBadgeEl.className = 'origin-badge real';
    originBadgeEl.textContent = 'ESP32 Físico (Bancada SENAI)';
  } else {
    originBadgeEl.className = 'origin-badge sim';
    originBadgeEl.textContent = 'Simulação de Escala Local';
  }

  $('#detailTimestamp').textContent = current.lastUpdated
    ? new Date(current.lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Aguardando telemetria';

  const ageText = formatTimeAgo(current.lastUpdated);
  const detailAgeEl = $('#detailAgeText');
  detailAgeEl.textContent = ageText;
  if (ageText.includes('recente')) detailAgeEl.className = 'text-green';
  else if (ageText.includes('atrasado') || ageText.includes('min')) detailAgeEl.className = 'text-amber';
  else detailAgeEl.className = 'text-red';

  const sensorHealthEl = $('#detailSensorHealth');
  if (current.status === 'OK') {
    sensorHealthEl.className = 'text-green';
    sensorHealthEl.textContent = 'Operacional (Sinal Estável)';
  } else {
    sensorHealthEl.className = 'text-red';
    sensorHealthEl.textContent = `Falha: ${current.status}`;
  }

  $('#detailSignalQuality').textContent = `${current.rssi || -65} dBm (${getSignalDesc(current.rssi)})`;

  // Lista de Eventos
  const eventsList = $('#detailEventsList');
  eventsList.innerHTML = (current.events || []).map(ev => `
    <div class="event-entry">
      <strong>${safe(ev.text)}</strong>
      <small>${safe(ev.at)}</small>
    </div>
  `).join('') || '<div class="event-entry">Sem eventos recentes</div>';

  // 5. Gráfico Histórico Ilustrativo
  $('#chartSubtitle').textContent = `${current.id} (${current.name}) · Curva histórica de 24 horas`;
  renderChart(currentCalc.valid ? currentCalc.pct : 50);
}

function formatGeometryName(geom) {
  if (geom === 'tronco_cone') return 'Tronco de Cone (Cônico)';
  if (geom === 'cilindro') return 'Cilíndrico';
  if (geom === 'retangular') return 'Prismático Retangular';
  return geom;
}

function getSignalDesc(rssi) {
  if (!rssi) return 'Normal';
  if (rssi >= -65) return 'Excelente';
  if (rssi >= -75) return 'Bom';
  if (rssi >= -85) return 'Moderado';
  return 'Fraco';
}

function renderChart(currentLevel) {
  const baseCurve = [68, 72, 70, 65, 62, 59, 78, 82, 80, 75, 71, 69, 74, 76, 73, Math.min(100, Math.max(0, currentLevel))];
  const step = 700 / (baseCurve.length - 1);
  const pts = baseCurve.map((val, idx) => {
    const x = (idx * step).toFixed(1);
    const y = (180 - (val / 100) * 170).toFixed(1);
    return `${x},${y}`;
  });

  const curvePath = 'M ' + pts.join(' L ');
  const areaPath = `M 0,180 L ${pts.join(' L ')} L 700,180 Z`;

  $('#curve').setAttribute('d', curvePath);
  $('#area').setAttribute('d', areaPath);
}

// ==========================================
// CONTROLES DE CALIBRAÇÃO (MODAL)
// ==========================================
const modalConfig = $('#modalConfig');

function openConfigModal() {
  const current = reservoirs[selectedIndex];
  $('#modalConfigTitle').textContent = `Calibração & Cadastro — ${current.id}`;
  
  const form = $('#advancedConfigForm');
  form.elements.name.value = current.name;
  form.elements.location.value = current.location;
  form.elements.capacity.value = current.capacity;
  form.elements.geometry.value = current.geometry;

  form.elements.base.value = current.base || 95;
  form.elements.top.value = current.top || 122;
  form.elements.extHeight.value = current.extHeight || 58;
  form.elements.diameter.value = current.diameter || 100;
  form.elements.width.value = current.width || 80;
  form.elements.length.value = current.length || 120;

  form.elements.distEmpty.value = current.distEmpty;
  form.elements.distFull.value = current.distFull;

  updateGeometryFields(current.geometry);
  updateCalLiveTelemetry();
  updateComputedSpan();

  modalConfig.showModal();
}

function updateGeometryFields(geom) {
  $('#geomFieldsCone').classList.toggle('hidden', geom !== 'tronco_cone');
  $('#geomFieldsCil').classList.toggle('hidden', geom !== 'cilindro');
  $('#geomFieldsRet').classList.toggle('hidden', geom !== 'retangular');
}

function updateCalLiveTelemetry() {
  const current = reservoirs[selectedIndex];
  $('#calLiveDistance').textContent = `${current.distance.toFixed(1).replace('.', ',')} cm`;
  $('#calLiveStatus').textContent = current.status === 'OK' ? 'Leitura Estável e Válida' : `Status: ${current.status}`;
}

function updateComputedSpan() {
  const empty = parseFloat($('#inputDistEmpty').value) || 0;
  const full = parseFloat($('#inputDistFull').value) || 0;
  const span = empty - full;
  $('#computedSpanText').textContent = span > 0 ? `${span.toFixed(1).replace('.', ',')} cm` : 'Inválido (Vazio deve ser maior que Cheio)';
}

$('#configGeometrySelect').onchange = e => updateGeometryFields(e.target.value);
$('#inputDistEmpty').oninput = updateComputedSpan;
$('#inputDistFull').oninput = updateComputedSpan;

// Captura de Vazio e Cheio com validação e confirmação
$('#btnCaptureEmpty').onclick = () => {
  const current = reservoirs[selectedIndex];
  if (current.status !== 'OK' || current.offline) {
    alert('A leitura do sensor não está estável ou o dispositivo está sem comunicação.');
    return;
  }
  const confirmed = confirm(`Deseja capturar a distância atual de ${current.distance} cm como o ponto de NÍVEL VAZIO (0%) para ${current.id}?`);
  if (confirmed) {
    $('#inputDistEmpty').value = current.distance;
    updateComputedSpan();
  }
};

$('#btnCaptureFull').onclick = () => {
  const current = reservoirs[selectedIndex];
  if (current.status !== 'OK' || current.offline) {
    alert('A leitura do sensor não está estável ou o dispositivo está sem comunicação.');
    return;
  }
  const confirmed = confirm(`Deseja capturar a distância atual de ${current.distance} cm como o ponto de NÍVEL CHEIO (100%) para ${current.id}?\n\n(Lembrete: certifique-se de que respeita o ponto cego mínimo do sensor de ~5 cm)`);
  if (confirmed) {
    $('#inputDistFull').value = current.distance;
    updateComputedSpan();
  }
};

$('#advancedConfigForm').onsubmit = e => {
  e.preventDefault();
  const form = e.currentTarget;
  const current = reservoirs[selectedIndex];

  current.name = form.elements.name.value.trim();
  current.location = form.elements.location.value.trim();
  current.capacity = parseFloat(form.elements.capacity.value);
  current.geometry = form.elements.geometry.value;

  current.base = parseFloat(form.elements.base.value) || 95;
  current.top = parseFloat(form.elements.top.value) || 122;
  current.extHeight = parseFloat(form.elements.extHeight.value) || 58;
  current.diameter = parseFloat(form.elements.diameter.value) || 100;
  current.width = parseFloat(form.elements.width.value) || 80;
  current.length = parseFloat(form.elements.length.value) || 120;

  current.distEmpty = parseFloat(form.elements.distEmpty.value);
  current.distFull = parseFloat(form.elements.distFull.value);

  logEvent(current, `Calibração atualizada: Vazio=${current.distEmpty}cm, Cheio=${current.distFull}cm, Formato=${formatGeometryName(current.geometry)}`, 'Calibração');
  modalConfig.close();
  renderApp();
};

// Tabs no Modal de Calibração
$$('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    $$('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#${btn.dataset.tab}`).classList.add('active');
  };
});

// ==========================================
// CADASTRO POR CÂMERA & OCR DE ETIQUETA
// ==========================================
const modalCamera = $('#modalCamera');
let cameraStream = null;

function openCameraModal() {
  modalCamera.showModal();
}

async function startCamera() {
  const video = $('#cameraVideo');
  const placeholder = $('#cameraPlaceholder');
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = cameraStream;
    placeholder.style.display = 'none';
  } catch (err) {
    alert('Não foi possível acessar a webcam diretamente (permissão ou dispositivo ausente). Use a opção de carregar foto da etiqueta ou o botão de simulação rápida.');
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
    $('#cameraPlaceholder').style.display = 'flex';
  }
}

$('#btnStartCamera').onclick = startCamera;

function simulateOcrProcess(customText = null) {
  const rawText = customText || `[FABRICANTE: FORTLEV INDUSTRIA BRASILEIRA]
MODELO: RESERVATORIO CONICO POLIETILENO
CAPACIDADE NOMINAL: 500 LITROS
ALTURA: 58 CM | DIAMETRO BASE: 95 CM | DIAMETRO BOCA: 122 CM
INMETRO REGISTRO: 004812/2021
NORMA TECNICA: NBR 14799`;

  $('#rawOcrText').textContent = rawText;
  
  // Preencher formulário de validação com os dados extraídos
  $('#ocrModel').value = 'Fortlev Cônica 500 L';
  $('#ocrCapacity').value = 500;
  $('#ocrGeometry').value = 'tronco_cone';
  $('#ocrHeight').value = 58.0;
  $('#ocrBase').value = 95.0;
  $('#ocrTop').value = 122.0;
}

$('#btnSimulateOCR').onclick = () => simulateOcrProcess();
$('#btnSnapAndOCR').onclick = () => {
  // Simula captura de frame da câmera e OCR
  simulateOcrProcess(`[CAPTURA DE CÂMERA REALIZADA COM SUCESSO]
ETIQUETA ENCONTRADA: FORTLEV 500L
CAPACIDADE: 500 L
DIMENSOES ESTIMADAS DE CATALOGO APLICADAS`);
};

$('#cameraFileInput').onchange = e => {
  const file = e.target.files[0];
  if (file) {
    simulateOcrProcess(`[IMAGEM CARREGADA: ${file.name}]
OCR IDENTIFICOU: ETIQUETA NORMATIZADA DE FABRICANTE
CAPACIDADE: 500L
FORMATO: TRONCO DE CONE`);
  }
};

$('#ocrConfirmForm').onsubmit = e => {
  e.preventDefault();
  const current = reservoirs[selectedIndex];

  current.name = `${$('#ocrModel').value || 'Reservatório Cônico'}`;
  current.capacity = parseFloat($('#ocrCapacity').value) || 500;
  current.geometry = $('#ocrGeometry').value;
  current.extHeight = parseFloat($('#ocrHeight').value) || 58;
  current.base = parseFloat($('#ocrBase').value) || 95;
  current.top = parseFloat($('#ocrTop').value) || 122;

  logEvent(current, `Dados da etiqueta confirmados via OCR: ${current.capacity}L, ${formatGeometryName(current.geometry)}`, 'OCR Câmera');
  stopCamera();
  modalCamera.close();
  renderApp();
  alert(`Cadastro de ${current.id} atualizado com sucesso a partir dos dados confirmados da etiqueta!`);
};

// ==========================================
// GATEWAY DE TELEMETRIA ESP32 (INTEGRAÇÃO & TESTE)
// ==========================================
const modalGateway = $('#modalGateway');

function openGatewayModal() {
  $('#injectDeviceId').value = reservoirs[selectedIndex].id;
  $('#injectDistance').value = reservoirs[selectedIndex].distance;
  modalGateway.showModal();
}

// Injeção de Telemetria de Teste
$('#telemetryInjectForm').onsubmit = e => {
  e.preventDefault();
  const devId = $('#injectDeviceId').value;
  const dist = parseFloat($('#injectDistance').value);
  const status = $('#injectStatus').value;
  const rssi = parseInt($('#injectRssi').value) || -65;

  const targetIndex = reservoirs.findIndex(r => r.id === devId);
  if (targetIndex === -1) return;

  const target = reservoirs[targetIndex];
  target.distance = dist;
  target.status = status;
  target.rssi = rssi;
  target.lastUpdated = Date.now();
  target.offline = false;
  if (target.isReal) {
    target.hasReceivedRealData = true;
  }

  logEvent(target, `Telemetria recebida: ${dist} cm (Status: ${status}, RSSI: ${rssi} dBm)`, target.isReal ? 'ESP32 Real' : 'Gateway Teste');

  const logText = `[${new Date().toLocaleTimeString('pt-BR')}] POST /api/telemetry
Device: ${devId}
Distance: ${dist} cm
Status: ${status}
RSSI: ${rssi} dBm
Resultado: Telemetria aceita e validada na central.`;
  $('#gatewayTerminalLog').textContent = logText;

  // Enviar também via fetch local para o backend server.py se estiver rodando
  fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      device_id: devId,
      distance_cm: dist,
      status: status,
      rssi: rssi,
      samples: [dist, dist, dist]
    })
  }).catch(() => {
    // Modo estático offline seguro
  });

  renderApp();
};

// Presets de teste rápido do Gateway
$('#btnTestFull').onclick = () => {
  $('#injectDistance').value = '5.0';
  $('#injectStatus').value = 'OK';
};
$('#btnTestNormal').onclick = () => {
  $('#injectDistance').value = '21.2';
  $('#injectStatus').value = 'OK';
};
$('#btnTestLow').onclick = () => {
  $('#injectDistance').value = '55.0';
  $('#injectStatus').value = 'OK';
};
$('#btnTestEmpty').onclick = () => {
  $('#injectDistance').value = '63.0';
  $('#injectStatus').value = 'OK';
};
$('#btnTestOverflow').onclick = () => {
  $('#injectDistance').value = '1.0';
  $('#injectStatus').value = 'OK';
};
$('#btnTestSensorError').onclick = () => {
  $('#injectDistance').value = '0.0';
  $('#injectStatus').value = 'OUT_OF_RANGE';
};

// Polling Periódico no Gateway Local (/api/telemetry)
async function pollGatewayServer() {
  try {
    const res = await fetch('/api/telemetry');
    if (res.ok) {
      const data = await res.json();
      if (data && data.telemetry && data.telemetry['CAIXA-001']) {
        const espData = data.telemetry['CAIXA-001'];
        const esp001 = reservoirs[0];
        
        // Verifica se é uma leitura nova
        if (espData.distance_cm !== undefined && esp001.distance !== espData.distance_cm) {
          esp001.distance = Number(espData.distance_cm);
          esp001.status = espData.status || 'OK';
          esp001.rssi = espData.rssi || -65;
          esp001.lastUpdated = Date.now();
          esp001.offline = false;
          esp001.hasReceivedRealData = true;
          logEvent(esp001, `Telemetria física do ESP32: ${esp001.distance} cm (Status: ${esp001.status})`, 'ESP32 Wi-Fi');
          renderApp();
        }
      }
    }
  } catch (e) {
    // Servidor python estático ou modo puramente em memória
  }
}

// ==========================================
// MODAL DE SIMULAÇÃO DE CENÁRIOS
// ==========================================
const modalSim = $('#simulation');

function openSimModal() {
  const current = reservoirs[selectedIndex];
  $('#simName').textContent = `${current.id} · ${current.name}`;
  const calc = computeLevel(current);
  const currentPct = (calc.valid && calc.pct !== null) ? calc.pct : 72;
  $('#simValue').textContent = `${currentPct}%`;
  $('#slider').value = currentPct;
  $('#toggleOffline').textContent = current.offline ? 'Restaurar Comunicação' : 'Simular Perda de Sinal';
  $('#toggleSensorError').textContent = current.status !== 'OK' ? 'Restaurar Sensor Normal' : 'Simular Falha no Sensor';
  modalSim.showModal();
}

$('#slider').oninput = e => {
  const val = Number(e.target.value);
  const current = reservoirs[selectedIndex];
  const span = current.distEmpty - current.distFull;
  current.distance = Number((current.distEmpty - (val / 100) * span).toFixed(1));
  current.status = 'OK';
  current.offline = false;
  current.lastUpdated = Date.now();
  if (current.isReal) current.hasReceivedRealData = true;
  $('#simValue').textContent = `${val}%`;
  renderApp();
  saveState();
};

$('#slider').onchange = () => {
  const current = reservoirs[selectedIndex];
  const calc = computeLevel(current);
  logEvent(current, `Nível simulado definido em: ${calc.pct}%`, 'Simulação');
};

$$('[data-level]').forEach(btn => {
  btn.onclick = () => {
    const lvl = Number(btn.dataset.level);
    const current = reservoirs[selectedIndex];
    const span = current.distEmpty - current.distFull;
    current.distance = Number((current.distEmpty - (lvl / 100) * span).toFixed(1));
    current.status = 'OK';
    current.offline = false;
    current.lastUpdated = Date.now();
    if (current.isReal) current.hasReceivedRealData = true;
    logEvent(current, `Cenário simulado: ${btn.textContent.trim()} (${lvl}%)`, 'Simulação');
    $('#simValue').textContent = `${lvl}%`;
    $('#slider').value = lvl;
    renderApp();
    saveState();
  };
});

$('#toggleOffline').onclick = () => {
  const current = reservoirs[selectedIndex];
  current.offline = !current.offline;
  logEvent(current, current.offline ? 'Falha de comunicação simulada' : 'Comunicação restaurada', 'Simulação');
  $('#toggleOffline').textContent = current.offline ? 'Restaurar Comunicação' : 'Simular Perda de Sinal';
  renderApp();
  saveState();
};

$('#toggleSensorError').onclick = () => {
  const current = reservoirs[selectedIndex];
  current.status = current.status === 'OK' ? 'OUT_OF_RANGE' : 'OK';
  logEvent(current, current.status === 'OK' ? 'Sensor restaurado ao normal' : 'Falha ultrassônica simulada (OUT_OF_RANGE)', 'Simulação');
  $('#toggleSensorError').textContent = current.status !== 'OK' ? 'Restaurar Sensor Normal' : 'Simular Falha no Sensor';
  renderApp();
  saveState();
};

// ==========================================
// NAVEGAÇÃO E EVENTOS DE INTERFACE
// ==========================================
$('#nav-dashboard').onclick = () => {
  setActiveNav('nav-dashboard');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

$('#nav-analytics').onclick = () => {
  setActiveNav('nav-analytics');
  $('#analyticalPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

$('#nav-config').onclick = () => openConfigModal();
$('#nav-camera').onclick = () => openCameraModal();
$('#nav-gateway').onclick = () => openGatewayModal();
$('#nav-sim').onclick = () => openSimModal();

$('#btnOpenGatewayTop').onclick = () => openGatewayModal();
$('#btnQuickConfig').onclick = () => openConfigModal();
$('#btnQuickCamera').onclick = () => openCameraModal();
$('#btnQuickGateway').onclick = () => openGatewayModal();
$('#btnQuickSim').onclick = () => openSimModal();

function setActiveNav(id) {
  $$('.nav').forEach(n => n.classList.remove('active'));
  $(`#${id}`)?.classList.add('active');
}

// Fechamento de Modais
$$('[data-close]').forEach(btn => {
  btn.onclick = () => {
    stopCamera();
    btn.closest('dialog').close();
  };
});

// Busca e Filtros
$('#search').oninput = () => {
  currentPage = 1;
  renderApp();
};

$('#statusFilter').onchange = () => {
  currentPage = 1;
  renderApp();
};

$('#geometryFilter').onchange = () => {
  currentPage = 1;
  renderApp();
};

// Paginação
$('#prev').onclick = () => {
  if (currentPage > 1) {
    currentPage--;
    renderApp();
  }
};

$('#next').onclick = () => {
  currentPage++;
  renderApp();
};

// Reiniciar Dados
$('#reset').onclick = () => {
  if (confirm('Deseja realmente reiniciar os dados para o padrão de demonstração?\n(Isso apagará alterações salvas no navegador)')) {
    reservoirs = generateDefaults();
    selectedIndex = 0;
    currentPage = 1;
    saveState();
    renderApp();
  }
};

// Timers de Execução (Relógio e Polling)
setInterval(() => {
  renderApp();
}, 1000);

setInterval(pollGatewayServer, 2000);

// Inicialização
renderApp();
console.log('AquaVisão IHM inicializada com sucesso.');
