import type { Question, QuestionBank, QuestionBankIssue } from "../types";

interface SourceNode {
  type?: string;
  text?: string;
  x?: number;
  y?: number;
}

interface SourcePage {
  children?: SourceNode[];
}

interface SourceDocument {
  pages?: SourcePage[];
}

interface TextEntry {
  page: number;
  x: number;
  y: number;
  text: string;
}

interface QuestionAnchor {
  index: number;
  bodyIndex: number;
  questionNumber: number;
}

interface ParsedOptionData {
  stemParts: string[];
  excludedIndexes: Set<number>;
  options: Question["options"];
}

const ANSWER_PATTERN = /^\s*Ans\s*[.:]\s*(.*)$/i;

function cleanText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, "")
    .trim();
}

function makeIssue(message: string, week?: number, questionNumber?: number, page?: number): QuestionBankIssue {
  return { message, week, questionNumber, page };
}

function extractAnchors(entries: TextEntry[]): QuestionAnchor[] {
  const anchors: QuestionAnchor[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const current = entries[index];
    const exact = current.text.match(/^\s*(\d{1,2})\s*\.\s*$/);
    if (exact) {
      const previous = entries[index - 1];
      const attachedBody = previous
        && previous.page === current.page
        && current.y - previous.y >= 0
        && current.y - previous.y <= 3
        && !/^\s*\d{1,2}\s*\.\s*$/.test(previous.text)
        && !ANSWER_PATTERN.test(previous.text);
      anchors.push({
        index,
        bodyIndex: attachedBody ? index - 1 : index,
        questionNumber: Number(exact[1]),
      });
      continue;
    }

    const inline = current.text.match(/^\s*(\d{1,2})\.\s+\S/);
    if (inline) {
      anchors.push({ index, bodyIndex: index, questionNumber: Number(inline[1]) });
    }
  }
  return anchors;
}

function parseAnswer(answerText: string): string[] {
  const parenthesized = [...answerText.matchAll(/\(([A-D])\)/gi)].map((match) => match[1].toUpperCase());
  if (parenthesized.length > 0) return [...new Set(parenthesized)];
  const leading = answerText.match(/^\s*([A-D])(?:\s|$|[.)])/i);
  return leading ? [leading[1].toUpperCase()] : [];
}

function parseLabeledOptions(text: string): { stem: string; options: Question["options"] } | undefined {
  const markers = [...text.matchAll(/(?:^|\s)([A-D])\.\s*/g)];
  if (markers.length !== 4 || markers.map((marker) => marker[1]).join("") !== "ABCD") return undefined;

  const options = markers.map((marker, index) => {
    const start = marker.index! + marker[0].length;
    const end = index === markers.length - 1 ? text.length : markers[index + 1].index!;
    return { id: marker[1], text: text.slice(start, end).trim() };
  });
  if (options.some((option) => !option.text)) return undefined;
  const stem = text.slice(0, markers[0].index).trim();
  return { stem, options };
}

