/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║           BATALHA DE QI — SERVIDOR BACKEND v2.0                  ║
 * ║           Node.js · Socket.IO · Firebase Admin                   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * ── INSTALAÇÃO ─────────────────────────────────────────────────────
 *   npm init -y
 *   npm install express socket.io cors dotenv firebase-admin
 *
 * ── RODAR ──────────────────────────────────────────────────────────
 *   node server.js
 *   (ou com nodemon: npx nodemon server.js)
 *
 * ── .env ───────────────────────────────────────────────────────────
 *   PORT=3001
 *   FIREBASE_PROJECT_ID=seu-projeto
 *   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
 *   FIREBASE_CLIENT_EMAIL=firebase-adminsdk@seu-projeto.iam.gserviceaccount.com
 *
 * ── ESTRUTURA DE SALAS ─────────────────────────────────────────────
 *   rooms Map  →  roomCode: Room
 *   players Map →  socketId: PlayerMeta
 *
 * ── EVENTOS SOCKET.IO ──────────────────────────────────────────────
 *
 *  CLIENTE → SERVIDOR:
 *    auth            { token?, guestName, avatar }
 *    create_room     { mode }
 *    join_room       { code }
 *    start_game      {}
 *    submit_answer   { answer }
 *    reaction        { emoji }
 *    chat            { msg }
 *
 *  SERVIDOR → CLIENTE:
 *    auth_ok         { userId, name }
 *    auth_error      { message }
 *    room_created    { code, mode }
 *    room_joined     { code, mode, players[] }
 *    player_joined   { player, players[] }
 *    player_left     { id, name, players[] }
 *    host_changed    { newHostId }
 *    game_countdown  { seconds }
 *    round_start     { round, total, challenge, ranking[] }
 *    answer_result   { correct, points, streak }
 *    ranking_update  { ranking[] }
 *    round_result    { correctAnswer, explanation, ranking[], roundAnswers{} }
 *    game_over       { ranking[], stats{} }
 *    player_reaction { name, emoji }
 *    chat_message    { name, msg, ts }
 *    error           { message }
 */

require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');

// ── FIREBASE ADMIN (descomente ao configurar) ──────────────────────
// const admin = require('firebase-admin');
// admin.initializeApp({
//   credential: admin.credential.cert({
//     projectId:   process.env.FIREBASE_PROJECT_ID,
//     privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
//     clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
//   }),
// });
// const db = admin.firestore();

// ─────────────────────────────────────────────────────────────────
//  SERVER BOOTSTRAP
// ─────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  transports:    ['polling', 'websocket'],
  allowEIO3:     true,
  pingTimeout:   60000,
  pingInterval:  25000,
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serve index.html

const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────────────────────────
//  IN-MEMORY STATE  (produção: Redis ou Firestore)
// ─────────────────────────────────────────────────────────────────
const rooms   = new Map(); // code → Room
const players = new Map(); // socketId → PlayerMeta

