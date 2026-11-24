require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const mqtt = require('mqtt');
const { WebSocketServer } = require('ws');
const { getPool, ping, config } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/live' });
const port = Number(process.env.PORT || 8000);
let dbOnline = false;
let simulationTimer;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const broadcast = payload => {
  const data = JSON.stringify(payload);
  wss.clients.forEach(client => client.readyState === 1 && client.send(data));
};
const audit = async (action, type, id, details={}) => {
  if (!dbOnline) return;
  await getPool().execute('INSERT INTO audit_log(action,entity_type,entity_id,details) VALUES(?,?,?,?)', [action,type,String(id||''),JSON.stringify(details)]);
};
const volume = (r, level) => {
  const h=Math.max(0,Math.min(100,level))/100, a=r.base_diameter_cm/2, b=r.top_diameter_cm/2;
  const f=a===b?h:((a+(b-a)*h)**3-a**3)/(b**3-a**3);
  return Math.round(r.capacity_l*f*10)/10;
};

app.get('/api/health', async (_req,res) => {
  try { await ping(); dbOnline=true; } catch { dbOnline=false; }
  res.json({ ok:true, database:dbOnline?'connected':'unavailable', mysql:`${config.host}:${config.port}/${config.database}`, mqtt:mqttState });
});
app.get('/api/state', async (_req,res,next) => { try {
  const [rows]=await getPool().query('SELECT * FROM system_state WHERE id=1'); res.json(rows[0]);
} catch(e){next(e)} });
app.put('/api/state', async (req,res,next) => { try {
  const mode=req.body.operation_mode, status=req.body.simulation_status;
  if(!['stopped','simulation','production'].includes(mode)) return res.status(400).json({error:'Modo inválido'});
  if(!['idle','running','paused'].includes(status)) return res.status(400).json({error:'Estado inválido'});
  if(mode==='production' && status!=='idle') return res.status(400).json({error:'Produção não aceita simulação ativa'});
  await getPool().execute('UPDATE system_state SET operation_mode=?,simulation_status=? WHERE id=1',[mode,status]);
  if(mode==='simulation'&&status==='running') startSimulation(); else stopSimulation();
  await audit('mode_changed','system',1,{mode,status}); broadcast({type:'state',mode,status}); res.json({mode,status});
} catch(e){next(e)} });
app.get('/api/reservoirs', async (_req,res,next) => { try {
  const [rows]=await getPool().query(`SELECT r.*,(SELECT COUNT(*) FROM alerts a WHERE a.reservoir_id=r.id AND a.status!='resolved') alert_count FROM reservoirs r ORDER BY code`); res.json(rows);
} catch(e){next(e)} });
app.get('/api/reservoirs/:id/readings', async (req,res,next) => { try {
  const [rows]=await getPool().execute('SELECT level_pct,distance_cm,volume_l,source,quality,measured_at FROM readings WHERE reservoir_id=? ORDER BY measured_at DESC LIMIT 100',[req.params.id]); res.json(rows.reverse());
} catch(e){next(e)} });
app.get('/api/alerts', async (_req,res,next) => { try {
  const [rows]=await getPool().query(`SELECT a.*,r.code,r.name,r.location,r.current_level_pct FROM alerts a JOIN reservoirs r ON r.id=a.reservoir_id WHERE a.status!='resolved' ORDER BY FIELD(a.severity,'emergency','critical','warning','info'),a.created_at DESC LIMIT 100`); res.json(rows);
} catch(e){next(e)} });
app.post('/api/reservoirs', async (req,res,next) => { try {
  const b=req.body; const [result]=await getPool().execute(`INSERT INTO reservoirs(code,name,location,capacity_l,useful_height_cm,full_offset_cm,base_diameter_cm,top_diameter_cm,current_level_pct,data_source,communication_status) VALUES(?,?,?,?,?,?,?,?,0,'simulation','online')`,[b.code,b.name,b.location,b.capacity_l,b.useful_height_cm,b.full_offset_cm,b.base_diameter_cm,b.top_diameter_cm]);
  await audit('created','reservoir',result.insertId,b); res.status(201).json({id:result.insertId});
} catch(e){next(e)} });
app.post('/api/simulation/reset', async (_req,res,next) => { try {
  const [[state]]=await getPool().query('SELECT operation_mode FROM system_state WHERE id=1');
  if(state.operation_mode==='production') return res.status(409).json({error:'Bloqueado em produção'});
  await getPool().query("UPDATE reservoirs SET current_level_pct=0,data_source='simulation',communication_status='online',last_seen_at=NOW()");
  await audit('reset','simulation','all'); broadcast({type:'refresh'}); res.json({ok:true});
} catch(e){next(e)} });
app.post('/api/simulation/scenario', async (req,res,next) => { try {
  const [[system]]=await getPool().query('SELECT operation_mode FROM system_state WHERE id=1');
  if(system.operation_mode==='production') return res.status(409).json({error:'Cenários são bloqueados em produção'});
  const counts={full:Number(req.body.full||0),overflow:Number(req.body.overflow||0),low:Number(req.body.low||0),offline:Number(req.body.offline||0)};
  if(Object.values(counts).some(value=>!Number.isInteger(value)||value<0)) return res.status(400).json({error:'As quantidades devem ser números inteiros positivos'});
  const [reservoirs]=await getPool().query("SELECT * FROM reservoirs WHERE data_source='simulation' ORDER BY RAND()");
  const requested=Object.values(counts).reduce((sum,value)=>sum+value,0);
  if(requested>reservoirs.length) return res.status(400).json({error:`O cenário solicita ${requested} caixas, mas existem ${reservoirs.length} simuladas`});
  const connection=await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("UPDATE alerts SET status='resolved',resolved_at=NOW() WHERE status!='resolved'");
    let cursor=0;
    const apply=async(type,count,level,communication='online')=>{
      for(const r of reservoirs.slice(cursor,cursor+count)){
        await connection.execute("UPDATE reservoirs SET current_level_pct=?,communication_status=?,last_seen_at=NOW() WHERE id=?",[level,communication,r.id]);
        await connection.execute("INSERT INTO readings(reservoir_id,level_pct,volume_l,source,measured_at) VALUES(?,?,?,'simulation',NOW())",[r.id,level,level<=100?volume(r,level):null]);
        if(type){const severity=type==='overflow'?'critical':type==='offline'?'warning':'warning',message=type==='overflow'?`${r.code} em transbordamento simulado`:type==='offline'?`${r.code} sem comunicação simulada`:`${r.code} em nível baixo simulado`;await connection.execute('INSERT INTO alerts(reservoir_id,alert_type,severity,message) VALUES(?,?,?,?)',[r.id,type,severity,message])}
      }
      cursor+=count;
    };
    await apply(null,counts.full,100);await apply('overflow',counts.overflow,108);await apply('low',counts.low,10);await apply('offline',counts.offline,50,'offline');
    for(const r of reservoirs.slice(cursor)){const level=35+Math.floor(Math.random()*55);await connection.execute("UPDATE reservoirs SET current_level_pct=?,communication_status='online',last_seen_at=NOW() WHERE id=?",[level,r.id])}
    await connection.execute("UPDATE system_state SET operation_mode='simulation',simulation_status='running' WHERE id=1");
    await connection.commit();
  } catch(error){await connection.rollback();throw error} finally{connection.release()}
  startSimulation();await audit('scenario_started','simulation','all',counts);broadcast({type:'refresh'});res.json({ok:true,counts,total:reservoirs.length});
} catch(e){next(e)} });
app.post('/api/camera-measurements', async (req,res,next) => { try {
  const b=req.body; const [result]=await getPool().execute('INSERT INTO camera_measurements(reservoir_id,measurement_type,value_cm,confidence,reference_cm,roi_json) VALUES(?,?,?,?,?,?)',[b.reservoir_id,b.measurement_type,b.value_cm||null,b.confidence,b.reference_cm||null,JSON.stringify(b.roi)]);
  await audit('camera_measurement','reservoir',b.reservoir_id,b); res.status(201).json({id:result.insertId});
} catch(e){next(e)} });
app.post('/api/alerts/:id/acknowledge', async (req,res,next) => { try {
  await getPool().execute("UPDATE alerts SET status='acknowledged',acknowledged_by='operador-local',acknowledged_at=NOW() WHERE id=?",[req.params.id]); broadcast({type:'refresh'}); res.json({ok:true});
} catch(e){next(e)} });
app.post('/api/alerts/clear-all', async (_req,res,next) => { try {
  const [result]=await getPool().query("UPDATE alerts SET status='resolved',resolved_at=NOW() WHERE status!='resolved'");
  await audit('alerts_cleared','alert','all',{count:result.affectedRows});broadcast({type:'refresh'});res.json({ok:true,cleared:result.affectedRows});
} catch(e){next(e)} });

