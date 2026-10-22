import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { additionalQuestions } from "./data/additionalQuestions";
import { loadNptelQuestionBank } from "./data/nptelQuestionBank";
import { loadResults, saveResult } from "./lib/resultsStorage";
import { shuffleQuestionOptions, shuffleQuestions } from "./lib/quiz";
import type { Question, QuestionBank, QuestionBankIssue, QuestionOutcome, QuizResult } from "./types";

type Screen = "home" | "quiz" | "results" | "review";
type ReviewFilter = "all" | "incorrect";

interface QuizSession {
  questions: Question[];
  index: number;
  outcomes: Record<string, QuestionOutcome>;
  selectedOptionIds: string[];
  submitted: boolean;
  startedAt: number;
  title: string;
  origin: Question["origin"];
  autoAdvanceQuestionId?: string;
}

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [quiz, setQuiz] = useState<QuizSession | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("all");
  const [history, setHistory] = useState<QuizResult[]>([]);
  const [questionBank, setQuestionBank] = useState<QuestionBank>({ questions: [], issues: [], sourcePages: 0 });
  const [practiceCount, setPracticeCount] = useState("10");
  const [loadingBank, setLoadingBank] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [notice, setNotice] = useState("");
  const finished = useRef(false);

  useEffect(() => {
    loadNptelQuestionBank()
      .then(setQuestionBank)
      .catch((error: unknown) => setStorageError(error instanceof Error ? error.message : "Could not load the NPTEL question bank."))
      .finally(() => setLoadingBank(false));
    try {
      setHistory(loadResults());
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Could not load saved quiz results.");
    }
  }, []);

  const nptelQuestions = useMemo(
    () => questionBank.questions.filter((question) => question.origin === "nptel"),
    [questionBank],
  );
  const additionalByTopic = useMemo(() => {
    const topics = new Map<string, Question[]>();
    for (const question of additionalQuestions) {
      const topic = question.topic ?? "General practice";
      topics.set(topic, [...(topics.get(topic) ?? []), question]);
    }
    return [...topics.entries()];
  }, []);

  const startQuiz = (questions: Question[], title: string, origin: Question["origin"]) => {
    const unique = [...new Map(questions.map((question) => [question.id, question])).values()]
      .map(shuffleQuestionOptions);
    if (unique.length === 0) {
      setNotice("There are no questions available in this section yet.");
      return;
    }
    finished.current = false;
    setResult(null);
    setQuiz({
      questions: shuffleQuestions(unique),
      index: 0,
      outcomes: {},
      selectedOptionIds: [],
      submitted: false,
      startedAt: Date.now(),
      title,
      origin,
    });
    setNotice("");
    setScreen("quiz");
  };

  const finishQuiz = useCallback((session: QuizSession) => {
    if (finished.current) return;
    finished.current = true;
    const outcomes = session.questions.map((question) => session.outcomes[question.id] ?? {
      question,
      selectedOptionIds: [],
      correct: false,
      skipped: true,
      graded: false,
    });
    const finishedAt = Date.now();
    const completed: QuizResult = {
      id: globalThis.crypto?.randomUUID?.() ?? `${finishedAt}-${Math.random().toString(36).slice(2)}`,
      title: session.title,
      origin: session.origin,
      startedAt: session.startedAt,
      finishedAt,
      durationMs: finishedAt - session.startedAt,
      outcomes,
    };
    try {
      setHistory(saveResult(completed));
      setResult(completed);
      setQuiz(null);
      setScreen("results");
    } catch (error) {
      finished.current = false;
      setStorageError(error instanceof Error ? error.message : "Could not save this quiz result.");
    }
  }, []);

  const advance = useCallback((session: QuizSession) => {
    const question = session.questions[session.index];
    const outcomes = { ...session.outcomes };
    if (!outcomes[question.id]) {
      outcomes[question.id] = {
        question,
        selectedOptionIds: [],
        correct: false,
        skipped: true,
        graded: false,
      };
    }
    const nextSession = { ...session, outcomes };
    if (session.index === session.questions.length - 1) {
      finishQuiz(nextSession);
      return;
    }
    const nextIndex = session.index + 1;
    const previousOutcome = outcomes[session.questions[nextIndex].id];
    setQuiz({
      ...nextSession,
      index: nextIndex,
      selectedOptionIds: previousOutcome?.selectedOptionIds ?? [],
      submitted: Boolean(previousOutcome),
      autoAdvanceQuestionId: undefined,
    });
  }, [finishQuiz]);

  const currentQuestion = quiz?.questions[quiz.index];
  const currentOutcome = currentQuestion && quiz ? quiz.outcomes[currentQuestion.id] : undefined;

  useEffect(() => {
    if (!quiz || !currentQuestion || !currentOutcome?.correct || quiz.autoAdvanceQuestionId !== currentQuestion.id) return;
    const timer = window.setTimeout(() => advance(quiz), 950);
    return () => window.clearTimeout(timer);
  }, [advance, currentOutcome, currentQuestion, quiz]);

  const toggleOption = (optionId: string) => {
    setQuiz((current) => {
      if (!current || current.submitted) return current;
      const question = current.questions[current.index];
      const isMultiple = question.correctOptionIds.length > 1;
      const selected = isMultiple
        ? current.selectedOptionIds.includes(optionId)
          ? current.selectedOptionIds.filter((id) => id !== optionId)
          : [...current.selectedOptionIds, optionId]
        : [optionId];
      return { ...current, selectedOptionIds: selected };
    });
  };

  const submitAnswer = () => {
    if (!quiz || !currentQuestion || quiz.submitted || quiz.selectedOptionIds.length === 0) return;
    const correctOptionIds = [...currentQuestion.correctOptionIds].sort();
    const selectedOptionIds = [...quiz.selectedOptionIds].sort();
    const graded = correctOptionIds.length > 0;
    const outcome: QuestionOutcome = {
      question: currentQuestion,
      selectedOptionIds: quiz.selectedOptionIds,
      correct: graded
        && correctOptionIds.length === selectedOptionIds.length
        && correctOptionIds.every((id, index) => id === selectedOptionIds[index]),
      skipped: false,
      graded,
    };
    setQuiz({
      ...quiz,
      submitted: true,
      outcomes: { ...quiz.outcomes, [currentQuestion.id]: outcome },
      autoAdvanceQuestionId: outcome.correct ? currentQuestion.id : undefined,
    });
  };

  const selectQuestion = (index: number) => {
    if (!quiz || index < 0 || index >= quiz.questions.length) return;
    const existing = quiz.outcomes[quiz.questions[index].id];
    setQuiz({
      ...quiz,
      index,
      selectedOptionIds: existing?.selectedOptionIds ?? [],
      submitted: Boolean(existing),
      autoAdvanceQuestionId: undefined,
    });
  };

  const shuffleRemaining = () => {
    setQuiz((current) => {
      if (!current) return current;
      const before = current.questions.slice(0, current.index + 1);
      const after = current.questions.slice(current.index + 1);
      const unanswered = after.filter((question) => !current.outcomes[question.id]);
      const alreadyAnswered = after.filter((question) => Boolean(current.outcomes[question.id]));
      return { ...current, questions: [...before, ...shuffleQuestions(unanswered), ...alreadyAnswered] };
    });
  };

  const openReview = (selectedResult: QuizResult, filter: ReviewFilter) => {
    setResult(selectedResult);
    setReviewFilter(filter);
    setScreen("review");
  };

  const stats = result ? getStats(result) : null;

  if (loadingBank) {
    return <main className="loading">Loading the Computer Networks question bank…</main>;
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={() => { setQuiz(null); setScreen("home"); }} aria-label="Go to home">
          <span className="brand-mark">N</span>
          <span>NPTEL Quiz Practice</span>
        </button>
        {history[0] && screen === "home" && (
          <button className="text-button latest-result" onClick={() => { setResult(history[0]); setScreen("results"); }}>
            Latest result <span aria-hidden="true">→</span>
          </button>
        )}
      </header>

      {(storageError || notice) && (
        <div className={`notice${storageError ? " error" : ""}`} role={storageError ? "alert" : "status"}>
          {storageError || notice}
          <button aria-label="Dismiss message" onClick={() => { setNotice(""); setStorageError(""); }}>×</button>
        </div>
      )}

      <main className="main-content">
        {screen === "home" && (
          <>
            <section className="welcome">
              <span className="eyebrow">COMPUTER NETWORKS</span>
              <h1>Practice at your own pace.</h1>
              <p>Choose a question set, work through shuffled questions, and learn from each answer.</p>
            </section>

            <section className="section-block" aria-labelledby="nptel-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">ORIGINAL COURSE QUESTIONS</span>
                  <h2 id="nptel-heading">NPTEL Question Bank</h2>
                </div>
                <span className="question-count">{nptelQuestions.length} questions</span>
              </div>
              <article className="section-card nptel-card">
                <div>
                  <p className="card-description">Computer Networks · Weekly assignments</p>
                  <p className="card-detail">Choose a question count for a randomized practice set. Each session contains no repeats.</p>
                </div>
                <div className="practice-count-control">
                  <label htmlFor="practice-count">Questions to practise</label>
                  <div className="practice-count-row">
                    <input
                      id="practice-count"
                      type="number"
                      min={1}
                      max={nptelQuestions.length}
                      value={practiceCount}
                      disabled={nptelQuestions.length === 0}
                      onChange={(event) => setPracticeCount(event.target.value)}
                    />
                    <span>of {nptelQuestions.length}</span>
                    <button
                      className="button primary"
                      disabled={nptelQuestions.length === 0}
                      onClick={() => {
                        const count = Number(practiceCount);
                        if (!Number.isInteger(count) || count < 1 || count > nptelQuestions.length) {
                          setNotice(`Enter a whole number from 1 to ${nptelQuestions.length}.`);
                          return;
                        }
                        startQuiz(shuffleQuestions(nptelQuestions).slice(0, count), `${count} NPTEL questions`, "nptel");
                      }}
                    >Start practice →</button>
                  </div>
                </div>
              </article>
              <article className="section-card full-bank-card">
                <div>
                  <span className="eyebrow">FULL PRACTICE SET</span>
                  <p className="card-description">All NPTEL questions together</p>
                  <p className="card-detail">Practise the complete question bank in a new random order.</p>
                </div>
                <button className="button secondary" disabled={nptelQuestions.length === 0} onClick={() => startQuiz(nptelQuestions, "All NPTEL questions", "nptel")}>
                  Practise all {nptelQuestions.length} →
                </button>
              </article>
              {questionBank.issues.length > 0 && <QuestionBankReport issues={questionBank.issues} />}
            </section>

            <section className="section-block" aria-labelledby="additional-heading">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">EXTRA STUDY</span>
                  <h2 id="additional-heading">Additional Subject Practice</h2>
                </div>
                <span className="question-count">{additionalQuestions.length} questions</span>
              </div>
              <p className="section-intro">
                Original practice for Computer Networks, the subject taught by Professor Neminath Hubballi at IIT Indore.
                These questions are not verified official NPTEL questions.
              </p>
              <div className="topic-grid">
                {additionalByTopic.map(([topic, topicQuestions]) => (
                  <article className="topic-card" key={topic}>
                    <div className="topic-info">
                      <span className="badge">ADDITIONAL PRACTICE · NOT OFFICIAL</span>
                      <h3>{topic}</h3>
                      <p>{topicQuestions.length} {topicQuestions.length === 1 ? "question" : "questions"} · {topicQuestions[0].difficulty}</p>
                    </div>
                    <button className="button secondary" onClick={() => startQuiz(topicQuestions, `Additional practice · ${topic}`, "additional")}>
                      Practise topic <span aria-hidden="true">→</span>
                    </button>
                  </article>
                ))}
              </div>
            </section>

            {history[0] && (
              <section className="recent-result">
                <div>
                  <span className="eyebrow">YOUR LAST SESSION</span>
                  <p><strong>{history[0].title}</strong> · {new Date(history[0].finishedAt).toLocaleDateString()}</p>
                </div>
                <button className="text-button" onClick={() => { setResult(history[0]); setScreen("results"); }}>View saved result →</button>
              </section>
            )}
          </>
        )}

        {screen === "quiz" && quiz && currentQuestion && (
          <section className="quiz-page">
            <div className="quiz-toolbar">
              <button className="text-button" onClick={() => {
                if (window.confirm("Exit this practice session? Its result will not be saved.")) {
                  setQuiz(null);
                  setScreen("home");
                }
              }}>← Exit</button>
              <span className="quiz-title">{quiz.title}</span>
            </div>
            <div className="progress-info">
              <span>Question {quiz.index + 1} of {quiz.questions.length}</span>
              <span>{currentQuestion.origin === "nptel"
                ? "NPTEL Question Bank"
                : `${currentQuestion.topic ?? "Additional practice"} · ${currentQuestion.difficulty ?? "Practice"}`}</span>
            </div>
            <div className="progress-track" aria-label={`Question ${quiz.index + 1} of ${quiz.questions.length}`}>
              <span style={{ width: `${((quiz.index + 1) / quiz.questions.length) * 100}%` }} />
            </div>
            <article className="question-card">
              <div className="question-label-row">
                <span className={`badge${currentQuestion.origin === "additional" ? " badge-extra" : ""}`}>
                  {currentQuestion.origin === "nptel" ? "NPTEL QUESTION" : "ADDITIONAL PRACTICE · NOT OFFICIAL"}
                </span>
                {currentQuestion.correctOptionIds.length > 1 && <span className="muted">Select all that apply</span>}
              </div>
              <h1>{currentQuestion.text}</h1>
              <div className="answer-list">
                {currentQuestion.options.map((option) => {
                  const selected = quiz.selectedOptionIds.includes(option.id);
                  const correct = quiz.submitted && currentQuestion.correctOptionIds.includes(option.id);
                  const incorrect = quiz.submitted && selected && !correct;
                  return (
                    <button
                      className={`answer-option${selected ? " selected" : ""}${correct ? " correct" : ""}${incorrect ? " incorrect" : ""}`}
                      key={option.id}
                      disabled={quiz.submitted}
                      onClick={() => toggleOption(option.id)}
                    >
                      <span className="option-letter">{option.id}</span>
                      <span>{option.text}</span>
                      {correct && <span className="answer-mark">{selected ? "Correct" : "Answer"}</span>}
                      {incorrect && <span className="answer-mark">Your answer</span>}
                    </button>
                  );
                })}
              </div>
              {quiz.submitted && (
                <div className={`feedback${currentOutcome?.correct ? " correct-feedback" : currentOutcome?.graded ? " incorrect-feedback" : ""}`}>
                  <strong>{currentOutcome?.correct ? "Correct!" : currentOutcome?.graded ? "Incorrect." : "Answer recorded."}</strong>
                  {!currentOutcome?.graded
                    ? <p>No correct answer was provided in the source. This question is not included in the graded score.</p>
                    : !currentOutcome.correct && <p>Correct answer: {currentQuestion.correctOptionIds.join(", ")}.</p>}
                  {currentQuestion.explanation && <p>{currentQuestion.explanation}</p>}
                  {quiz.submitted && currentQuestion.origin === "nptel" && (
                    <p className="source-reference">Source: Week {currentQuestion.week}{currentQuestion.questionNumber ? ` · Question ${currentQuestion.questionNumber}` : ""}</p>
                  )}
                  {currentOutcome?.correct && <span className="muted">Moving to the next question…</span>}
                </div>
              )}
              <div className="quiz-actions">
                {!quiz.submitted && <button className="button primary" disabled={quiz.selectedOptionIds.length === 0} onClick={submitAnswer}>Submit answer</button>}
                {quiz.submitted && !currentOutcome?.correct && (
                  <button className="button primary" onClick={() => advance(quiz)}>
                    {quiz.index === quiz.questions.length - 1 ? "Finish quiz" : "Next question"}
                  </button>
                )}
                {!quiz.submitted && <button className="button secondary" onClick={() => advance(quiz)}>
                  {quiz.index === quiz.questions.length - 1 ? "Finish quiz" : "Skip question"}
                </button>}
                <button
                  className="button secondary"
                  disabled={!quiz.questions.slice(quiz.index + 1).some((question) => !quiz.outcomes[question.id])}
                  onClick={shuffleRemaining}
                >Shuffle remaining</button>
              </div>
              <div className="question-navigation">
  <button
    className="text-button"
    disabled={quiz.index === 0}
    onClick={() => selectQuestion(quiz.index - 1)}
  >
    ← Previous question
  </button>

  <span>{Object.keys(quiz.outcomes).length} answered or skipped</span>

  <button
    className="text-button"
    disabled={quiz.index === quiz.questions.length - 1}
    onClick={() => selectQuestion(quiz.index + 1)}
  >
    Next question →
  </button>
</div>
            </article>
          </section>
        )}

        {screen === "results" && result && stats && (
          <section className="results-page">
            <button className="text-button back-button" onClick={() => { setQuiz(null); setScreen("home"); }}>← Home</button>
            <span className="eyebrow">PRACTICE COMPLETE</span>
            <h1>Session results</h1>
            <p className="page-lead">{result.title} · {new Date(result.finishedAt).toLocaleString()}</p>
            <div className="score-card">
              <span className="eyebrow">FINAL SCORE · CORRECT / TOTAL QUESTIONS</span>
              <strong>{stats.score}%</strong>
              <p>{stats.correct} correct out of {stats.total} questions</p>
            </div>
            <div className="stats-grid">
              <Stat label="Total questions" value={stats.total} />
              <Stat label="Correct" value={stats.correct} tone="good" />
              <Stat label="Incorrect" value={stats.incorrect} tone="bad" />
              <Stat label="Skipped" value={stats.skipped} />
            </div>
            <p className="calculation-note">Percentage is calculated as correct answers divided by all questions, including skipped questions. A question without a source answer key is not graded as correct or incorrect.</p>
            <div className="result-actions">
              <button className="button primary" onClick={() => openReview(result, "all")}>Review answers</button>
              <button className="button secondary" onClick={() => openReview(result, "incorrect")}>Review incorrect answers</button>
              <button className="button secondary" disabled={!result.outcomes.some((outcome) => outcome.skipped || (outcome.graded && !outcome.correct))} onClick={() => {
                const missed = result.outcomes.filter((outcome) => outcome.skipped || (outcome.graded && !outcome.correct)).map((outcome) => outcome.question);
                startQuiz(missed, "Practise missed questions", result.origin);
              }}>Practise mistakes again</button>
              <button className="button secondary" onClick={() => startQuiz(result.outcomes.map((outcome) => outcome.question), result.title, result.origin)}>Try again shuffled</button>
            </div>
          </section>
        )}

        {screen === "review" && result && (
          <section className="review-page">
            <button className="text-button back-button" onClick={() => setScreen("results")}>← Results</button>
            <span className="eyebrow">ANSWER REVIEW</span>
            <h1>{reviewFilter === "all" ? "Review answers" : "Incorrect answers"}</h1>
            <div className="review-list">
              {result.outcomes
                .filter((outcome) => reviewFilter === "all" || (outcome.graded && !outcome.correct))
                .map((outcome, index) => (
                  <article className="review-card" key={`${outcome.question.id}-${index}`}>
                    <div className="review-meta">
                      <span className={`badge${outcome.correct ? " badge-good" : outcome.skipped ? "" : " badge-bad"}`}>
                        {outcome.correct ? "CORRECT" : outcome.skipped ? "SKIPPED" : outcome.graded ? "INCORRECT" : "NOT GRADED"}
                      </span>
                      <span className="muted">{outcome.question.origin === "nptel"
                        ? `Week ${outcome.question.week} · Question ${outcome.question.questionNumber ?? "—"}`
                        : `Additional practice · ${outcome.question.topic ?? ""}`}</span>
                    </div>
                    <h3>{outcome.question.text}</h3>
                    <p><strong>Your answer:</strong> {optionLabels(outcome.question, outcome.selectedOptionIds)}</p>
                    <p><strong>Correct answer:</strong> {optionLabels(outcome.question, outcome.question.correctOptionIds)}</p>
                    {outcome.question.explanation && <p><strong>Explanation:</strong> {outcome.question.explanation}</p>}
                  </article>
                ))}
              {reviewFilter === "incorrect" && !result.outcomes.some((outcome) => outcome.graded && !outcome.correct) && (
                <div className="empty-state"><h3>No incorrect answers</h3><p>This quiz has no graded incorrect answers.</p></div>
              )}
            </div>
          </section>
        )}
      </main>

      <footer className="site-footer">
        <span>Made for steady practice.</span>
        <span>Quiz results are saved in this browser.</span>
      </footer>
    </div>
  );
}

