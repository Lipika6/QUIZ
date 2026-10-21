import type { QuizResult } from "../types";

const RESULTS_KEY = "nptel-quiz-practice-results";

export function loadResults(): QuizResult[] {
  try {
    const stored = localStorage.getItem(RESULTS_KEY);
    if (!stored) return [];
    const results: unknown = JSON.parse(stored);
    if (!Array.isArray(results)) throw new Error("Saved quiz history has an invalid format.");
    return results as QuizResult[];
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Saved quiz history could not be read. Clear this site's browser storage to start a fresh history.");
    }
    throw error;
  }
}

export function saveResult(result: QuizResult): QuizResult[] {
  const updated = [result, ...loadResults()].slice(0, 50);
  try {
    localStorage.setItem(RESULTS_KEY, JSON.stringify(updated));
  } catch (error) {
    throw new Error(error instanceof Error ? `Could not save quiz history: ${error.message}` : "Could not save quiz history.");
  }
  return updated;
}
