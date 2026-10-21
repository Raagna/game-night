import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { importJeopardyLabs } from './jeopardylabs.js'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })
const games = new Map()
const gameTimers = new Map()
const MAX_PLAYERS = 6
// Phones drop their connection when the screen locks or the browser is backgrounded. Give them this long to come back before the game moves on without them.
const RECONNECT_GRACE_MS = 20000
const leaveTimers = new Map()
const leaveKey = (code, playerId) => `${code}:${playerId}`
// Fast Money finale: the top two players race the clock through the same five clues.
const FAST_MONEY = { introMs: 7000, betweenMs: 8000, firstMs: 20000, secondMs: 25000, points: 1000, bonus: 5000, hostlessRevealMs: 30000 }
const DEFAULT_ROUND_NAMES = ['Jeopardy!', 'Double Jeopardy!', 'Triple Jeopardy!']
function cancelLeave(code, playerId) { const key=leaveKey(code,playerId); clearTimeout(leaveTimers.get(key)); leaveTimers.delete(key) }

const id = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const clone = (x) => JSON.parse(JSON.stringify(x))
const NUMBER_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 }
const numberWordPattern = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join('|')})\\b`, 'g')
// Lowercases, strips accents, a leading "what is"/"who's" and leading articles (a/an/the), turns number words into digits ("four" = "4"), then drops spaces and punctuation.
const normalizeAnswer = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[’'`]/g,"'").trim()
  .replace(/^(what|who|where|when|why|how)('s|\s+(is|are|was|were))\s+/,'')
  .replace(/^(a|an|the)\s+/,'')
  .replace(numberWordPattern,(word)=>String(NUMBER_WORDS[word]))
  .replace(/[^a-z0-9]/g,'')
// Damerau-Levenshtein distance: one inserted, missing, wrong or swapped letter counts as 1.
function editDistance(a, b) {
  const d=Array.from({length:a.length+1},(_,i)=>[i, ...Array(b.length).fill(0)])
  for(let j=1;j<=b.length;j++) d[0][j]=j
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) {
    d[i][j]=Math.min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]===b[j-1]?0:1))
    if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) d[i][j]=Math.min(d[i][j], d[i-2][j-2]+1)
  }
  return d[a.length][b.length]
}
// Accepted spellings of the correct answer: as written, and with any "(optional)" part removed, e.g. "(Frank) Sinatra".
const answerVariants = (answer) => { const raw=String(answer || ''); return [...new Set([raw, raw.replace(/\([^)]*\)/g,' '), raw.replace(/[()]/g,' ')].map(normalizeAnswer).filter(Boolean))] }
function answersMatch(response, answer) {
  const given=normalizeAnswer(response); if(!given) return false
  return answerVariants(answer).some((expected) => {
    if(given===expected) return true
    if(/^\d+$/.test(expected)) return false // numbers and years must be exact
    const allowed=expected.length>=12 ? 2 : expected.length>=4 ? 1 : 0
    return allowed>0 && Math.abs(given.length-expected.length)<=allowed && editDistance(given,expected)<=allowed
  })
}
const connectedPlayers = (game) => [...game.players.values()].filter((player) => player.socketId)
function assignLowestConnected(game) {
  const players = connectedPlayers(game)
  if (!players.length) return null
  const low = Math.min(...players.map((player) => player.score))
  const choices = players.filter((player) => player.score === low)
  const player = choices[Math.floor(Math.random() * choices.length)]
  game.turnPlayerId = player.id
  game.answeringPlayerId = game.activeQuestion ? player.id : null
  game.buzzedPlayer = null
  game.buzzerOpen = false
  if (game.activeQuestion) game.activeQuestion.canPass = true
  return player
}

