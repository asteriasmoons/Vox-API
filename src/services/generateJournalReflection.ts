import { groqChatJson } from "./groqAIClient";

const MODEL = "openai/gpt-oss-120b";
const MAX_ENTRY_CHARS = 120_000;

export interface ReflectionResponseInput {
  question: string;
  answer: string;
}

interface ReflectionTimingInput {
  entryDate: string;
  reflectionDate: string;
  timeZone: string;
}

type ReflectionTimingKind = "same-day" | "very-recent" | "older";

interface ReflectionTimingContext {
  kind: ReflectionTimingKind;
  prompt: string;
}

function validTimeZone(value: string): string {
  const candidate = value.trim() || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "UTC";
  }
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formattedDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function elapsedDescription(elapsedMinutes: number): string {
  if (elapsedMinutes < 1) return "less than one minute";
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"}`;
  }

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 48) {
    return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"}`;
  }

  const elapsedDays = Math.round(elapsedMinutes / (60 * 24));
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"}`;
}

function timingContext(input: ReflectionTimingInput): ReflectionTimingContext {
  const entryDate = new Date(input.entryDate);
  const reflectionDate = new Date(input.reflectionDate);
  const datesAreValid =
    Number.isFinite(entryDate.getTime()) && Number.isFinite(reflectionDate.getTime());

  if (!datesAreValid || reflectionDate.getTime() < entryDate.getTime()) {
    throw new Error("Valid entry and reflection dates are required");
  }

  const timeZone = validTimeZone(input.timeZone);
  const elapsedMinutes = Math.max(
    0,
    Math.round((reflectionDate.getTime() - entryDate.getTime()) / 60_000),
  );
  const sameLocalDay = localDateKey(entryDate, timeZone) === localDateKey(reflectionDate, timeZone);
  const kind: ReflectionTimingKind = sameLocalDay
    ? "same-day"
    : elapsedMinutes < 60 * 48
      ? "very-recent"
      : "older";
  const timingInstruction = kind === "same-day"
    ? `This is a SAME-DAY reflection. Treat the entry as current. Do not ask about the writer's past self, what has changed since writing, whether an answer shifted, what remains unchanged, or how the experience looks "now" compared with "then."`
    : kind === "very-recent"
      ? `This reflection is VERY RECENT. Do not manufacture hindsight or assume that feelings, circumstances, or understanding have changed.`
      : `This is an OLDER, HISTORICAL entry. Every question must clearly distinguish what the writer described at entry-time from the writer's life at reflection-time. Never phrase an entry-time feeling, circumstance, desire, difficulty, or event as though it is happening today. A question may invite comparison with the present, but it must never assume that anything changed or stayed the same. Unchanged feelings, uncertainty, and unanswered questions are valid.`;

  return {
    kind,
    prompt: `Entry written: ${formattedDate(entryDate, timeZone)}
Reflection started: ${formattedDate(reflectionDate, timeZone)}
Elapsed time: ${elapsedDescription(elapsedMinutes)} (${elapsedMinutes} minutes)
${timingInstruction}`,
  };
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

function validatedQuestions(
  parsed: Record<string, unknown>,
  timingKind: ReflectionTimingKind,
): string[] {
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 4) {
    throw new Error("The AI response did not contain exactly four questions");
  }

  const questions = parsed.questions.map((value) => String(value).trim());
  const normalized = new Set(questions.map((question) => question.toLowerCase()));
  const compoundQuestion = /\b(?:and|or)\s+(?:how|what|why|when|where|who|which|has|have|do|does|did|is|are|would|could|can)\b/i;
  const abstractQuestionLanguage = [
    /\bfrom your present perspective\b/i,
    /\bhas your answer shifted\b/i,
    /\bwhat would you (?:now )?ask your past self\b/i,
    /\bwhat does this reveal\b/i,
    /\bto what extent\b/i,
  ];
  const falseHindsight = [
    /\bpast self\b/i,
    /\blook(?:ing)? back\b/i,
    /\bsince (?:you )?(?:wrote|writing|recorded)\b/i,
    /\bwhat has changed\b/i,
    /\bhas (?:your|the|this|that|anything)[^?]{0,80}\b(?:changed|shifted|evolved)\b/i,
    /\bcompared (?:with|to) (?:then|when you wrote)\b/i,
  ];
  const olderEntryAnchor = [
    /\bwhen you (?:wrote|recorded) (?:this|the entry)\b/i,
    /\bwhen (?:this|the) entry was written\b/i,
    /\bin (?:this|the) entry\b/i,
    /\bat the time (?:you wrote|of (?:this|the) entry)\b/i,
    /\bat that time\b/i,
    /\bback then\b/i,
    /\blook(?:ing)? back (?:at|on)\b/i,
    /\bsince you (?:wrote|recorded) (?:this|the entry)\b/i,
    /\byou wrote (?:that|about)\b/i,
    /\byou (?:described|mentioned|recorded)\b/i,
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i,
  ];
  const olderEntryTreatedAsCurrent = [
    /\bright now\b/i,
    /\bcurrently\b/i,
    /\bat (?:this|the) moment\b/i,
    /\bwhat (?:is|are) (?:making|keeping|stopping|preventing)\b/i,
    /\bwhat makes\b/i,
    /\bwhat keeps you\b/i,
    /\bwhat is stopping you\b/i,
  ];
  const temporalOutcome = /\b(?:changed|different|shifted|evolved|same|unchanged|still)\b/i;
  const outcomeUncertainty = /\b(?:if anything|if at all|whether|or not)\b/i;
  const questionsAreUsable = questions.every(
    (question) =>
      question.length >= 15 &&
      question.length <= 240 &&
      question.split(/\s+/).length <= 32 &&
      (question.match(/\?/g) || []).length === 1 &&
      question.endsWith("?") &&
      !compoundQuestion.test(question) &&
      !abstractQuestionLanguage.some((pattern) => pattern.test(question)) &&
      (
        timingKind === "older" ||
        !falseHindsight.some((pattern) => pattern.test(question))
      ) &&
      (
        timingKind !== "older" ||
        (
          olderEntryAnchor.some((pattern) => pattern.test(question)) &&
          !olderEntryTreatedAsCurrent.some((pattern) => pattern.test(question)) &&
          (!temporalOutcome.test(question) || outcomeUncertainty.test(question))
        )
      ),
  );

  if (!questionsAreUsable || normalized.size !== 4) {
    throw new Error("The AI response contained incomplete or repeated questions");
  }

  return questions;
}