async function ingest(payload, source='wifi') {
  if(!dbOnline) return;
  const code=payload.reservoir_id, uid=payload.device_id;
  if(!code || !Number.isFinite(Number(payload.distance_cm))) return;
  const [[r]]=await getPool().execute('SELECT * FROM reservoirs WHERE code=?',[code]); if(!r)return;
  const distance=Number(payload.distance_cm);
  const level=Math.max(0,Math.min(110,100*(r.full_offset_cm+r.useful_height_cm-distance)/r.useful_height_cm));
  const vol=level<=100?volume(r,level):null;
  await getPool().execute(`INSERT INTO devices(device_uid,reservoir_id,transport,firmware_version,ip_address,rssi,status,last_seen_at) VALUES(?,?,?, ?,?,?, 'online',NOW()) ON DUPLICATE KEY UPDATE reservoir_id=VALUES(reservoir_id),firmware_version=VALUES(firmware_version),rssi=VALUES(rssi),status='online',last_seen_at=NOW()`,[uid||`WIFI-${code}`,r.id,source,payload.firmware_version||null,payload.ip_address||null,payload.signal_rssi||null]);
  const [[d]]=await getPool().execute('SELECT id FROM devices WHERE device_uid=?',[uid||`WIFI-${code}`]);
  await getPool().execute('UPDATE reservoirs SET current_level_pct=?,data_source=?,communication_status="online",last_seen_at=NOW() WHERE id=?',[level,source,r.id]);
  await getPool().execute('INSERT INTO readings(reservoir_id,device_id,level_pct,distance_cm,volume_l,source,quality,measured_at) VALUES(?,?,?,?,?,?,?,?)',[r.id,d.id,level,distance,vol,source,payload.quality||null,new Date(payload.measured_at||Date.now())]);
  if(level>100) await getPool().execute(`INSERT INTO alerts(reservoir_id,alert_type,severity,message) SELECT ?, 'overflow','critical',? WHERE NOT EXISTS(SELECT 1 FROM alerts WHERE reservoir_id=? AND alert_type='overflow' AND status!='resolved')`,[r.id,`${code} com risco de transbordamento`,r.id]);
  broadcast({type:'reading',reservoir_id:r.id,level_pct:level,source});
}