function publicGame(game) {
  const activeQuestion=game.activeQuestion ? clone(game.activeQuestion) : null
  const board=game.hostless ? clone(game.boards[game.boardIndex]) : game.boards[game.boardIndex]
  if(game.hostless) board?.forEach((category)=>category.questions.forEach((question)=>delete question.answer))
  if(game.hostless && activeQuestion?.question && !game.reveal) delete activeQuestion.question.answer
  return {
    code: game.code, status: game.status, hostless: !!game.hostless, board, boardIndex: game.boardIndex, boardCount: game.boards.length, roundNames: game.roundNames,
    final: !game.final ? null : game.hostless && !game.reveal ? { ...game.final, answer: undefined } : game.final, hasFastMoney: !!game.fastMoneyClues, fastMoney: publicFastMoney(game),
    players: [...game.players.values()].map(({ socketId, ...player }) => ({ ...player, connected: !!socketId })),
    buzzerOpen: game.buzzerOpen, buzzedPlayer: game.buzzedPlayer, buzzedAtMs: game.buzzedAtMs, buzzTimes: game.buzzTimes, buzzInputDeadline: game.buzzInputDeadline,
    activeQuestion, reveal: game.reveal, hostConnected: !!game.hostSocketId,
    finalResponses: [...game.finalResponses.entries()].map(([playerId, response]) => ({ playerId, ...response })),
    turnPlayerId: game.turnPlayerId, answeringPlayerId: game.answeringPlayerId, incorrectPlayerIds: game.incorrectPlayerIds,
    clueDeadline: game.clueDeadline, preBuzzDeadline: game.preBuzzDeadline, answerDeadline: game.answerDeadline, finalDeadline: game.finalDeadline, skipVotes: game.skipVotes || [], serverNow: Date.now(), lastEvent: game.lastEvent
  }
}
function emitGame(game) { io.to(game.code).emit('game:update', publicGame(game)) }
function clearGameTimers(game) { const timers=gameTimers.get(game.code)||{}; for(const timer of Object.values(timers)) clearTimeout(timer); gameTimers.set(game.code,{}) }
function schedule(game, name, ms, fn) { const timers=gameTimers.get(game.code)||{}; clearTimeout(timers[name]); timers[name]=setTimeout(fn, ms); gameTimers.set(game.code,timers) }
function markUsed(game) { const active=game.activeQuestion; if (!active || active.final) return; const question=game.boards[game.boardIndex]?.[active.categoryIndex]?.questions?.[active.questionIndex]; if(question) question.used=true }
function startFinal(game) { clearGameTimers(game); game.status='final'; game.activeQuestion={final:true,question:clone(game.final)}; game.preBuzzDeadline=null; game.clueDeadline=null; game.answerDeadline=null; game.finalDeadline=Date.now()+50000; game.reveal=false; game.buzzerOpen=false; schedule(game,'final',50000,()=>revealFinal(game)); emitGame(game) }
function returnToBoard(game) { clearGameTimers(game); markUsed(game); game.activeQuestion=null; game.preBuzzDeadline=null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpen=false; game.buzzerOpenedAt=null; game.buzzedPlayer=null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId=null; game.reveal=false; game.incorrectPlayerIds=[]; game.skipVotes=[]; const boardDone=game.boards[game.boardIndex]?.every((category)=>category.questions.every((question)=>question.used)); if(game.hostless && boardDone) return nextBoard(game); emitGame(game) }
function resetClueState(game) { game.activeQuestion=null; game.preBuzzDeadline=null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpen=false; game.buzzerOpenedAt=null; game.buzzedPlayer=null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId=null; game.reveal=false; game.incorrectPlayerIds=[]; game.skipVotes=[] }
// Move on from the current board: the next round if there is one, otherwise Final Jeopardy, Fast Money or the end.
function nextBoard(game) { clearGameTimers(game); resetClueState(game); if(game.boardIndex < game.boards.length-1) { game.boardIndex++; emitGame(game) } else endRounds(game) }
function endRounds(game) { if(game.final) startFinal(game); else afterFinal(game) }
function afterFinal(game) { clearGameTimers(game); resetClueState(game); game.finalDeadline=null; if(game.fastMoneyClues && startFastMoney(game)) return; finishGame(game) }
function finishGame(game) { clearGameTimers(game); resetClueState(game); game.status='complete'; emitGame(game) }

