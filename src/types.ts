export interface AnswerOption {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  text: string;
  options: AnswerOption[];
  correctOptionIds: string[];
  explanation?: string;
  course: string;
  week: number;
  questionNumber?: number;
  topic?: string;
  difficulty?: string;
  origin: "nptel" | "additional";
}

export interface QuestionOutcome {
  question: Question;
  selectedOptionIds: string[];
  correct: boolean;
  skipped: boolean;
  graded: boolean;
}

export interface QuizResult {
  id: string;
  title: string;
  origin: Question["origin"];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  outcomes: QuestionOutcome[];
}

export interface QuestionBankIssue {
  page?: number;
  week?: number;
  questionNumber?: number;
  message: string;
}

export interface QuestionBank {
  questions: Question[];
  issues: QuestionBankIssue[];
  sourcePages: number;
}