// ─────────────────────────────────────────────────────────────────
//  BANCO DE QUESTÕES (50 questões únicas)
// ─────────────────────────────────────────────────────────────────
const QUESTION_BANK = [
  { type:'🧩 LÓGICA',     q:'Qual número completa: 2, 6, 7, 21, 22, __',                        a:['66','64','45','23'],  c:'66',  t:12, exp:'×3,+1,×3,+1 → 22×3=66' },
  { type:'🧩 LÓGICA',     q:'Fibonacci: 1,1,2,3,5,8,__',                                        a:['12','13','11','16'],  c:'13',  t:8,  exp:'5+8=13' },
  { type:'⚡ VELOCIDADE', q:'17 × 3 − 5 = ?',                                                   a:['46','51','42','49'],  c:'46',  t:7,  exp:'17×3=51, 51-5=46' },
  { type:'⚡ VELOCIDADE', q:'144 ÷ 12 + 8 × 2 = ?',                                             a:['28','32','44','24'],  c:'28',  t:9,  exp:'12+16=28' },
  { type:'⚡ VELOCIDADE', q:'(25 + 75) × 2 ÷ 5 = ?',                                           a:['40','50','30','45'],  c:'40',  t:9,  exp:'100×2÷5=40' },
  { type:'⚡ VELOCIDADE', q:'√169 = ?',                                                          a:['12','13','14','11'],  c:'13',  t:8,  exp:'13×13=169' },
  { type:'⚡ VELOCIDADE', q:'15% de 200 = ?',                                                    a:['30','25','35','20'],  c:'30',  t:8,  exp:'200×0.15=30' },
  { type:'⚡ VELOCIDADE', q:'2⁸ = ?',                                                            a:['128','256','64','512'],c:'256', t:9,  exp:'2^8=256' },
  { type:'⚡ VELOCIDADE', q:'999 × 9 = ?',                                                       a:['8991','9001','8999','9091'],c:'8991',t:10,exp:'1000×9-9=8991' },
  { type:'🧩 LÓGICA',     q:'Se hoje é terça, que dia será daqui a 100 dias?',                  a:['Quinta','Sexta','Quarta','Sábado'],c:'Quinta',t:12,exp:'100=14×7+2, terça+2=quinta' },
  { type:'🧩 LÓGICA',     q:'Qual número é diferente? 2, 4, 7, 8, 10',                          a:['2','7','4','10'],     c:'7',   t:8,  exp:'7 é o único ímpar' },
  { type:'🧩 LÓGICA',     q:'Se A=1,B=2,C=3… quanto vale CAT?',                                a:['24','23','25','26'],  c:'24',  t:10, exp:'C=3,A=1,T=20 → 24' },
  { type:'🧩 LÓGICA',     q:'Quantos quadrados num tabuleiro 2×2?',                             a:['4','5','6','8'],      c:'5',   t:12, exp:'4 pequenos + 1 grande = 5' },
  { type:'🧩 LÓGICA',     q:'Se 5 máquinas fazem 5 peças em 5min, 100 máquinas fazem em?',     a:['5 min','100 min','20 min','1 min'],c:'5 min',t:14,exp:'Cada máquina=1 peça em 5min' },
  { type:'🔤 PALAVRA',    q:'Anagrama de AMOR:',                                                 a:['MORA','ROTA','RAMO','ARMO'],c:'MORA',t:7,  exp:'AMOR → MORA' },
  { type:'🔤 PALAVRA',    q:'Qual palavra tem R e T? (mais longa)',                              a:['ARTE','CARTA','RATO','GATO'],c:'CARTA',t:7,  exp:'CARTA: 5 letras com R e T' },
  { type:'🔤 PALAVRA',    q:'"Escarlate" é tonalidade de:',                                     a:['Vermelho','Roxo','Azul','Verde'],c:'Vermelho',t:7,exp:'Escarlate=vermelho vivo' },
  { type:'🔤 PALAVRA',    q:'ESTRELA sem as vogais: quantas consoantes?',                       a:['3','4','2','5'],      c:'4',   t:8,  exp:'S,T,R,L = 4 consoantes' },
  { type:'🔤 PALAVRA',    q:'Qual NÃO é sinônimo de "rápido"?',                                 a:['veloz','ligeiro','lento','ágil'],c:'lento',t:7,exp:'"lento" é antônimo' },
  { type:'👁️ SEQUÊNCIA',  q:'O que vem a seguir? ○ □ ○○ □□ ○○○ __',                           a:['□□□','○○○○','□□','○□'],c:'□□□', t:10, exp:'Padrão alternado crescente' },
  { type:'👁️ SEQUÊNCIA',  q:'Qual número falta? _ 4 9 16 25 36',                                a:['1','2','3','0'],      c:'1',   t:8,  exp:'Quadrados: 1² 2² 3²…' },
  { type:'👁️ SEQUÊNCIA',  q:'Complete: J F M A M J J A S O _ D',                               a:['N','V','B','P'],      c:'N',   t:10, exp:'Iniciais meses: Novembro' },
  { type:'👁️ SEQUÊNCIA',  q:'A→Z, B→Y, C→X, D→?',                                             a:['W','V','U','X'],      c:'W',   t:8,  exp:'Espelho do alfabeto' },
  { type:'👁️ SEQUÊNCIA',  q:'Z, X, V, T, R, __',                                               a:['P','Q','S','O'],      c:'P',   t:10, exp:'Letras pulando 1 de trás para frente' },
  { type:'🔬 CULTURA',    q:'Quantos ossos tem o adulto?',                                       a:['206','212','198','220'],c:'206', t:10, exp:'206 ossos no adulto' },
  { type:'🔬 CULTURA',    q:'Elemento mais abundante no universo?',                              a:['Hidrogênio','Hélio','Oxigênio','Carbono'],c:'Hidrogênio',t:10,exp:'H≈75% da massa do universo' },
  { type:'🔬 CULTURA',    q:'A luz viaja aproximadamente quantos km/s?',                         a:['300.000','150.000','500.000','250.000'],c:'300.000',t:10,exp:'≈299.792 km/s' },
  { type:'🔬 CULTURA',    q:'Quantos planetas há no Sistema Solar?',                             a:['8','9','7','10'],     c:'8',   t:7,  exp:'Plutão reclassificado em 2006' },
  { type:'🔬 CULTURA',    q:'Em que ano o homem pisou na Lua?',                                  a:['1969','1972','1968','1971'],c:'1969',t:8,exp:'Apollo 11, 20/07/1969' },
  { type:'🧮 MATEMÁTICA', q:'Qual o valor de π até 4 casas decimais?',                          a:['3.1416','3.1415','3.1417','3.1414'],c:'3.1416',t:10,exp:'π≈3.14159 → 3.1416' },
  { type:'🧮 MATEMÁTICA', q:'Quantos segundos há em um dia?',                                   a:['86.400','84.600','82.400','90.000'],c:'86.400',t:10,exp:'24×60×60=86.400' },
  { type:'🧮 MATEMÁTICA', q:'Se x² = 144, qual é x?',                                           a:['12','11','14','13'],  c:'12',  t:8,  exp:'√144=12' },
  { type:'🧮 MATEMÁTICA', q:'Qual é o MDC de 48 e 36?',                                         a:['12','6','8','9'],     c:'12',  t:12, exp:'48=4×12, 36=3×12 → MDC=12' },
  { type:'🔥 DIFÍCIL',    q:'Quantas vezes se pode dobrar um papel A4?',                        a:['7','8','∞','5'],      c:'7',   t:12, exp:'Fisicamente impossível além de 7' },
  { type:'🔥 DIFÍCIL',    q:'Trem 500m + ponte 1000m a 50m/s. Quanto tempo?',                  a:['30s','25s','20s','40s'],c:'30s', t:14, exp:'1500m÷50=30s' },
  { type:'🔥 DIFÍCIL',    q:'Menor primo maior que 50:',                                         a:['53','51','57','59'],  c:'53',  t:10, exp:'51=3×17, 53 é primo' },
  { type:'🔥 DIFÍCIL',    q:'Monte Hall: deve trocar de porta?',                                a:['Sim','Não','Tanto faz','Depende'],c:'Sim',t:14,exp:'Trocar: 2/3 de chance vs 1/3' },
  { type:'🧩 LÓGICA',     q:'3 gatos/3 ratos/3min → 6 gatos/6min = ?ratos',                   a:['6','12','9','18'],    c:'12',  t:15, exp:'1 gato pega 2 ratos em 6min' },
  { type:'⚡ VELOCIDADE', q:'(12×12) − (11×11) = ?',                                            a:['23','25','24','22'],  c:'23',  t:10, exp:'144-121=23' },
  { type:'⚡ VELOCIDADE', q:'33 × 33 = ?',                                                       a:['1089','1099','999','1000'],c:'1089',t:10,exp:'(30+3)²=900+180+9=1089' },
  { type:'⚡ VELOCIDADE', q:'1/4 + 1/2 + 1/8 = ?',                                             a:['7/8','6/8','5/8','3/4'],c:'7/8', t:10, exp:'2/8+4/8+1/8=7/8' },
  { type:'🔬 CULTURA',    q:'Qual país tem mais Nobel?',                                         a:['EUA','Reino Unido','Alemanha','França'],c:'EUA',t:10,exp:'EUA lidera com 400+ laureados' },
  { type:'🔤 PALAVRA',    q:'Plural de "cidadão":',                                              a:['cidadãos','cidadões','cidadãis','cidadans'],c:'cidadãos',t:8,exp:'"cidadãos" é correto' },
  { type:'🧩 LÓGICA',     q:'A sequência é: 1, 4, 9, 16, 25, __',                              a:['36','49','30','35'],  c:'36',  t:7,  exp:'n²: 6²=36' },
  { type:'🔬 CULTURA',    q:'0.1 + 0.2 em computação (ponto flutuante):',                      a:['0.3','≠ 0.3 exato','NaN','Erro'],c:'≠ 0.3 exato',t:12,exp:'0.30000000000000004 por ponto flutuante' },
  { type:'🧩 LÓGICA',     q:'Quantos triângulos? △△△ / △△ / △',                               a:['6','7','8','10'],     c:'7',   t:12, exp:'6 pequenos + 1 grande = 7' },
  { type:'🔤 PALAVRA',    q:'Quantas letras "A" em "AVIAÇÃO BRASILEIRA"?',                     a:['5','6','4','7'],      c:'5',   t:9,  exp:'A-V-I-A-Ç-Ã-O=3, BR-A=1, ...EIRA=1 → 5' },
  { type:'🧮 MATEMÁTICA', q:'Raiz cúbica de 27 = ?',                                            a:['3','4','9','6'],      c:'3',   t:8,  exp:'3×3×3=27' },
  { type:'⚡ VELOCIDADE', q:'25% de 480 = ?',                                                   a:['120','100','140','96'],c:'120', t:8,  exp:'480÷4=120' },
  { type:'🔥 DIFÍCIL',    q:'Soma de ângulos internos de um pentágono = ?°',                   a:['540','360','720','480'],c:'540', t:12, exp:'(5-2)×180=540°' },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickQuestions(n = 10) {
  return shuffle(QUESTION_BANK).slice(0, Math.min(n, QUESTION_BANK.length));
}

// ─────────────────────────────────────────────────────────────────
//  ROOM FACTORY
// ─────────────────────────────────────────────────────────────────
function createRoom(hostId, mode = 'normal') {
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  const room = {
    code,
    hostId,
    mode,
    state: 'lobby',        // lobby | countdown | playing | round_result | finished
    players: new Map(),    // socketId → { socketId, userId, name, avatar }
    questions: [],
    currentRound: -1,
    roundAnswers: new Map(), // socketId → { answer, timeMs, correct }
    roundTimer: null,
    roundStartTime: 0,
    scores:  new Map(),    // socketId → number
    streaks: new Map(),    // socketId → number
    wrongs:  new Map(),    // socketId → number  (for hardcore/survival)
    alive:   new Map(),    // socketId → boolean
    createdAt: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

function getRoomBySocket(socketId) {
  for (const [, room] of rooms) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

function getRanking(room) {
  return [...room.scores.entries()]
    .map(([id, score]) => {
      const p = room.players.get(id);
      return {
        id,
        name:   p?.name   || '?',
        avatar: p?.avatar || '🧠',
        score,
        streak: room.streaks.get(id) || 0,
        alive:  room.alive.get(id) !== false,
      };
    })
    .sort((a, b) => {
      if (room.mode === 'survival') {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
      }
      return b.score - a.score;
    });
}

function computePoints(room, socketId, timeLeft, maxTime) {
  const streak = room.streaks.get(socketId) || 0;
  const speedBonus = Math.ceil(timeLeft * 12);
  const mult = 1 + Math.min(streak, 5) * 0.4;
  return Math.floor((100 + speedBonus) * mult);
}

// ─────────────────────────────────────────────────────────────────
//  ROUND LIFECYCLE
// ─────────────────────────────────────────────────────────────────
function startRound(room) {
  room.currentRound++;
  const q = room.questions[room.currentRound];

  if (!q) { endGame(room); return; }

  // Check if all alive players are still in the game
  const alivePlayers = [...room.alive.entries()].filter(([, a]) => a).length;
  if (room.mode === 'survival' && alivePlayers <= 1) { endGame(room); return; }

  room.state = 'playing';
  room.roundAnswers.clear();
  room.roundStartTime = Date.now();

  const maxTime = room.mode === 'blitz' ? 5 : q.t;

  io.to(room.code).emit('round_start', {
    round:     room.currentRound + 1,
    total:     room.questions.length,
    challenge: { type: q.type, q: q.q, a: q.a, t: maxTime },
    ranking:   getRanking(room),
  });

  clearTimeout(room.roundTimer);
  room.roundTimer = setTimeout(() => resolveRound(room), maxTime * 1000 + 600);
}

function resolveRound(room) {
  clearTimeout(room.roundTimer);
  const q = room.questions[room.currentRound];
  room.state = 'round_result';

  const roundAnswersObj = {};
  for (const [id, data] of room.roundAnswers) {
    const p = room.players.get(id);
    roundAnswersObj[id] = { name: p?.name, avatar: p?.avatar, ...data };
  }

  io.to(room.code).emit('round_result', {
    correctAnswer: q.c,
    explanation:   q.exp,
    ranking:       getRanking(room),
    roundAnswers:  roundAnswersObj,
  });

  const isLast = room.currentRound >= room.questions.length - 1;
  if (isLast) {
    setTimeout(() => endGame(room), 4500);
  } else {
    setTimeout(() => startRound(room), 4500);
  }
}

function endGame(room) {
  room.state = 'finished';
  const ranking = getRanking(room);

  // Compute per-player stats
  const stats = {};
  for (const [id] of room.players) {
    stats[id] = {
      score:  room.scores.get(id) || 0,
      streak: room.streaks.get(id) || 0,
      alive:  room.alive.get(id) !== false,
    };
  }

  io.to(room.code).emit('game_over', { ranking, stats });

  // Optional: save to Firestore
  // saveGameResultToDb(room, ranking);

  // Clean up after 2 minutes
  setTimeout(() => {
    if (rooms.has(room.code)) rooms.delete(room.code);
    console.log(`🗑️  Sala ${room.code} expirada e removida`);
  }, 120000);
}

// ─────────────────────────────────────────────────────────────────
//  SOCKET.IO EVENTS
// ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Conexão: ${socket.id}`);

  // ── AUTH ──────────────────────────────────────────────────────
  socket.on('auth', async ({ token, guestName, avatar } = {}) => {
    let userId = socket.id;
    let name   = (guestName || 'Visitante').slice(0, 20);
    let av     = avatar || '🧠';

    // Firebase token verification (descomente ao ativar Firebase):
    // if (token) {
    //   try {
    //     const decoded = await admin.auth().verifyIdToken(token);
    //     userId = decoded.uid;
    //     name   = decoded.name || name;
    //   } catch {
    //     socket.emit('auth_error', { message: 'Token inválido. Tente novamente.' });
    //     return;
    //   }
    // }

    players.set(socket.id, { socketId: socket.id, userId, name, avatar: av });
    socket.emit('auth_ok', { userId, name });
    console.log(`✅ Auth: ${name}`);
  });

  // ── CREATE ROOM ───────────────────────────────────────────────
  socket.on('create_room', ({ mode } = {}) => {
    const player = players.get(socket.id);
    if (!player) return socket.emit('error', { message: 'Faça auth primeiro.' });

    // Remove from previous room if any
    const prevRoom = getRoomBySocket(socket.id);
    if (prevRoom) leaveRoom(socket, prevRoom);

    const room = createRoom(socket.id, mode || 'normal');
    room.players.set(socket.id, player);
    room.scores.set(socket.id, 0);
    room.streaks.set(socket.id, 0);
    room.wrongs.set(socket.id, 0);
    room.alive.set(socket.id, true);

    socket.join(room.code);
    socket.emit('room_created', { code: room.code, mode: room.mode });
    console.log(`🏠 Sala ${room.code} criada por ${player.name}`);
  });

  // ── JOIN ROOM ──────────────────────────────────────────────────
  socket.on('join_room', ({ code } = {}) => {
    const room = rooms.get(code?.toUpperCase?.());
    if (!room)                  return socket.emit('error', { message: 'Sala não encontrada.' });
    if (room.state !== 'lobby') return socket.emit('error', { message: 'Partida já iniciada.' });
    if (room.players.size >= 8) return socket.emit('error', { message: 'Sala cheia (máx 8).' });

    const player = players.get(socket.id) || { socketId: socket.id, name: 'Visitante', avatar: '🧠' };

    // Remove from previous room
    const prevRoom = getRoomBySocket(socket.id);
    if (prevRoom && prevRoom.code !== room.code) leaveRoom(socket, prevRoom);

    room.players.set(socket.id, player);
    room.scores.set(socket.id, 0);
    room.streaks.set(socket.id, 0);
    room.wrongs.set(socket.id, 0);
    room.alive.set(socket.id, true);

    socket.join(room.code);
    socket.emit('room_joined', {
      code:    room.code,
      mode:    room.mode,
      players: [...room.players.values()],
    });

    io.to(room.code).emit('player_joined', {
      player:  { id: socket.id, name: player.name, avatar: player.avatar },
      players: [...room.players.values()],
    });
    console.log(`➡️  ${player.name} entrou na sala ${room.code}`);
  });

  // ── START GAME ────────────────────────────────────────────────
  socket.on('start_game', () => {
    const room = getRoomBySocket(socket.id);
    if (!room)                        return socket.emit('error', { message: 'Sala não encontrada.' });
    if (room.hostId !== socket.id)    return socket.emit('error', { message: 'Apenas o host pode iniciar.' });
    if (room.state !== 'lobby')       return socket.emit('error', { message: 'Jogo já iniciado.' });
    if (room.players.size < 1)        return socket.emit('error', { message: 'Mínimo 1 jogador.' });

    // Reset scores
    for (const id of room.players.keys()) {
      room.scores.set(id, 0);
      room.streaks.set(id, 0);
      room.wrongs.set(id, 0);
      room.alive.set(id, true);
    }

    room.state      = 'countdown';
    room.questions  = pickQuestions(10);
    room.currentRound = -1;

    io.to(room.code).emit('game_countdown', { seconds: 3 });
    console.log(`🚀 Partida iniciada: ${room.code} [${room.mode}] ${room.players.size} jogadores`);
    setTimeout(() => startRound(room), 3600);
  });

  // ── SUBMIT ANSWER ─────────────────────────────────────────────
  socket.on('submit_answer', ({ answer } = {}) => {
    const room = getRoomBySocket(socket.id);
    if (!room || room.state !== 'playing')    return;
    if (room.roundAnswers.has(socket.id))     return; // already answered
    if (room.alive.get(socket.id) === false)  return; // eliminated

    const q       = room.questions[room.currentRound];
    const timeMs  = Date.now() - room.roundStartTime;
    const maxTime = room.mode === 'blitz' ? 5 : q.t;
    const timeLeft = Math.max(0, maxTime - timeMs / 1000);
    const correct  = answer === q.c;

    room.roundAnswers.set(socket.id, { answer, timeMs, correct });

    if (correct) {
      const pts = computePoints(room, socket.id, timeLeft, maxTime);
      room.scores.set(socket.id, (room.scores.get(socket.id) || 0) + pts);
      room.streaks.set(socket.id, (room.streaks.get(socket.id) || 0) + 1);

      socket.emit('answer_result', {
        correct: true,
        points: pts,
        streak: room.streaks.get(socket.id),
      });
    } else {
      const curScore = room.scores.get(socket.id) || 0;
      const penalty  = room.mode === 'hardcore' ? 50 : 30;
      room.scores.set(socket.id, Math.max(0, curScore - penalty));
      room.streaks.set(socket.id, 0);

      // Count wrongs for hardcore
      const w = (room.wrongs.get(socket.id) || 0) + 1;
      room.wrongs.set(socket.id, w);
      if (room.mode === 'hardcore' && w >= 3) {
        room.scores.set(socket.id, 0);
      }
      // Survival: instant elimination
      if (room.mode === 'survival') {
        room.alive.set(socket.id, false);
      }

      socket.emit('answer_result', { correct: false, points: -penalty });
    }

    // Broadcast live ranking
    io.to(room.code).emit('ranking_update', { ranking: getRanking(room) });

    // Early resolve if everyone answered
    const activePlayers = [...room.players.keys()].filter(id => room.alive.get(id) !== false);
    if (room.roundAnswers.size >= activePlayers.length) {
      clearTimeout(room.roundTimer);
      setTimeout(() => resolveRound(room), 600);
    }
  });

  // ── REACTION ──────────────────────────────────────────────────
  socket.on('reaction', ({ emoji } = {}) => {
    const room   = getRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player) return;
    io.to(room.code).emit('player_reaction', { name: player.name, emoji });
  });

  // ── CHAT ──────────────────────────────────────────────────────
  socket.on('chat', ({ msg } = {}) => {
    const room   = getRoomBySocket(socket.id);
    const player = players.get(socket.id);
    if (!room || !player || !msg) return;
    const safe = String(msg).slice(0, 120).replace(/</g,'&lt;');
    io.to(room.code).emit('chat_message', {
      name: player.name,
      avatar: player.avatar,
      msg:  safe,
      ts:   Date.now(),
    });
  });

  // ── DISCONNECT ────────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`❌ Desconectado: ${socket.id} (${reason})`);
    const room = getRoomBySocket(socket.id);
    if (room) leaveRoom(socket, room);
    players.delete(socket.id);
  });
});