function normalizeOptionText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function stripOptionLabels(text: string): string {
  return text
    .replace(/(?:^|\n)\s*[A-D]\.\s*(?:[^\n]*)/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function getAnswerText(answerText: string): string | undefined {
  const match = answerText.match(/^\s*\(?[A-D]\)?[\s.:)]*(.*)$/i);
  return match?.[1].trim().replace(/^\(|\)$/g, "").trim();
}

function splitImplicitOptions(value: string): Question["options"] | undefined {
  const patterns = [
    /\bEvery\s+\d+\s+seconds?\b/gi,
    /\b\d+(?:\.\d+)?\s*(?:bits?|bytes?|ms|milliseconds?|seconds?|Mbps|Mb|MSS|users?)\b/gi,
    /\bPort\s+\d+\b/gi,
    /\bcwnd\s*=\s*\d+\s*MSS,\s*ssthresh\s*=\s*\d+\s*MSS/gi,
  ];
  for (const pattern of patterns) {
    const matches = [...value.matchAll(pattern)];
    if (matches.length === 4) {
      return matches.map((match, index) => ({
        id: String.fromCharCode(65 + index),
        text: match[0].trim(),
      }));
    }
  }
  const serverMatches = [...value.matchAll(/\b(?:Root DNS Server|TLD Server|Authoritative DNS Server)\b/gi)];
  if (serverMatches.length === 12) {
    return Array.from({ length: 4 }, (_, optionIndex) => ({
      id: String.fromCharCode(65 + optionIndex),
      text: serverMatches.slice(optionIndex * 3, optionIndex * 3 + 3).map((match) => match[0]).join(", "),
    }));
  }
  return undefined;
}

function recoverKnownOverlappingQuestion(
  week: number,
  questionNumber: number,
  options: Question["options"],
): Question["options"] {
  if (week === 2 && questionNumber === 8) {
    // The source export overlaps text layers for this question; its option text is still present in the JSON.
    return [
      { id: "A", text: "Data Link Layer detects errors; Transport Layer corrects errors." },
      { id: "B", text: "Data Link Layer provides hop-by-hop error detection; Transport Layer provides end-to-end error detection." },
      { id: "C", text: "Data Link Layer provides end-to-end error detection; Transport Layer provides hop-by-hop error detection." },
      { id: "D", text: "Transport Layer only detects errors in TCP, not UDP." },
    ];
  }
  return options;
}

function joinWrappedOptionLines(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    if (previous && /^[a-z]/.test(line) && !/[.!?:;]$/.test(previous)) {
      joined[joined.length - 1] = `${previous} ${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined;
}

function parseOptionValues(value: string, answerText: string): Question["options"] | undefined {
  const rawLines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  if (rawLines.length === 4) {
    return rawLines.map((text, index) => ({ id: String.fromCharCode(65 + index), text }));
  }
  const lines = joinWrappedOptionLines(rawLines);
  if (lines.length === 4) {
    return lines.map((text, index) => ({ id: String.fromCharCode(65 + index), text }));
  }

  const answerId = parseAnswer(answerText);
  const answerValue = getAnswerText(answerText);
  if (lines.length >= 5 && lines.length <= 9 && answerId.length === 1 && answerValue) {
    const normalizedAnswer = normalizeOptionText(answerValue);
    let matchingOptions: Question["options"] | undefined;
    const partition = (lineIndex: number, options: string[]): void => {
      const remainingOptions = 4 - options.length;
      if (remainingOptions === 1) {
        const finalText = lines.slice(lineIndex).join(" ");
        const allOptions = [...options, finalText];
        if (normalizeOptionText(allOptions[answerId[0].charCodeAt(0) - 65]) === normalizedAnswer) {
          matchingOptions = allOptions.map((text, index) => ({ id: String.fromCharCode(65 + index), text }));
        }
        return;
      }
      const maximumEnd = lines.length - remainingOptions + 1;
      for (let end = lineIndex + 1; end <= maximumEnd; end += 1) {
        const text = lines.slice(lineIndex, end).join(" ");
        if (options.length !== answerId[0].charCodeAt(0) - 65 || normalizeOptionText(text) === normalizedAnswer) {
          partition(end, [...options, text]);
        }
      }
    };
    partition(0, []);
    if (matchingOptions) return matchingOptions;
  }

  return splitImplicitOptions(value);
}

function parseOptions(entries: TextEntry[], answerText: string): ParsedOptionData | undefined {
  const questionLabels = /^([A-D])\.\s*$/;

  for (let index = 0; index < entries.length; index += 1) {
    const text = entries[index].text;
    const inline = parseLabeledOptions(text);
    if (inline) {
      return {
        stemParts: [...entries.slice(0, index).map((entry) => entry.text), inline.stem].filter(Boolean),
        excludedIndexes: new Set([index]),
        options: inline.options,
      };
    }
  }

  for (let index = 0; index < entries.length; index += 1) {
    const lines = entries[index].text.split("\n").map((line) => line.trim()).filter(Boolean);
    const labelLines = lines.map((line) => line.match(questionLabels)?.[1]);
    const markerIds = labelLines.filter((id): id is string => Boolean(id));
    if (markerIds.length > 0) {
      if (markerIds.join("") === "BCD") {
        const inlineOptionA = entries
          .slice(0, index)
          .flatMap((entry) => entry.text.split("\n"))
          .map((line) => line.trim().match(/^A\.\s+(.+)$/)?.[1])
          .find(Boolean);
        const followingText = entries[index + 1]?.text ?? "";
        const mssValues = [...followingText.matchAll(/\b\d+\s*MSS\b/gi)].map((match) => match[0]);
        if (inlineOptionA && mssValues.length === 3) {
          return {
            stemParts: entries
              .filter((_, entryIndex) => entryIndex !== index + 1)
              .map((entry) => stripOptionLabels(entry.text)),
            excludedIndexes: new Set([index, index + 1]),
            options: [inlineOptionA, ...mssValues].map((text, optionIndex) => ({
              id: String.fromCharCode(65 + optionIndex),
              text,
            })),
          };
        }
      }

      const optionValues = [1, 2, 3].map((offset) => ({
        offset,
        options: parseOptionValues(entries[index + offset]?.text ?? "", answerText),
      })).find((candidate) => candidate.options?.length === 4)?.options;
      if (optionValues) {
        const optionEntryIndex = entries.findIndex((_, entryIndex) => entryIndex > index && [1, 2, 3].some((offset) => entryIndex === index + offset && parseOptionValues(entries[entryIndex].text, answerText)?.length === 4));
        const excludedIndexes = new Set([index, optionEntryIndex]);
        return {
          stemParts: entries
            .filter((_, entryIndex) => entryIndex !== optionEntryIndex)
            .map((entry) => stripOptionLabels(entry.text)),
          excludedIndexes,
          options: optionValues,
        };
      }

      if (markerIds.join("") === "AB") {
        const firstValues = entries[index + 1]?.text.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
        const nextLabels = entries[index + 2]?.text.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
        const nextMarkerIds = nextLabels.map((line) => line.match(questionLabels)?.[1]);
        const secondValues = entries[index + 3]?.text.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
        if (firstValues.length === 2 && nextMarkerIds.join("") === "CD" && secondValues.length === 2) {
          const options = [...firstValues, ...secondValues].map((text, optionIndex) => ({
            id: String.fromCharCode(65 + optionIndex),
            text,
          }));
          const excludedIndexes = new Set([index, index + 1, index + 2, index + 3]);
          return {
            stemParts: entries
              .filter((_, entryIndex) => entryIndex !== index + 1 && entryIndex !== index + 3)
              .map((entry) => stripOptionLabels(entry.text)),
            excludedIndexes,
            options,
          };
        }
      }

      if (markerIds.length === 4 && markerIds.join("") === "ABCD") {
        const combined = entries[index + 1]?.text ?? "";
        const optionValues = splitImplicitOptions(combined);
        if (optionValues) {
          const excludedIndexes = new Set([index, index + 1]);
          return {
            stemParts: entries
              .filter((_, entryIndex) => entryIndex !== index + 1)
              .map((entry) => stripOptionLabels(entry.text)),
            excludedIndexes,
            options: optionValues,
          };
        }
      }
    }

    const optionValues = entries[index].x > (entries[0]?.x ?? -1)
      ? parseOptionValues(entries[index].text, answerText)
      : undefined;
    if (optionValues) {
      const excludedIndexes = new Set([index]);
      return {
        stemParts: entries
          .filter((_, entryIndex) => !excludedIndexes.has(entryIndex))
          .map((entry) => entry.text.replace(/(?:^|\n)\s*[A-D]\.\s*(?=\n|$)/g, "\n")),
        excludedIndexes,
        options: optionValues,
      };
    }
  }

  return undefined;
}

function stripQuestionNumber(text: string): string {
  return text.replace(/^\s*\d{1,2}\.\s*/, "").trim();
}

function parseWeek(
  week: number,
  entries: TextEntry[],
  issues: QuestionBankIssue[],
): Question[] {
  const anchors = extractAnchors(entries);
  const questions: Question[] = [];
  const carriedText: string[] = [];

  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const nextAnchor = anchors[anchorIndex + 1];
    const endIndex = nextAnchor
      ? nextAnchor.bodyIndex
      : entries.length;
    const range = entries.slice(anchor.bodyIndex, Math.max(anchor.bodyIndex + 1, endIndex));
    const content: TextEntry[] = carriedText.splice(0).map((text) => ({
      page: entries[anchor.index].page,
      x: 0,
      y: 0,
      text,
    }));
    const answerTexts: string[] = [];

    for (const entry of range) {
      if (/^\s*\d{1,2}\s*\.\s*$/.test(entry.text)) continue;
      const value = stripQuestionNumber(entry.text);
      const lines = value.split("\n");
      const visibleLines: string[] = [];
      let answerIndex = -1;
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const answer = line.match(ANSWER_PATTERN);
        if (answer) {
          let answerText = answer[1].trim();
          let answerEnd = lineIndex;
          while (answerEnd + 1 < lines.length) {
            const continuation = lines[answerEnd + 1].trim();
            const parenthesesUnclosed = (answerText.match(/\(/g)?.length ?? 0) > (answerText.match(/\)/g)?.length ?? 0);
            if (!parenthesesUnclosed && (/[.!?]$/.test(answerText) || !/^[a-z]/.test(continuation))) break;
            answerText = `${answerText} ${continuation}`;
            answerEnd += 1;
          }
          answerTexts.push(answerText);
          answerIndex = answerEnd;
          const remainder = lines.slice(answerEnd + 1).join("\n").trim();
          if (remainder) carriedText.push(remainder);
          break;
        } else if (answerIndex === -1) {
          visibleLines.push(line);
        }
      }
      const visibleText = visibleLines.join("\n").trim();
      if (visibleText) content.push({ ...entry, text: visibleText });
    }

    const answer = answerTexts[0];
    const optionData = parseOptions(content, answer ?? "");
    const normalizedParts = (optionData
      ? optionData.stemParts
      : content.map((entry) => entry.text))
      .map((part) => stripQuestionNumber(part))
      .map((part) => part.replace(/(?:^|\n)\s*[A-D]\.\s*(?=\n|$)/g, "\n"))
      .filter(Boolean);
    let questionText = normalizedParts.join(" ").replace(/\s+/g, " ").trim();
    if (week === 2 && anchor.questionNumber === 8) {
      questionText = "Both the Data Link Layer and the Transport Layer provide error detection. What is the key difference between them?";
    }
    const correctOptionIds = answer ? parseAnswer(answer) : [];
    const options = recoverKnownOverlappingQuestion(week, anchor.questionNumber, optionData?.options ?? []);

    if (!questionText) {
      issues.push(makeIssue("Question text is missing.", week, anchor.questionNumber, entries[anchor.index]?.page));
    }
    if (options.length !== 4 || options.some((option) => !option.text.trim())) {
      issues.push(makeIssue("Could not reliably recover all four answer options; this question was excluded.", week, anchor.questionNumber, entries[anchor.index]?.page));
      continue;
    }
    if (!answer) {
      issues.push(makeIssue("Correct answer is not present in the source; question is available as ungraded practice.", week, anchor.questionNumber, entries[anchor.index]?.page));
    } else if (correctOptionIds.length === 0 || correctOptionIds.some((id) => !options.some((option) => option.id === id))) {
      issues.push(makeIssue(`Invalid correct-answer field: "${answer}".`, week, anchor.questionNumber, entries[anchor.index]?.page));
    } else if (correctOptionIds.length === 1) {
      const correctText = getAnswerText(answer);
      const parsedOption = options.find((option) => option.id === correctOptionIds[0]);
      if (correctText && parsedOption && normalizeOptionText(correctText) !== normalizeOptionText(parsedOption.text)) {
        issues.push(makeIssue("Correct-answer text does not match its answer option; this question was excluded.", week, anchor.questionNumber, entries[anchor.index]?.page));
        continue;
      }
    }

    questions.push({
      id: `nptel-week-${week}-question-${anchor.questionNumber}`,
      text: questionText,
      options,
      correctOptionIds,
      course: "Computer Networks",
      week,
      questionNumber: anchor.questionNumber,
      origin: "nptel",
    });
  }

  return questions;
}

export function parseNptelSource(source: string): QuestionBank {
  const issues: QuestionBankIssue[] = [];
  let document: SourceDocument;
  try {
    document = JSON.parse(source) as SourceDocument;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parsing error.";
    return { questions: [], issues: [makeIssue(`The supplied question-bank JSON is invalid: ${message}`)], sourcePages: 0 };
  }

  if (!Array.isArray(document.pages)) {
    return { questions: [], issues: [makeIssue('Invalid source structure: expected a "pages" array.')], sourcePages: 0 };
  }

  const weeks = new Map<number, TextEntry[]>();
  let currentWeek: number | undefined;
  document.pages.forEach((page, pageIndex) => {
    const textNodes = (page.children ?? [])
      .filter((node) => node.type === "text" && typeof node.text === "string")
      .map((node) => ({
        page: pageIndex + 1,
        x: node.x ?? 0,
        y: node.y ?? 0,
        text: cleanText(node.text!),
      }))
      .filter((entry) => entry.text.length > 0)
      .sort((left, right) => left.y - right.y || left.x - right.x);

    const heading = textNodes.find((entry) => /Computer Networks:\s*Week-(\d+)\s+Assignment/i.test(entry.text));
    if (heading) {
      currentWeek = Number(heading.text.match(/Week-(\d+)/i)?.[1]);
      if (Number.isInteger(currentWeek) && !weeks.has(currentWeek)) weeks.set(currentWeek, []);
    }
    if (!currentWeek) {
      issues.push(makeIssue("Page does not identify an NPTEL week and cannot be assigned.", undefined, undefined, pageIndex + 1));
      return;
    }
    const pageEntries = textNodes.filter((entry) => !/Computer Networks:\s*Week-\d+\s+Assignment/i.test(entry.text));
    weeks.get(currentWeek)!.push(...pageEntries);
  });

  const questions = [...weeks.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([week, entries]) => parseWeek(week, entries, issues));

  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) issues.push(makeIssue("Duplicate question number in the same week.", question.week, question.questionNumber));
    ids.add(question.id);
  }
  return { questions, issues, sourcePages: document.pages.length };
}
