import { groqChatJson } from "./groqAIClient";

const MODEL = "openai/gpt-oss-120b";
const MAX_ENTRY_CHARS = 120_000;

export interface ReflectionResponseInput {
  question: string;
  answer: string;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const content = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function cleanEntry(title: string, content: string): string {
  const cleanTitle = title.trim() || "Untitled";
  const cleanContent = content.trim();

  if (!cleanContent) {
    throw new Error("The journal entry has no written content");
  }
  if (cleanContent.length > MAX_ENTRY_CHARS) {
    throw new Error("The journal entry is too long to reflect on in one request");
  }

  return `Entry title: ${cleanTitle}\n\nJournal entry:\n${cleanContent}`;
}

function validatedQuestions(parsed: Record<string, unknown>): string[] {
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 4) {
    throw new Error("The AI response did not contain exactly four questions");
  }

  const questions = parsed.questions.map((value) => String(value).trim());
  const normalized = new Set(questions.map((question) => question.toLowerCase()));
  const questionsAreUsable = questions.every(
    (question) =>
      question.length >= 15 &&
      question.length <= 320 &&
      question.endsWith("?"),
  );

  if (!questionsAreUsable || normalized.size !== 4) {
    throw new Error("The AI response contained incomplete or repeated questions");
  }

  return questions;
}

export async function generateJournalReflectionQuestions(input: {
  entryTitle: string;
  entryContent: string;
}): Promise<string[]> {
  const entry = cleanEntry(input.entryTitle, input.entryContent);
  const systemPrompt = `You generate reflection questions for Lunixia from one private journal entry.

Return exactly four distinct questions that help the user revisit this specific entry from their present perspective. The user, not the AI, decides what the experience means.

NON-NEGOTIABLE GROUNDING RULES:
- Every question must be anchored to a concrete event, feeling, circumstance, choice, observation, relationship, priority, or tension explicitly present in the supplied entry.
- Never invent a person, event, motive, feeling, cause, consequence, history, or relationship.
- Do not connect separate subjects unless the writer explicitly connects them.
- Do not imply that an ordinary detail has hidden significance.
- Do not diagnose, psychoanalyze, criticize, shame, judge, coach, prescribe action, or tell the user what they should conclude.
- Do not state an interpretation inside a question as though it were true.
- If a possible interpretation is uncertain, ask neutrally whether the user's view has changed instead of asserting a change.

QUESTION QUALITY RULES:
- Make all four questions open-ended, specific, and meaningfully different from one another.
- At least two questions must name a concrete detail or subject from the entry in language the user would recognize.
- Prefer useful angles such as what feels different now, what remained unresolved, whether a stated priority changed, how a past decision looks today, or what the user would clarify to their past self.
- Do not ask generic prompts that could fit an unrelated entry.
- Do not ask "How did that make you feel?", "What does this mean to you?", "What did you learn?", or "Is there anything else?"
- Do not recap the entry before asking the questions.
- Keep each question to one direct sentence.

Return only valid JSON in this exact shape:
{"questions":["Question one?","Question two?","Question three?","Question four?"]}`;
  const userPrompt = `Create exactly four grounded reflection questions for this entry. Check every premise against the supplied writing before returning the JSON.\n\n${entry}`;

  const raw = await groqChatJson(systemPrompt, userPrompt, {
    stage: "journal-reflection-questions",
    model: MODEL,
    temperature: 0.05,
    maxTokens: 1_100,
  });
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    throw new Error("Failed to parse the reflection questions response");
  }

  return validatedQuestions(parsed);
}

function validatedPerspective(parsed: Record<string, unknown>): string {
  const perspective = String(parsed.perspective || "").trim();
  if (!perspective || perspective.length > 900) {
    throw new Error("The AI response did not contain one concise perspective");
  }
  if (/^(?:[-*]|\d+[.)])\s/m.test(perspective)) {
    throw new Error("The AI response did not contain a single perspective");
  }
  return perspective;
}

export async function generateJournalReflectionPerspective(input: {
  entryTitle: string;
  entryContent: string;
  responses: ReflectionResponseInput[];
}): Promise<string> {
  const entry = cleanEntry(input.entryTitle, input.entryContent);
  if (input.responses.length !== 4) {
    throw new Error("Exactly four reflection questions are required");
  }

  const responses = input.responses.map((response, index) => ({
    question: String(response.question || "").trim(),
    answer: String(response.answer || "").trim(),
    index,
  }));
  if (responses.some((response) => !response.question)) {
    throw new Error("Each reflection question is required");
  }
  if (responses.some((response) => response.question.length > 500)) {
    throw new Error("A reflection question is too long");
  }
  if (responses.some((response) => response.answer.length > 40_000)) {
    throw new Error("A reflection answer is too long for one perspective request");
  }
  if (
    responses.reduce(
      (total, response) => total + response.question.length + response.answer.length,
      0,
    ) > 120_000
  ) {
    throw new Error("The reflection is too long for one perspective request");
  }
  if (!responses.some((response) => response.answer)) {
    throw new Error("Answer at least one question before requesting a perspective");
  }

  const responseText = responses
    .map(
      ({ question, answer }, index) =>
        `Question ${index + 1}: ${question}\nAnswer ${index + 1}: ${answer || "[Unanswered]"}`,
    )
    .join("\n\n");
  const systemPrompt = `You provide one optional AI Perspective for a Lunixia journal reflection.

The user's own interpretation is authoritative. Your job is to offer one concise observation that the user may consider, based only on the original entry and their current answers.

NON-NEGOTIABLE RULES:
- Identify one specific difference, continuity, stated change, recurring theme, shift in priority, or connection that is directly supported by the writing.
- Use both the original entry and the current answers. Do not merely summarize either one.
- Never invent facts, context, motives, emotions, relationships, causes, progress, growth, or hidden meaning.
- Never turn a plausible interpretation into a fact. Use "may," "might," or "could" when the evidence is incomplete.
- Do not diagnose, psychoanalyze, judge, praise, reassure, advise, coach, prescribe action, or tell the user what to think.
- Do not overstate significance or make ordinary details dramatic.
- Do not treat an unanswered question as evidence.
- Do not mention that you are an AI and do not add a disclaimer.

USEFULNESS RULES:
- Give one observation that adds a concrete comparison or distinction the user did not already state verbatim.
- Omit generic commentary that could fit another person's reflection.
- Do not recap events, list topics, repeat the answers, or close with a summary.
- Write one short paragraph of one to three direct sentences, no heading, no bullets, and no question.

Return only valid JSON in this exact shape:
{"perspective":"One concise, grounded perspective."}`;
  const userPrompt = `Offer one grounded perspective using only the material below. Silently verify every claim against the entry or an answer before returning the JSON.

${entry}

Reflection questions and current answers:
${responseText}`;

  const raw = await groqChatJson(systemPrompt, userPrompt, {
    stage: "journal-reflection-perspective",
    model: MODEL,
    temperature: 0.05,
    maxTokens: 700,
  });
  const parsed = parseJsonObject(raw);
  if (!parsed) {
    throw new Error("Failed to parse the reflection perspective response");
  }

  return validatedPerspective(parsed);
}

