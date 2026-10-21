import sourceUrl from "../../ilovepdf_merged (1).json?url";
import { parseNptelSource } from "../lib/nptelSource";

export async function loadNptelQuestionBank() {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Could not load the question bank source (${response.status}).`);
  return parseNptelSource(await response.text());
}
