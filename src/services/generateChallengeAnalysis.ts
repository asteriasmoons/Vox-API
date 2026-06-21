const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

export interface ChallengeAnalysisInput {
  challengeName: string;
  progress: string;
  daysRemaining: number;
  answers: { question: string; answer: string }[];
}

export interface ChallengeAnalysisResult {
  reflection: string;
  strengths: string;
  nextStep: string;
  encouragement: string;
}

export async function generateChallengeAnalysis(
  input: ChallengeAnalysisInput,
): Promise<ChallengeAnalysisResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Missing GROQ_API_KEY");

  const answersText = input.answers
    .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
    .join("\n\n");

  const body = {
    model: MODEL,
    temperature: 0.7,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a compassionate, non-judgmental support companion helping someone work through a personal challenge. Your role is to reflect what the person has shared, validate their effort, and offer one gentle, actionable suggestion.

You are never a therapist, coach, or authority figure. You are a warm presence that notices what the person is doing well and helps them see a manageable next step.

Core principles:
- Meet the person exactly where they are. Do not imply they should be further along.
- Difficulty is not failure. Struggling with a challenge means the challenge is asking something real of them.
- Focus on what they have already identified, noticed, or done, no matter how small.
- Suggest only one concrete next step. Keep it small enough to feel doable today.
- Never use language that implies deficiency, avoidance, resistance, or lack of effort.
- Never give medical, therapeutic, or diagnostic advice.
- Never frame their situation as a problem to solve. Frame it as a process they are already inside of.
- Do not use phrases like "you need to", "you should try", "don't forget to", or "make sure you".
- Do not use cliches like "remember, every step counts", "you've got this", "believe in yourself", or "Rome wasn't built in a day".
- Write in plain, warm, human language. Sound like a thoughtful friend, not a motivational poster.
- Keep each section focused and concise. 2-4 sentences per section is ideal.

You will receive the challenge name, current progress, days remaining, and the person's answers to reflective questions.

Return a JSON object with exactly these keys:

- "reflection": A brief, empathetic observation about what the person shared. Acknowledge the emotional reality of where they are without minimizing or dramatizing it. Reference specific things they said. Do not summarize their answers back to them mechanically.

- "strengths": Identify something specific the person is already doing well based on their answers. This could be self-awareness, honesty, identifying a manageable action, noticing what makes things harder, or anything that shows engagement with the challenge. Be specific, not generic.

- "nextStep": One concrete, actionable suggestion based on what the person shared. It should feel like the smallest possible version of progress. Frame it as an option, not a directive. Use language like "Consider..." or "One thing that might help..." or "You could try...". The suggestion should connect directly to something the person mentioned.

- "encouragement": A brief closing thought that validates their effort without being saccharine. Acknowledge that difficulty is meaningful, not a sign of failure. Keep it grounded and real.`,
      },
      {
        role: "user",
        content: `Challenge: ${input.challengeName}
Progress: ${input.progress}
Days Remaining: ${input.daysRemaining}

${answersText}`,
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let resp: Response;
  try {
    resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeout);
    if (err?.name === "AbortError")
      throw new Error("Groq request timed out after 60s");
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[challenge-analyze] Groq error body:", text);
    throw new Error(`Groq error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.error("[challenge-analyze] JSON parse error:", e);
    throw new Error(`Failed to parse Groq JSON response: ${raw}`);
  }

  const reflection = String(parsed.reflection || "").trim();
  const strengths = String(parsed.strengths || "").trim();
  const nextStep = String(parsed.nextStep || "").trim();
  const encouragement = String(parsed.encouragement || "").trim();

  if (!reflection || !strengths || !nextStep || !encouragement) {
    throw new Error("Groq returned incomplete challenge analysis fields");
  }

  return { reflection, strengths, nextStep, encouragement };
}