export async function generateJournalReflectionQuestions(input: {
  entryTitle: string;
  entryContent: string;
  entryDate: string;
  reflectionDate: string;
  timeZone: string;
}): Promise<string[]> {
  const entry = cleanEntry(input.entryTitle, input.entryContent);
  const timing = timingContext(input);
  const systemPrompt = `You generate reflection questions for Lunixia from one private journal entry.

Return exactly four clear, conversational questions that help the user explore this specific entry. The user, not the AI, decides what the experience means.

TIMING RULES:
- The request includes the exact entry date, reflection date, elapsed time, and a timing classification. Treat that timing as fact.
- For a same-day reflection, ask about what is happening, wanted, difficult, uncertain, or important right now. Never pretend the user has months of hindsight.
- For an older reflection, treat the entry as a historical record rather than a description of today. Every question must explicitly anchor the old material with wording such as "when you wrote this entry," "in this entry," "looking back at," or "you described."
- For an older reflection, never ask what is happening "right now" or "currently" based on the entry. Never carry an old feeling, circumstance, desire, difficulty, or event into the present tense.
- A question about the present must clearly separate today from entry-time, such as "How do you view that wish today?" It must not presume that the old situation continues.
- For an older reflection, comparison with the present is allowed only as an open possibility. If asking about change or continuity, use uncertainty such as "if anything," "if at all," or "whether." Never assume that feelings, circumstances, answers, or priorities changed or stayed the same.
- Unchanged feelings, uncertainty, and not knowing are valid outcomes. A reflection does not need to prove growth, change, resolution, or a lesson.

NON-NEGOTIABLE GROUNDING RULES:
- Every question must be anchored to a concrete event, feeling, circumstance, choice, observation, relationship, priority, or tension explicitly present in the supplied entry.
- Never invent a person, event, motive, feeling, cause, consequence, history, or relationship.
- First identify the entry's independent subjects. Keep them separate unless the writer explicitly connects them.
- The appearance of two subjects in the same entry is not evidence that they influence one another.
- Do not imply that an ordinary detail has hidden significance.
- Do not diagnose, psychoanalyze, criticize, shame, judge, coach, prescribe action, or tell the user what they should conclude.
- Do not state an interpretation inside a question as though it were true.
- Do not assume the user changed their mind, feels differently, understands more, or has made progress.

QUESTION SET RULES:
- Silently decide what distinct contribution each question makes before writing them.
- Make all four questions open-ended, specific, and meaningfully different. Do not write four variations of whether the user's perspective changed.
- Collectively explore different meaningful aspects of the entry, such as a present difficulty, a feeling, a desire, a decision, a circumstance, or an unanswered question, but only when that aspect actually appears in the entry.
- If the entry has several unrelated subjects, a question may explore one subject without forcing it into another.
- If the entry centers on one subject, explore different parts of that subject rather than repeating the same premise.
- At least two questions must name a concrete detail or subject from the entry in language the user would recognize.
- Each question must ask one clear thing. Do not combine two questions with "and," add a second clause asking something else, or require the user to decode an abstract premise.
- Use natural, everyday language that is understandable on the first reading. Keep each question to one direct sentence and no more than 32 words.
- Do not ask generic prompts that could fit an unrelated entry.
- Do not ask "How did that make you feel?", "What does this mean to you?", "What did you learn?", or "Is there anything else?"
- Do not use formal or abstract phrases such as "from your present perspective," "has your answer shifted," "what would you ask your past self," "what does this reveal," or "to what extent."
- Do not merely paraphrase a sentence from the entry and append "has that changed?"
- Do not recap the entry before asking the questions.

Return only valid JSON in this exact shape:
{"questions":["Question one?","Question two?","Question three?","Question four?"]}`;
  const baseUserPrompt = `Create exactly four grounded reflection questions for this entry. Check every premise against the supplied writing, keep unrelated subjects separate, and verify that every question is clear on its first reading before returning the JSON.

TIMING CONTEXT:
${timing.prompt}

${entry}`;

  let validationError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userPrompt = attempt === 0
      ? baseUserPrompt
      : `${baseUserPrompt}

Your previous question set was rejected because it violated the required structure, grounding, or temporal framing. Generate a completely revised set. For an older entry, every question must explicitly identify the journaled material as historical and must not phrase it as a current situation.`;
    const raw = await groqChatJson(systemPrompt, userPrompt, {
      stage: attempt === 0
        ? "journal-reflection-questions"
        : "journal-reflection-questions-repair",
      model: MODEL,
      temperature: 0.05,
      maxTokens: 1_100,
    });
    const parsed = parseJsonObject(raw);

    try {
      if (!parsed) {
        throw new Error("Failed to parse the reflection questions response");
      }
      return validatedQuestions(parsed, timing.kind);
    } catch (error) {
      validationError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw validationError ?? new Error("Failed to generate valid reflection questions");
}

function validatedPerspective(
  parsed: Record<string, unknown>,
  timingKind: ReflectionTimingKind,
): string {
  const perspective = String(parsed.perspective || "").trim();
  if (!perspective || perspective.length > 900) {
    throw new Error("The AI response did not contain one concise perspective");
  }
  if (
    /^(?:[-*]|\d+[.)])\s/m.test(perspective) ||
    perspective.includes("?") ||
    /\n\s*\n/.test(perspective)
  ) {
    throw new Error("The AI response did not contain a single perspective");
  }
  const unhelpfulReportLanguage = [
    /\byour reflection (?:shows|indicates|demonstrates|reveals)\b/i,
    /\byour answers? (?:shows|indicates|demonstrates|reveals)\b/i,
    /\bthis (?:shows|indicates|demonstrates|reveals) that\b/i,
    /\bindicating that\b/i,
    /\bpersist(?:s|ed)? unchanged\b/i,
    /\bcentral (?:difficulty|issue|problem) remains\b/i,
  ];
  if (unhelpfulReportLanguage.some((pattern) => pattern.test(perspective))) {
    throw new Error("The AI response repeated the reflection instead of offering a useful perspective");
  }
  const falseTemporalConclusion = [
    /\bsince (?:the|this|you)\b/i,
    /\bover time\b/i,
    /\bpersist(?:s|ed|ing)?\b/i,
    /\bremain(?:s|ed)? unchanged\b/i,
    /\bhas (?:changed|shifted|evolved)\b/i,
  ];
  if (
    timingKind !== "older" &&
    falseTemporalConclusion.some((pattern) => pattern.test(perspective))
  ) {
    throw new Error("The AI response assumed more time or change than the reflection supports");
  }
  return perspective;
}

