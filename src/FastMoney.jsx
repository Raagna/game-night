import React, { useState } from "react";
import { ClueTimer, clockText, socket, tone } from "./shared";

const money = (amount) => `$${(amount || 0).toLocaleString()}`;
const nameOf = (game, id) => game.players.find((p) => p.id === id)?.name || "Player";
const CheckIcon = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const CrossIcon = () => <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>;

function Progress({ statuses, current }) {
  return (
    <ol className="fm-progress" aria-label="Clue progress">
      {statuses.map((status, i) => (
        <li key={i} className={`is-${status}${i === current ? " is-current" : ""}`} aria-label={`Clue ${i + 1}: ${status}`} />
      ))}
    </ol>
  );
}

// "2:30" for five clues at 30 seconds each.
const turnTime = (fm) => clockText(Math.round((fm.turnMs || 0) / 1000));
function rules(fm, game) {
  const [first, second] = fm.playerIds, time = turnTime(fm);
  return second
    ? `${nameOf(game, first)} goes first, then ${nameOf(game, second)} plays the same ${fm.clueCount} clues. Each gets ${time} (30 seconds a clue). ${money(fm.points)} per right answer; ${fm.target} right between them wins a ${money(fm.bonus)} bonus each.`
    : `${nameOf(game, first)} plays solo: ${fm.clueCount} clues in ${time}, ${money(fm.points)} per right answer, and a ${money(fm.bonus)} bonus for ${fm.target} right.`;
}

