import type { Question } from "../types";

export function shuffleQuestions<T>(questions: T[]): T[] {
  const shuffled = [...questions];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function shuffleQuestionOptions(question: Question): Question {
  const shuffledOptions = shuffleQuestions(question.options);
  const optionIdMap = new Map(
    shuffledOptions.map((option, index) => [option.id, String.fromCharCode(65 + index)]),
  );

  return {
    ...question,
    options: shuffledOptions.map((option, index) => ({
      ...option,
      id: String.fromCharCode(65 + index),
    })),
    correctOptionIds: question.correctOptionIds.map((id) => optionIdMap.get(id) ?? id),
  };
}
