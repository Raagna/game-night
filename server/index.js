import express from 'express'
import { createServer } from 'node:http'
import { Server } from 'socket.io'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })
const games = new Map()
const gameTimers = new Map()
const MAX_PLAYERS = 6

const id = () => Math.random().toString(36).slice(2, 8).toUpperCase()
const clone = (x) => JSON.parse(JSON.stringify(x))
// Lowercases, strips accents, a leading "what is"/"who's" and leading articles (a/an/the), then drops spaces and punctuation.
const normalizeAnswer = (value) => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[’'`]/g,"'").trim()
  .replace(/^(what|who|where|when|why|how)('s|\s+(is|are|was|were))\s+/,'')
  .replace(/^(a|an|the)\s+/,'')
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
    code: game.code, status: game.status, hostless: !!game.hostless, board, boardIndex: game.boardIndex, final: game.hostless && !game.reveal ? { ...game.final, answer: undefined } : game.final,
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
function returnToBoard(game) { clearGameTimers(game); markUsed(game); game.activeQuestion=null; game.preBuzzDeadline=null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpen=false; game.buzzerOpenedAt=null; game.buzzedPlayer=null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId=null; game.reveal=false; game.incorrectPlayerIds=[]; game.skipVotes=[]; const boardDone=game.boards[game.boardIndex]?.every((category)=>category.questions.every((question)=>question.used)); if(game.hostless && boardDone){ if(game.boardIndex===0) game.boardIndex=1; else return startFinal(game) } emitGame(game) }
function revealThenReturn(game, eventType='reveal', giveLowestControl=false) { clearGameTimers(game); if(giveLowestControl) assignLowestConnected(game); game.buzzerOpen=false; game.reveal=true; game.answerDeadline=null; game.lastEvent={type:eventType,playerId:game.answeringPlayerId,at:Date.now()}; emitGame(game); schedule(game,'reveal',5000,()=>returnToBoard(game)) }
function timeoutClue(game) { const active=game.activeQuestion; if(active?.dailyDouble) { const player=game.players.get(active.dailyPlayerId); if(player) player.score-=active.dailyWager; revealThenReturn(game,'reveal',true) } else revealThenReturn(game,'reveal',true) }
function revealFinal(game) { clearTimeout((gameTimers.get(game.code)||{}).final); game.finalDeadline=null; if(game.hostless) for(const [playerId,response] of game.finalResponses){ if(response.scored) continue; const player=game.players.get(playerId); if(player){ player.score+=response.correct ? response.wager : -response.wager; response.scored=true } } game.reveal=true; emitGame(game) }
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
function makeGame(code, config) {
  const boards = config.boards.map((board) => board.map((category) => ({ ...category, questions: category.questions.map((q, i) => ({ ...q, value: q.value || (i + 1) * 200, used: false, dailyDouble: false })) })))
  boards.forEach((board, index) => {
    const clues=board.flatMap((category, categoryIndex)=>category.questions.map((question,questionIndex)=>({question,categoryIndex,questionIndex})))
    for(let i=0;i<(index===0?1:2)&&clues.length;i++){const pick=clues.splice(Math.floor(Math.random()*clues.length),1)[0];pick.question.dailyDouble=true}
  })
  return {
    code, status: 'lobby', hostSocketId: null, hostless: !!config.hostless, players: new Map(),
    config: clone(config),
    boards,
    boardIndex: 0,
    final: config.final, buzzerOpen: false, buzzerOpenedAt: null, buzzedPlayer: null, buzzedAtMs: null, buzzTimes: {}, buzzInputDeadline: null, activeQuestion: null, reveal: false, finalResponses: new Map(), turnPlayerId: null, answeringPlayerId: null, incorrectPlayerIds: [], skipVotes: [], preBuzzDeadline:null, clueDeadline: null, cluePausedRemaining: null, answerDeadline: null, finalDeadline: null, lastEvent: null
  }
}

io.on('connection', (socket) => {
  socket.on('host:create', (config, ack) => {
    let code; do { code = id() } while (games.has(code))
    const game = makeGame(code, config); game.hostSocketId = socket.id; games.set(code, game)
    socket.join(code); ack?.({ ok: true, code, game: publicGame(game) })
  })
  socket.on('host:join', ({ code }, ack) => {
    const game = games.get(code?.toUpperCase()); if (!game) return ack?.({ ok: false, error: 'Game not found' })
    socket.data.controllerGame = game.code; socket.join(game.code); ack?.({ ok: true, game: publicGame(game) }); emitGame(game)
  })
  socket.on('player:join', ({ code, name, returningPlayerId }, ack) => {
    const game = games.get(code?.toUpperCase()); if (!game) return ack?.({ ok: false, error: 'Game not found' })
    const returning = game.players.get(returningPlayerId)
    if (returning) {
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
    if (action === 'close') {
      clearGameTimers(game)
      if (game.activeQuestion && !game.activeQuestion.final) markUsed(game)
      game.activeQuestion = null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpen = false; game.buzzerOpenedAt=null; game.buzzedPlayer = null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId = null; game.reveal = false
      if (game.status === 'final') game.status = 'complete'
    }
    if (action === 'timeoutClue' && game.activeQuestion && !game.activeQuestion.final) { revealThenReturn(game,'reveal',true); return }
    if (action === 'adjustScore') { const p=game.players.get(payload.playerId), amount=Math.trunc(Number(payload.amount)); if(p && Number.isFinite(amount) && amount) p.score+=amount }
    if (action === 'renamePlayer') { const p=game.players.get(payload.playerId), name=String(payload.name || '').trim().slice(0,20); if(p && name) p.name=name }
    if (action === 'kickPlayer') { const p=game.players.get(payload.playerId); if(p) { const playerSocket=io.sockets.sockets.get(p.socketId); playerSocket?.leave(game.code); playerSocket?.emit('player:kicked'); const wasControlling=game.turnPlayerId===p.id || game.answeringPlayerId===p.id || game.buzzedPlayer===p.id; const dailyOwner=game.activeQuestion?.dailyPlayerId===p.id; game.players.delete(p.id); const replacement=(wasControlling || dailyOwner) ? assignLowestConnected(game) : null; if(dailyOwner && replacement) { game.activeQuestion.dailyPlayerId=replacement.id; game.activeQuestion.dailyReady=false; game.activeQuestion.dailyWager=null; game.buzzerOpen=false } } }
    if (action === 'final') { startFinal(game) }
    if (action === 'reveal' && game.status === 'final') { game.reveal = !game.reveal; if(game.reveal) { clearTimeout((gameTimers.get(game.code)||{}).final); game.finalDeadline=null } }
    if (action === 'revealFinalPlayer') { const response = game.finalResponses.get(payload.playerId); if (response) response.revealed = !response.revealed }
    if (action === 'nextBoard') { clearGameTimers(game); game.boardIndex = 1; game.activeQuestion = null; game.clueDeadline=null; game.cluePausedRemaining=null; game.answerDeadline=null; game.buzzerOpen = false; game.buzzerOpenedAt=null; game.buzzedPlayer = null; game.buzzedAtMs=null; game.buzzTimes={}; game.buzzInputDeadline=null; game.answeringPlayerId=null; game.reveal = false }
    if (action === 'timeout') { const players=[...game.players.values()]; if(players.length){const low=Math.min(...players.map(p=>p.score)); const choices=players.filter(p=>p.score===low); const next=choices[Math.floor(Math.random()*choices.length)]; game.turnPlayerId=next.id; game.answeringPlayerId=game.activeQuestion?next.id:null; game.buzzerOpen=false; game.buzzedPlayer=null} }
    if (action === 'replay') {
      const reset = makeGame(game.code, game.config)
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
    const max=Math.max(player.score, game.boardIndex===0?1000:2000, 5); const value=Math.max(5,Math.min(Number(wager)||5,max))
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
    }
  })
})

app.get('/health', (_, res) => res.json({ ok: true, games: games.size }))
httpServer.listen(3001, () => console.log('Jeopardy server listening on http://localhost:3001'))