function Results({ game, judge }) {
  const fm = game.fastMoney, { clues, answers, earned, totalCorrect, bonusWon } = fm.results;
  return (
    <>
      <div className="fm-table-wrap">
        <table className="fm-results">
          <thead>
            <tr>
              <th scope="col">Clue</th>
              {fm.playerIds.map((id) => <th scope="col" key={id}>{nameOf(game, id)}</th>)}
            </tr>
          </thead>
          <tbody>
            {clues.map((clue, i) => (
              <tr key={i} style={{ animationDelay: `${i * 450}ms` }}>
                <th scope="row">
                  <small>{clue.category}</small>
                  <span>{clue.question}</span>
                  <b className="fm-answer">{clue.answer}</b>
                </th>
                {fm.playerIds.map((id) => {
                  const answer = answers[id][i];
                  return (
                    <td key={id} className={answer.correct ? "is-right" : "is-wrong"}>
                      <span className="fm-response">{answer.response || (answer.status === "passed" ? "Passed" : "No answer")}</span>
                      {judge ? (
                        <span className="fm-judge" role="group" aria-label={`Ruling for ${nameOf(game, id)}, clue ${i + 1}`}>
                          <button aria-pressed={answer.correct} aria-label="Mark right" onClick={() => judge(id, i, true)}><CheckIcon /></button>
                          <button aria-pressed={!answer.correct} aria-label="Mark wrong" onClick={() => judge(id, i, false)}><CrossIcon /></button>
                        </span>
                      ) : (
                        <span className="fm-mark" aria-label={answer.correct ? "Right" : "Wrong"}>{answer.correct ? <CheckIcon /> : <CrossIcon />}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Won</th>
              {fm.playerIds.map((id) => <td key={id} className="money">{money(earned[id])}</td>)}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={"fm-verdict" + (bonusWon ? " is-win" : "")}>
        {bonusWon ? `${totalCorrect} right — bonus won! ${money(fm.bonus)} each` : `${totalCorrect} right · ${fm.target} needed for the bonus`}
      </p>
    </>
  );
}

export function FastMoneyDisplay({ game, host, onAction }) {
  const fm = game.fastMoney;
  if (!fm) return null;
  const [first, second] = fm.playerIds, active = fm.activePlayerId;
  if (fm.phase === "reveal")
    return (
      <div className="fm">
        <h1 className="fm-title">Fast Money results</h1>
        <Results game={game} />
        {host && <button className="primary fm-finish" onClick={() => onAction("close")}>Final standings</button>}
        {game.hostless && <p className="muted">Final standings appear in a few seconds.</p>}
      </div>
    );
  return (
    <div className="fm">
      <h1 className="fm-title">Fast Money</h1>
      {fm.phase === "intro" && <p className="fm-lede">{rules(fm, game)}</p>}
      {fm.phase === "between" && (
        <>
          <p className="fm-lede"><b>{nameOf(game, active)}</b>, you’re up! {turnTime(fm)} for the same clues.</p>
          <p className="muted">{nameOf(game, first)}’s answers stay hidden until the end.</p>
        </>
      )}
      {fm.phase === "playing" && fm.current && (
        <>
          <p className="fm-player"><b>{nameOf(game, active)}</b> is answering</p>
          <Progress statuses={fm.progress[active]} current={fm.current.index} />
          <p className="clue-meta">{fm.current.category}</p>
          <p className="fm-clue">{fm.current.question}</p>
        </>
      )}
      {second && active === first && fm.phase !== "between" && (
        <p className="fm-warning">{nameOf(game, second)}: look away from the screen until it’s your turn!</p>
      )}
    </div>
  );
}

function AnswerBox({ game, playerId }) {
  const fm = game.fastMoney, [response, setResponse] = useState("");
  const send = (pass) => {
    tone(pass ? 330 : 660, .08, "square", .05);
    socket.emit("player:fastMoney", { code: game.code, playerId, response: pass ? "" : response, pass });
    setResponse("");
  };
  return (
    <form className="final-form fm-answer-form" onSubmit={(e) => { e.preventDefault(); send(!response.trim()); }}>
      <div className="fm-phone-top">
        <Progress statuses={fm.progress[playerId]} current={fm.current.index} />
        <ClueTimer deadline={fm.deadline} serverNow={game.serverNow} />
      </div>
      <p className="player-clue-meta">{fm.current.category}</p>
      <p className="fm-phone-clue">{fm.current.question}</p>
      <input autoFocus aria-label="Your answer" autoComplete="off" autoCapitalize="off" enterKeyHint="send" value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Type your answer" />
      <div className="fm-buttons">
        <button type="button" className="secondary" onClick={() => send(true)}>Pass</button>
        <button className="primary">Answer</button>
      </div>
    </form>
  );
}

export function FastMoneyPlayer({ game, playerId }) {
  const fm = game.fastMoney;
  if (!fm) return null;
  const playing = fm.playerIds.includes(playerId), [first, second] = fm.playerIds, active = fm.activePlayerId;
  if (fm.phase === "reveal") {
    const right = playing ? fm.results.answers[playerId].filter((a) => a.correct).length : 0;
    return (
      <div className="status-card">
        {playing && <p>You got {right} of {fm.clueCount} right: <b>+{money(fm.results.earned[playerId])}</b></p>}
        <p className={fm.results.bonusWon ? "final-correct" : ""}>{fm.results.bonusWon ? `Bonus won — ${fm.results.totalCorrect} right!` : `${fm.results.totalCorrect} right; ${fm.target} needed for the bonus.`}</p>
        <p className="muted">Results are on the main screen.</p>
      </div>
    );
  }
  if (fm.phase === "playing" && active === playerId && fm.current) return <AnswerBox key={`${fm.current.index}-${fm.progress[playerId].join()}`} game={game} playerId={playerId} />;
  let message;
  if (fm.phase === "intro") message = playing ? (playerId === first ? "You’re in Fast Money and you go first. Get ready!" : "You’re in Fast Money and you go second. Don’t look at the screen while the first player answers!") : `Fast Money: ${fm.playerIds.map((id) => nameOf(game, id)).join(" and ")} are playing.`;
  else if (fm.phase === "between") message = active === playerId ? `You’re up! ${turnTime(fm)} on the clock. Get ready…` : `${nameOf(game, active)} is up next.`;
  else message = playerId === second && active === first ? "No peeking! Look away from the screen until it’s your turn." : `${nameOf(game, active)} is playing Fast Money.`;
  return <p className="player-status fm-wait">{message}</p>;
}

export function FastMoneyController({ game, onAction }) {
  const fm = game.fastMoney;
  if (!fm) return null;
  return (
    <>
      <h1>Fast Money</h1>
      {fm.phase === "reveal" ? (
        <>
          <p className="muted">Tap the check or cross to fix any ruling. Scores update right away.</p>
          <Results game={game} judge={(playerId, index, correct) => onAction("fmJudge", { playerId, index, correct })} />
          <button className="wide on" onClick={() => onAction("close")}>Show final standings</button>
        </>
      ) : (
        <>
          <p className="status-note">
            {fm.phase === "intro" ? "Starting in a few seconds…" : fm.phase === "between" ? `${nameOf(game, fm.activePlayerId)} is up next.` : `${nameOf(game, fm.activePlayerId)} is answering.`}
          </p>
          {fm.playerIds.map((id) => (
            <div className="judgement" key={id}>
              <h2>{nameOf(game, id)}</h2>
              <Progress statuses={fm.progress[id]} current={fm.phase === "playing" && fm.activePlayerId === id ? fm.current?.index : -1} />
            </div>
          ))}
          <p className="muted">Answers and rulings appear here when everyone has finished.</p>
          <button className="skip-controller" onClick={() => onAction("close")}>End Fast Money and show final standings</button>
        </>
      )}
    </>
  );
}