function startSimulation(){
  if(simulationTimer)return;
  simulationTimer=setInterval(async()=>{ try {
    const [rows]=await getPool().query("SELECT * FROM reservoirs WHERE data_source='simulation' AND communication_status!='offline'");
    for(const r of rows){ const next=r.current_level_pct>100?Math.max(101,Math.min(110,r.current_level_pct+(Math.random()*1.2-.6))):Math.max(0,Math.min(100,r.current_level_pct+(Math.random()*3-1.2))); await getPool().execute("UPDATE reservoirs SET current_level_pct=?,last_seen_at=NOW() WHERE id=?",[next,r.id]); await getPool().execute("INSERT INTO readings(reservoir_id,level_pct,volume_l,source,measured_at) VALUES(?,?,?,'simulation',NOW())",[r.id,next,next<=100?volume(r,next):null]); }
    broadcast({type:'refresh'});
  }catch{} },3000);
}
function stopSimulation(){ clearInterval(simulationTimer); simulationTimer=null; }

let mqttState='disabled';
const mqttUrl=process.env.MQTT_URL || 'mqtt://127.0.0.1:1883';
if(mqttUrl){
  const client=mqtt.connect(mqttUrl,{username:process.env.MQTT_USERNAME||undefined,password:process.env.MQTT_PASSWORD||undefined,reconnectPeriod:5000});
  client.on('connect',()=>{mqttState='connected';client.subscribe('aquavisao/reservatorios/+/telemetria')});
  client.on('offline',()=>mqttState='offline'); client.on('error',()=>mqttState='error');
  client.on('message',(_topic,message)=>{try{void ingest(JSON.parse(message.toString()),'wifi')}catch{}});
}

app.use((error,_req,res,_next)=>{ console.error(error.message); res.status(500).json({error:error.code==='ECONNREFUSED'?'MySQL indisponível':error.message}); });
server.listen(port,async()=>{try{await ping();dbOnline=true}catch{} console.log(`AquaVisão: http://localhost:${port} | MySQL: ${dbOnline?'conectado':'indisponível'}`)});