// ─────────────────────────────────────────────────────────────────
//  LEAVE ROOM HELPER
// ─────────────────────────────────────────────────────────────────
function leaveRoom(socket, room) {
  const player = room.players.get(socket.id);
  room.players.delete(socket.id);
  room.scores.delete(socket.id);
  room.streaks.delete(socket.id);
  room.wrongs.delete(socket.id);
  room.alive.delete(socket.id);

  socket.leave(room.code);

  io.to(room.code).emit('player_left', {
    id:      socket.id,
    name:    player?.name || '?',
    players: [...room.players.values()],
  });

  // Transfer host
  if (room.hostId === socket.id && room.players.size > 0) {
    room.hostId = [...room.players.keys()][0];
    io.to(room.code).emit('host_changed', { newHostId: room.hostId });
  }

  // Destroy empty room
  if (room.players.size === 0) {
    clearTimeout(room.roundTimer);
    rooms.delete(room.code);
    console.log(`🗑️  Sala ${room.code} destruída (vazia)`);
  }
}

// ─────────────────────────────────────────────────────────────────
//  OPTIONAL: FIREBASE PERSISTENCE
// ─────────────────────────────────────────────────────────────────
/*
async function saveGameResultToDb(room, ranking) {
  try {
    const batch = db.batch();
    for (const entry of ranking) {
      if (!entry.id.startsWith('u_')) continue; // skip bots
      const ref = db.collection('game_results').doc();
      batch.set(ref, {
        userId:    entry.id,
        name:      entry.name,
        score:     entry.score,
        position:  ranking.indexOf(entry) + 1,
        mode:      room.mode,
        roomCode:  room.code,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const userRef = db.collection('users').doc(entry.id);
      batch.update(userRef, {
        'stats.games': admin.firestore.FieldValue.increment(1),
        'stats.wins':  admin.firestore.FieldValue.increment(ranking.indexOf(entry) === 0 ? 1 : 0),
      });
    }
    await batch.commit();
  } catch (err) {
    console.error('Firestore error:', err.message);
  }
}
*/