// ---------- Fast Money ----------
const fastMoneyTarget = (game) => Math.ceil(game.fastMoneyClues.length * game.fm.playerIds.length * 0.8)
function publicFastMoney(game) {
  const fm=game.fm; if(!fm || game.status!=='fastmoney') return null
  const clues=game.fastMoneyClues, reveal=fm.phase==='reveal', current=fm.phase==='playing' && fm.queue.length ? fm.queue[0] : null
  return {
    phase: fm.phase, playerIds: fm.playerIds, activePlayerId: reveal ? null : fm.playerIds[fm.turn], deadline: fm.deadline,
    target: fastMoneyTarget(game), points: FAST_MONEY.points, bonus: FAST_MONEY.bonus, clueCount: clues.length,
    current: current==null ? null : { index: current, category: clues[current].category, question: clues[current].question },
    progress: Object.fromEntries(fm.playerIds.map((id)=>[id, fm.answers[id].map((answer)=>answer.status)])),
    results: reveal ? { clues: clues.map(({ category, question, answer })=>({ category, question, answer })), answers: fm.answers, totalCorrect: fm.totalCorrect, bonusWon: fm.bonusWon, earned: fm.applied } : null,
  }
}
function startFastMoney(game) {
  const contenders=connectedPlayers(game).sort((a,b)=>b.score-a.score).slice(0,2)
  if(!contenders.length) return false
  clearGameTimers(game); resetClueState(game)
  game.status='fastmoney'
  game.fm={ playerIds: contenders.map((player)=>player.id), turn: 0, phase: 'intro', queue: [], answers: {}, applied: {}, deadline: Date.now()+FAST_MONEY.introMs }
  for(const player of contenders) game.fm.answers[player.id]=game.fastMoneyClues.map(()=>({ response: '', correct: false, status: 'pending' }))
  schedule(game,'fm',FAST_MONEY.introMs,()=>beginFastMoneyTurn(game))
  emitGame(game); return true
}
function beginFastMoneyTurn(game) {
  const fm=game.fm; if(!fm || game.status!=='fastmoney') return
  const ms=fm.turn===0 ? FAST_MONEY.firstMs : FAST_MONEY.secondMs
  fm.phase='playing'; fm.queue=game.fastMoneyClues.map((_,index)=>index); fm.deadline=Date.now()+ms
  schedule(game,'fm',ms,()=>endFastMoneyTurn(game)); emitGame(game)
}
function endFastMoneyTurn(game) {
  const fm=game.fm; if(!fm || fm.phase!=='playing') return
  clearTimeout((gameTimers.get(game.code)||{}).fm); fm.queue=[]
  if(fm.turn===0 && fm.playerIds.length>1) { fm.turn=1; fm.phase='between'; fm.deadline=Date.now()+FAST_MONEY.betweenMs; schedule(game,'fm',FAST_MONEY.betweenMs,()=>beginFastMoneyTurn(game)); emitGame(game); return }
  fm.phase='reveal'; fm.deadline=null; scoreFastMoney(game)
  game.lastEvent={ type: fm.bonusWon ? 'correct' : 'reveal', playerId: null, at: Date.now() }
  if(game.hostless) schedule(game,'fmEnd',FAST_MONEY.hostlessRevealMs,()=>finishGame(game))
  emitGame(game)
}
// Applies (or, after a host override, re-applies) Fast Money winnings so each player's score changes by exactly what they earned.
function scoreFastMoney(game) {
  const fm=game.fm
  fm.totalCorrect=fm.playerIds.reduce((total,id)=>total+fm.answers[id].filter((answer)=>answer.correct).length,0)
  fm.bonusWon=fm.totalCorrect>=fastMoneyTarget(game)
  for(const id of fm.playerIds) {
    const earned=fm.answers[id].filter((answer)=>answer.correct).length*FAST_MONEY.points+(fm.bonusWon ? FAST_MONEY.bonus : 0)
    const player=game.players.get(id); if(player) player.score+=earned-(fm.applied[id]||0)
    fm.applied[id]=earned
  }
}
function answerFastMoney(game, playerId, response, pass) {
  const fm=game.fm
  if(!fm || game.status!=='fastmoney' || fm.phase!=='playing' || fm.playerIds[fm.turn]!==playerId || !fm.queue.length) return
  const index=fm.queue[0], entry=fm.answers[playerId][index], text=String(response || '').trim().slice(0,200)
  if(pass || !text) { entry.status='passed'; fm.queue.push(fm.queue.shift()) }
  else { entry.response=text; entry.correct=answersMatch(text,game.fastMoneyClues[index].answer); entry.status='answered'; fm.queue.shift() }
  if(!fm.queue.length) endFastMoneyTurn(game); else emitGame(game)
}
function revealThenReturn(game, eventType='reveal', giveLowestControl=false) { clearGameTimers(game); if(giveLowestControl) assignLowestConnected(game); game.buzzerOpen=false; game.reveal=true; game.answerDeadline=null; game.lastEvent={type:eventType,playerId:game.answeringPlayerId,at:Date.now()}; emitGame(game); schedule(game,'reveal',5000,()=>returnToBoard(game)) }
function timeoutClue(game) { const active=game.activeQuestion; if(active?.dailyDouble) { const player=game.players.get(active.dailyPlayerId); if(player) player.score-=active.dailyWager; revealThenReturn(game,'reveal',true) } else revealThenReturn(game,'reveal',true) }
function revealFinal(game) { clearTimeout((gameTimers.get(game.code)||{}).final); game.finalDeadline=null; if(game.hostless) for(const [playerId,response] of game.finalResponses){ if(response.scored) continue; const player=game.players.get(playerId); if(player){ player.score+=response.correct ? response.wager : -response.wager; response.scored=true } } game.reveal=true; if(game.hostless) schedule(game,'finalEnd',15000,()=>afterFinal(game)); emitGame(game) }
function resumeBuzzersAfterIncorrect(game) { const remaining=game.cluePausedRemaining ?? 45000; game.clueDeadline=Date.now()+remaining; game.cluePausedRemaining=null; game.buzzerOpen=true; game.buzzerOpenedAt=Date.now(); game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; schedule(game,'clue',remaining,()=>timeoutClue(game)) }
function resolveHostlessAnswer(game, playerId, response) { const player=game.players.get(playerId), active=game.activeQuestion; if(!player || !active || game.answeringPlayerId!==playerId) return; clearTimeout((gameTimers.get(game.code)||{}).answer); const value=active.dailyDouble ? active.dailyWager : active.question.value; const correct=answersMatch(response,active.question.answer); game.answeringPlayerId=null; game.answerDeadline=null; game.buzzedPlayer=null; if(correct){ player.score+=value; game.turnPlayerId=playerId; revealThenReturn(game,'correct'); return } player.score-=value; if(!game.incorrectPlayerIds.includes(playerId)) game.incorrectPlayerIds.push(playerId); game.lastEvent={type:'incorrect',playerId,at:Date.now()}; if(active.dailyDouble || game.incorrectPlayerIds.length>=connectedPlayers(game).length) revealThenReturn(game,'reveal',true); else { resumeBuzzersAfterIncorrect(game); if(!checkSkip(game)) emitGame(game) } }
function openAnswerWindow(game, playerId) { game.buzzedPlayer=playerId; game.answeringPlayerId=playerId; game.buzzerOpen=false; game.cluePausedRemaining=game.clueDeadline ? Math.max(0,game.clueDeadline-Date.now()) : game.cluePausedRemaining; game.clueDeadline=null; game.answerDeadline=Date.now()+10000; clearTimeout((gameTimers.get(game.code)||{}).clue); emitGame(game); schedule(game,'answer',10000,()=>{ if(game.hostless) resolveHostlessAnswer(game,playerId,''); else { const p=game.players.get(playerId); if(p&&game.activeQuestion){const penalty=game.activeQuestion.dailyDouble ? game.activeQuestion.dailyWager : game.activeQuestion.question.value; p.score-=penalty; if(!game.incorrectPlayerIds.includes(playerId))game.incorrectPlayerIds.push(playerId); game.lastEvent={type:'incorrect',playerId,at:Date.now()}; game.buzzedPlayer=null;game.answeringPlayerId=null;game.answerDeadline=null; if(game.activeQuestion.dailyDouble) revealThenReturn(game,'reveal',true); else if(game.incorrectPlayerIds.length>=connectedPlayers(game).length)revealThenReturn(game,'reveal',true); else { resumeBuzzersAfterIncorrect(game); emitGame(game) } } } }) }
function openHostlessBuzzers(game) { if(!game.hostless || !game.activeQuestion || game.reveal) return; game.preBuzzDeadline=null; game.buzzerOpen=true; game.buzzerOpenedAt=Date.now(); game.clueDeadline=Date.now()+45000; schedule(game,'clue',45000,()=>timeoutClue(game)); emitGame(game) }
function beginClue(game, categoryIndex, questionIndex) { const q=game.boards[game.boardIndex][categoryIndex]?.questions[questionIndex]; if(game.activeQuestion || !q || q.used) return false; clearGameTimers(game); const dailyPlayer=q.dailyDouble ? (game.players.get(game.turnPlayerId) || connectedPlayers(game)[Math.floor(Math.random()*connectedPlayers(game).length)]) : null; if(dailyPlayer) game.lastEvent={type:'daily',playerId:dailyPlayer.id,at:Date.now()}; game.activeQuestion={categoryIndex,questionIndex,question:clone(q),dailyDouble:!!q.dailyDouble,dailyPlayerId:dailyPlayer?.id||null,dailyWager:null,dailyReady:!q.dailyDouble}; game.preBuzzDeadline=null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpenedAt=null; game.buzzedPlayer=null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId=null; game.incorrectPlayerIds=[]; game.skipVotes=[]; game.buzzerOpen=false; game.reveal=false; if(game.hostless && !q.dailyDouble){ game.preBuzzDeadline=Date.now()+10000; schedule(game,'preBuzz',10000,()=>openHostlessBuzzers(game)) } emitGame(game); return true }
// Hostless skip: everyone still in the running (connected and not already wrong on this clue) must vote before the clue is skipped.
function canSkip(game) { const active=game.activeQuestion; return !!(game.hostless && game.status==='playing' && active && !active.final && !active.dailyDouble && !game.reveal) }
function checkSkip(game) {
  if(!canSkip(game)) return false
  const needed=connectedPlayers(game).filter((player)=>!game.incorrectPlayerIds.includes(player.id))
  if(!needed.length || !needed.every((player)=>game.skipVotes.includes(player.id))) return false
  game.answeringPlayerId=null; game.buzzedPlayer=null
  revealThenReturn(game,'reveal',true); return true
}
// Runs once a disconnected player has stayed away past the grace period: hand off anything the game is waiting on them for.
function playerLeft(game, pid) {
  const player=game.players.get(pid)
  if (!player || player.socketId) return
  const active=game.activeQuestion
  const wasAnswering=game.answeringPlayerId===pid || game.buzzedPlayer===pid
  const wasDailyOwner=active?.dailyDouble && active.dailyPlayerId===pid
  if (wasDailyOwner) {
    const replacement=assignLowestConnected(game)
    if (replacement) { active.dailyPlayerId=replacement.id; active.dailyReady=false; active.dailyWager=null; game.answeringPlayerId=null; game.buzzedPlayer=null; game.buzzerOpen=false; game.clueDeadline=null; game.answerDeadline=null; clearGameTimers(game) }
  } else if (wasAnswering && active) {
    clearTimeout((gameTimers.get(game.code)||{}).answer)
    game.answeringPlayerId=null; game.buzzedPlayer=null; game.answerDeadline=null
    if (connectedPlayers(game).length) resumeBuzzersAfterIncorrect(game)
  } else if (game.turnPlayerId === pid) assignLowestConnected(game)
  if (!checkSkip(game)) emitGame(game)
}
const text = (value, max = 500) => String(value ?? '').trim().slice(0, max)
// Custom boards come from the browser, so keep only well-formed rounds of 1–6 categories with 1–6 clues each.
function cleanConfig(config) {
  const boards=(Array.isArray(config?.boards) ? config.boards : []).slice(0,3).map((board, boardIndex)=>(Array.isArray(board) ? board : []).slice(0,6).map((category, categoryIndex)=>({
    name: text(category?.name, 80) || `Category ${categoryIndex+1}`,
    questions: (Array.isArray(category?.questions) ? category.questions : []).slice(0,6).map((q, i)=>({ id: text(q?.id, 60) || `b${boardIndex}c${categoryIndex}q${i}`, category: text(q?.category || category?.name, 80), question: text(q?.question), answer: text(q?.answer, 200), value: Math.max(0, Math.min(100000, Math.trunc(Number(q?.value)) || (i+1)*(boardIndex+1)*200)) })),
  })).filter((category)=>category.questions.length)).filter((board)=>board.length)
  if(!boards.length) throw new Error('A game needs at least one board with clues.')
  const final=config?.final && text(config.final.question) && text(config.final.answer) ? { ...config.final, category: text(config.final.category, 80), question: text(config.final.question), answer: text(config.final.answer, 200) } : null
  const fastMoneyClues=Array.isArray(config?.fastMoney?.clues) ? config.fastMoney.clues.slice(0,5).map((clue)=>({ category: text(clue?.category, 80), question: text(clue?.question), answer: text(clue?.answer, 200) })).filter((clue)=>clue.question && clue.answer) : []
  const roundNames=boards.map((_, index)=>text(config?.roundNames?.[index], 40) || DEFAULT_ROUND_NAMES[index])
  return { boards, final, fastMoney: fastMoneyClues.length ? { clues: fastMoneyClues } : null, roundNames, hostless: !!config?.hostless }
}
function makeGame(code, rawConfig) {
  const config=cleanConfig(rawConfig)
  // Blank squares on custom boards start out used so they show empty and never need playing.
  const boards = config.boards.map((board) => board.map((category) => ({ ...category, questions: category.questions.map((q) => ({ ...q, used: !q.question || !q.answer, dailyDouble: false })) })))
  boards.forEach((board, index) => {
    const clues=board.flatMap((category, categoryIndex)=>category.questions.map((question,questionIndex)=>({question,categoryIndex,questionIndex}))).filter(({question})=>!question.used)
    const count=Math.min(index===0 ? 1 : 2, Math.max(1, Math.floor(clues.length/10)))
    for(let i=0;i<count&&clues.length;i++){const pick=clues.splice(Math.floor(Math.random()*clues.length),1)[0];pick.question.dailyDouble=true}
  })
  return {
    code, status: 'lobby', hostSocketId: null, hostless: !!config.hostless, players: new Map(),
    config: clone(config),
    boards,
    boardIndex: 0, roundNames: config.roundNames, fastMoneyClues: config.fastMoney?.clues || null, fm: null,
    final: config.final, buzzerOpen: false, buzzerOpenedAt: null, buzzedPlayer: null, buzzedAtMs: null, buzzTimes: {}, buzzInputDeadline: null, activeQuestion: null, reveal: false, finalResponses: new Map(), turnPlayerId: null, answeringPlayerId: null, incorrectPlayerIds: [], skipVotes: [], preBuzzDeadline:null, clueDeadline: null, cluePausedRemaining: null, answerDeadline: null, finalDeadline: null, lastEvent: null
  }
}