export async function generateJournalReflectionPerspective(input: {
  entryTitle: string;
  entryContent: string;
  entryDate: string;
  reflectionDate: string;
  timeZone: string;
  responses: ReflectionResponseInput[];
}): Promise<string> {
  const entry = cleanEntry(input.entryTitle, input.entryContent);
  const timing = timingContext(input);
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

The user's own interpretation is authoritative. Offer one concise, thoughtful observation they may consider, based only on the original entry and their answers.

TIMING RULES:
- Respect the supplied entry date, reflection date, elapsed time, and timing classification.
- For a same-day reflection, never describe a feeling, difficulty, priority, or understanding as having persisted, remained unchanged, evolved, shifted, or developed since the entry.
- Never assume that time produced growth, clarity, distance, or a changed perspective.

NON-NEGOTIABLE RULES:
- Read the original entry and every answered response before choosing the perspective. Consider them together without forcing them into one story.
- Identify one specific theme, tension, contrast, explicit connection, stated change, or meaningful boundary between what the user knows and what remains uncertain. It must be directly supported by the writing.
- Keep unrelated subjects separate unless the user explicitly connects them.
- Use both the original entry and the answered responses. Do not merely summarize, recap, or formally restate either one.
- Never invent facts, context, motives, emotions, relationships, causes, progress, growth, or hidden meaning.
- Never turn a plausible interpretation into a fact. Use "may," "might," or "could" when the evidence is incomplete.
- Do not diagnose, psychoanalyze, judge, praise, reassure, advise, coach, prescribe action, or tell the user what to think.
- Do not overstate significance or make ordinary details dramatic.
- Do not treat an unanswered question as evidence.
- Do not force a problem, solution, lesson, breakthrough, or positive outcome. Uncertainty can be the most honest and useful point.
- Do not mention that you are an AI and do not add a disclaimer.

USEFULNESS RULES:
- Give one observation that adds a concrete distinction, tension, or framing the user did not already state verbatim.
- When the user explicitly says they do not know why something is happening, engage with the exact boundary of that uncertainty instead of announcing that the problem still exists.
- Omit generic commentary that could fit another person's reflection.
- Do not recap events, list topics, repeat the answers, or close with a summary.
- Use warm, clear, everyday language, as if speaking thoughtfully to the user. Do not sound like an academic, clinical assessment, or report.
- Never begin with "Your reflection shows," "Your answers indicate," or similar report language. Avoid "indicating," "demonstrates," "persisted unchanged," and "central difficulty."
- Write one short paragraph of one to three direct sentences, no heading, no bullets, and no question.

Return only valid JSON in this exact shape:
{"perspective":"One concise, grounded perspective."}`;
  const userPrompt = `Offer one useful, conversational perspective using only the material below. Silently verify every claim against the entry or an answer, consider every answered response, and remove any sentence that only repeats what the user already said before returning the JSON.

TIMING CONTEXT:
${timing.prompt}

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

  return validatedPerspective(parsed, timing.kind);
}