// ─────────────────────────────────────────────────────────────────
//  REST ENDPOINTS
// ─────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => {
  res.json({ status: 'ok', rooms: rooms.size, players: players.size, uptime: process.uptime() });
});

app.get('/api/room/:code', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Sala não encontrada' });
  res.json({
    code:        room.code,
    mode:        room.mode,
    state:       room.state,
    playerCount: room.players.size,
    maxPlayers:  8,
  });
});

app.get('/api/leaderboard', async (_, res) => {
  // Production: query Firestore
  // const snap = await db.collection('users').orderBy('stats.xpTotal','desc').limit(20).get();
  // const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  res.json({ leaderboard: [] });
});

app.get('/api/stats', (_, res) => {
  res.json({
    totalRooms:   rooms.size,
    totalPlayers: players.size,
    modes: Object.fromEntries(
      [...rooms.values()].reduce((m, r) => {
        m.set(r.mode, (m.get(r.mode)||0) + 1);
        return m;
      }, new Map())
    ),
  });
});

// ─────────────────────────────────────────────────────────────────
//  CLEANUP — remove stale rooms every 10 minutes
// ─────────────────────────────────────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.state === 'finished' || (now - room.createdAt > 3600000)) {
      clearTimeout(room.roundTimer);
      rooms.delete(code);
      console.log(`♻️  Sala ${code} limpa por inatividade`);
    }
  }
}, 600000);

// ─────────────────────────────────────────────────────────────────
//  GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('🛑 Servidor encerrando...');
  io.emit('error', { message: 'Servidor em manutenção. Reconectando em breve...' });
  server.close(() => process.exit(0));
});

// ─────────────────────────────────────────────────────────────────
//  START
// ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║        BATALHA DE QI — SERVIDOR v2.0       ║
║        http://localhost:${PORT}               ║
╚════════════════════════════════════════════╝

📡 Socket.IO ativo
🔌 Aguardando conexões...
🧠 ${QUESTION_BANK.length} questões disponíveis no banco

Para conectar o frontend, no index.html descomente:
  socket = io('http://localhost:${PORT}');
`);
});