io.on('connection', (socket) => {
  socket.on('host:create', (config, ack) => {
    let code; do { code = id() } while (games.has(code))
    let game; try { game = makeGame(code, config) } catch (error) { return ack?.({ ok: false, error: error.message }) }
    game.hostSocketId = socket.id; games.set(code, game)
    socket.join(code); ack?.({ ok: true, code, game: publicGame(game) })
  })
  socket.on('host:join', ({ code, display }, ack) => {
    const game = games.get(code?.toUpperCase()); if (!game) return ack?.({ ok: false, error: 'Game not found' })
    socket.data.controllerGame = game.code; if (display) game.hostSocketId = socket.id
    socket.join(game.code); ack?.({ ok: true, game: publicGame(game) }); emitGame(game)
  })
  socket.on('player:join', ({ code, name, returningPlayerId }, ack) => {
    const game = games.get(code?.toUpperCase()); if (!game) return ack?.({ ok: false, error: 'Game not found' })
    const returning = game.players.get(returningPlayerId)
    if (returning) {
      cancelLeave(game.code, returning.id)
      returning.socketId = socket.id
      socket.join(game.code); socket.data.game = game.code; socket.data.player = returning.id
      ack?.({ ok: true, playerId: returning.id, game: publicGame(game), rejoined: true }); emitGame(game)
      return
    }
    if (!['lobby', 'playing'].includes(game.status)) return ack?.({ ok: false, error: 'This game is no longer accepting new players.' })
    if (game.players.size >= MAX_PLAYERS) return ack?.({ ok: false, error: `This game already has the maximum of ${MAX_PLAYERS} players.` })
    const clean = String(name || '').trim().slice(0, 20); if (!clean) return ack?.({ ok: false, error: 'Enter a name' })
    const player = { id: id(), name: clean, score: 0, socketId: socket.id }
    game.players.set(player.id, player); socket.join(game.code); socket.data.game = game.code; socket.data.player = player.id
    ack?.({ ok: true, playerId: player.id, game: publicGame(game) }); emitGame(game)
  })
  socket.on('host:action', ({ code, action, payload }) => {
    const game = games.get(code); if (!game || (game.hostSocketId !== socket.id && socket.data.controllerGame !== code)) return
    if (action === 'start') { game.status = 'playing'; const players=connectedPlayers(game); game.turnPlayerId=players[Math.floor(Math.random()*players.length)]?.id || null }
    if (action === 'select') {
      beginClue(game, payload.categoryIndex, payload.questionIndex); return
    }
    if (action === 'buzzer') { if(game.activeQuestion && !game.reveal && !game.answeringPlayerId && (!payload.open || !game.activeQuestion.dailyDouble || game.activeQuestion.dailyReady)) { game.buzzerOpen = !!payload.open; if (payload.open) { game.buzzedPlayer = null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.buzzerOpenedAt=Date.now(); const remaining=game.cluePausedRemaining ?? 45000; game.clueDeadline=Date.now()+remaining; game.cluePausedRemaining=null; schedule(game,'clue',remaining,()=>timeoutClue(game)) } } }
    if (action === 'score') {
      const p = game.players.get(payload.playerId); let amount = Number(payload.amount) || 0
      if (game.activeQuestion?.dailyDouble && game.activeQuestion.dailyWager) amount = Math.sign(amount || 1) * game.activeQuestion.dailyWager
      if (p) p.score += amount
      // A correct regular-clue ruling immediately awards control and returns to the board.
      if (p && amount > 0 && game.status === 'playing' && game.activeQuestion && !game.activeQuestion.final) {
        game.turnPlayerId = p.id; revealThenReturn(game,'correct'); return
      } else if (p && amount < 0 && game.status === 'playing' && game.activeQuestion && !game.activeQuestion.final) {
        if (game.activeQuestion.dailyDouble) { revealThenReturn(game,'reveal',true); return }
        if (!game.incorrectPlayerIds.includes(p.id)) game.incorrectPlayerIds.push(p.id)
        clearTimeout((gameTimers.get(game.code)||{}).answer); game.lastEvent={type:'incorrect',playerId:p.id,at:Date.now()}; game.answeringPlayerId=null; game.buzzedPlayer=null; game.answerDeadline=null
        if (game.incorrectPlayerIds.length >= connectedPlayers(game).length) { revealThenReturn(game,'reveal',true); return }
        resumeBuzzersAfterIncorrect(game)
      }
    }
    if (action === 'close' && game.status === 'final') { afterFinal(game); return }
    if (action === 'close' && game.status === 'fastmoney') { finishGame(game); return }
    if (action === 'fmJudge' && game.fm?.phase === 'reveal') { const entry=game.fm.answers[payload.playerId]?.[payload.index]; if(entry) { entry.correct=!!payload.correct; scoreFastMoney(game) } }
    if (action === 'close') {
      clearGameTimers(game)
      if (game.activeQuestion && !game.activeQuestion.final) markUsed(game)
      game.activeQuestion = null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpen = false; game.buzzerOpenedAt=null; game.buzzedPlayer = null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId = null; game.reveal = false
      if (game.status === 'final') game.status = 'complete'
    }
    if (action === 'timeoutClue' && game.activeQuestion && !game.activeQuestion.final) { revealThenReturn(game,'reveal',true); return }
    if (action === 'adjustScore') { const p=game.players.get(payload.playerId), amount=Math.trunc(Number(payload.amount)); if(p && Number.isFinite(amount) && amount) p.score+=amount }
    if (action === 'renamePlayer') { const p=game.players.get(payload.playerId), name=String(payload.name || '').trim().slice(0,20); if(p && name) p.name=name }
    if (action === 'kickPlayer') { const p=game.players.get(payload.playerId); if(p) { cancelLeave(game.code, p.id); const playerSocket=io.sockets.sockets.get(p.socketId); playerSocket?.leave(game.code); playerSocket?.emit('player:kicked'); const wasControlling=game.turnPlayerId===p.id || game.answeringPlayerId===p.id || game.buzzedPlayer===p.id; const dailyOwner=game.activeQuestion?.dailyPlayerId===p.id; game.players.delete(p.id); if(game.fm?.phase==='playing' && game.fm.playerIds[game.fm.turn]===p.id) endFastMoneyTurn(game); const replacement=(wasControlling || dailyOwner) ? assignLowestConnected(game) : null; if(dailyOwner && replacement) { game.activeQuestion.dailyPlayerId=replacement.id; game.activeQuestion.dailyReady=false; game.activeQuestion.dailyWager=null; game.buzzerOpen=false } } }
    if (action === 'final') { endRounds(game); return }
    if (action === 'reveal' && game.status === 'final') { game.reveal = !game.reveal; if(game.reveal) { clearTimeout((gameTimers.get(game.code)||{}).final); game.finalDeadline=null } }
    if (action === 'revealFinalPlayer') { const response = game.finalResponses.get(payload.playerId); if (response) response.revealed = !response.revealed }
    if (action === 'nextBoard') { nextBoard(game); return }
    if (action === 'timeout') { const players=[...game.players.values()]; if(players.length){const low=Math.min(...players.map(p=>p.score)); const choices=players.filter(p=>p.score===low); const next=choices[Math.floor(Math.random()*choices.length)]; game.turnPlayerId=next.id; game.answeringPlayerId=game.activeQuestion?next.id:null; game.buzzerOpen=false; game.buzzedPlayer=null} }
    if (action === 'replay') {
      const reset = makeGame(game.code, { ...game.config, roundNames: game.roundNames, fastMoney: game.fastMoneyClues ? { clues: game.fastMoneyClues } : null })
      reset.hostSocketId = game.hostSocketId
      reset.players = game.players
      for (const player of reset.players.values()) player.score = 0
      games.set(game.code, reset)
      emitGame(reset)
      return
    }
    emitGame(game)
  })
  socket.on('player:buzz', ({ code, playerId }) => {
    const game = games.get(code), player=games.get(code)?.players.get(playerId), active=game?.activeQuestion, daily=active?.dailyDouble
    if (!game || !player?.socketId || game.incorrectPlayerIds.includes(playerId)) return
    const reactionTime=Math.max(0,Date.now()-(game.buzzerOpenedAt||Date.now()))
    if (game.buzzedPlayer) { if(!daily && game.buzzInputDeadline && Date.now()<=game.buzzInputDeadline && game.buzzTimes[playerId] == null) { game.buzzTimes[playerId]=reactionTime; emitGame(game) }; return }
    if (!game.buzzerOpen || (daily && (!active.dailyReady || active.dailyPlayerId!==playerId))) return
    game.buzzedAtMs=daily ? null : reactionTime; game.buzzTimes=daily ? {} : { [playerId]: reactionTime }; game.buzzInputDeadline=daily ? null : Date.now()+2000; game.lastEvent={type:'buzz',playerId,at:Date.now()}; openAnswerWindow(game, playerId)
  })
  socket.on('player:dailyWager', ({ code, playerId, wager }) => {
    const game=games.get(code), active=game?.activeQuestion, player=game?.players.get(playerId)
    if(!game||!active?.dailyDouble||active.dailyPlayerId!==playerId||active.dailyReady||!player)return
    const top=Math.max(0, ...game.boards[game.boardIndex].flatMap((category)=>category.questions.map((question)=>question.value)))
    const max=Math.max(player.score, top, 5); const value=Math.max(5,Math.min(Number(wager)||5,max))
    active.dailyWager=value; active.dailyReady=true; game.answeringPlayerId=null; game.buzzerOpenedAt=null; game.buzzedAtMs=null; game.clueDeadline=null
    if(game.hostless){ game.preBuzzDeadline=Date.now()+10000; schedule(game,'preBuzz',10000,()=>openHostlessBuzzers(game)) }
    emitGame(game)
  })
  socket.on('player:finalSubmit', ({ code, playerId, wager, response }, ack) => {
    const game = games.get(code); const player = game?.players.get(playerId)
    if (!game || !player || player.score < 1 || game.status !== 'final' || game.finalResponses.has(playerId)) return ack?.({ ok: false, error: 'Final response is not available.' })
    const amount = Math.max(0, Math.min(Number(wager) || 0, Math.max(0, player.score)))
    const text = String(response || '').trim().slice(0, 500)
    if (!text) return ack?.({ ok: false, error: 'Enter your response.' })
    game.finalResponses.set(playerId, { wager: amount, response: text, revealed: false, correct: game.hostless ? answersMatch(text,game.final.answer) : undefined, scored:false })
    ack?.({ ok: true }); const eligible=connectedPlayers(game).filter((p)=>p.score>=1); if(eligible.length && eligible.every((p)=>game.finalResponses.has(p.id))) revealFinal(game); else emitGame(game)
  })
  socket.on('player:select', ({ code, playerId, categoryIndex, questionIndex }) => {
    const game=games.get(code); if(!game?.hostless || game.status!=='playing' || game.turnPlayerId!==playerId || !game.players.get(playerId)?.socketId) return
    beginClue(game,categoryIndex,questionIndex)
  })
  socket.on('player:answer', ({ code, playerId, response }) => {
    const game=games.get(code); if(!game?.hostless) return
    resolveHostlessAnswer(game,playerId,String(response || '').slice(0,500))
  })
  socket.on('player:fastMoney', ({ code, playerId, response, pass }) => {
    const game=games.get(code); if(!game || !game.players.get(playerId)?.socketId) return
    answerFastMoney(game, playerId, response, pass)
  })
  socket.on('player:skip', ({ code, playerId }) => {
    const game=games.get(code); if(!game || !canSkip(game) || !game.players.get(playerId)?.socketId) return
    game.skipVotes=game.skipVotes.includes(playerId) ? game.skipVotes.filter((id)=>id!==playerId) : [...game.skipVotes, playerId]
    if(!checkSkip(game)) emitGame(game)
  })
  socket.on('disconnect', () => {
    for (const game of games.values()) {
      if (game.hostSocketId === socket.id) { game.hostSocketId = null; emitGame(game) }
      for (const [pid, player] of game.players) if (player.socketId === socket.id) {
        player.socketId = null
        emitGame(game)
        const key=leaveKey(game.code,pid); clearTimeout(leaveTimers.get(key))
        leaveTimers.set(key, setTimeout(() => { leaveTimers.delete(key); const current=games.get(game.code); if (current) playerLeft(current, pid) }, RECONNECT_GRACE_MS))
      }
    }
  })
})

app.get('/health', (_, res) => res.json({ ok: true, games: games.size }))
const importLog = new Map()
app.get('/import/jeopardylabs', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*')
  const now=Date.now(), recent=(importLog.get(req.ip) || []).filter((at)=>now-at<60000)
  if(recent.length>=10) return res.status(429).json({ ok: false, error: 'Too many imports in a minute. Wait a moment and try again.' })
  importLog.set(req.ip, [...recent, now])
  try { res.json({ ok: true, board: await importJeopardyLabs(req.query.url) }) }
  catch (error) { res.status(400).json({ ok: false, error: error.name === 'TimeoutError' ? 'JeopardyLabs took too long to answer. Try again.' : error.message }) }
})
httpServer.listen(3001, () => console.log('Jeopardy server listening on http://localhost:3001'))