function QuestionBankReport({ issues }: { issues: QuestionBankIssue[] }) {
  return (
    <details className={`bank-report${issues.length ? " has-issues" : ""}`}>
      <summary>{issues.length} question-bank validation note{issues.length === 1 ? "" : "s"}</summary>
      <ul>
        {issues.map((issue, index) => (
          <li key={`${issue.week}-${issue.questionNumber}-${index}`}>
            {[issue.week && `Week ${issue.week}`, issue.questionNumber && `Question ${issue.questionNumber}`, issue.page && `source page ${issue.page}`].filter(Boolean).join(" · ")}
            {issue.week || issue.questionNumber || issue.page ? ": " : ""}{issue.message}
          </li>
        ))}
      </ul>
    </details>
  );
}

function getStats(result: QuizResult) {
  const correct = result.outcomes.filter((outcome) => outcome.correct).length;
  const incorrect = result.outcomes.filter((outcome) => outcome.graded && !outcome.correct && !outcome.skipped).length;
  const skipped = result.outcomes.filter((outcome) => outcome.skipped).length;
  const total = result.outcomes.length;
  return { correct, incorrect, skipped, total, score: total ? Math.round((correct / total) * 100) : 0 };
}

function optionLabels(question: Question, ids: string[]) {
  if (ids.length === 0) return "No answer";
  return ids.map((id) => {
    const option = question.options.find((item) => item.id === id);
    return option ? `${id}. ${option.text}` : id;
  }).join("; ");
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return <div className={`stat-card${tone ? ` ${tone}` : ""}`}><span>{label}</span><strong>{value}</strong></div>;
}

export default App;
