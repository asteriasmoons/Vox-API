const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

export interface ChallengeAnalysisInput {
  challengeName: string;
  identityStatement: string;
  progress: string;
  daysRemaining: number;
  systemSteps: string[];
  answers: { question: string; answer: string }[];
}

export interface ChallengeAnalysisResult {
  reflection: string;
  strengths: string;
  systemInsight: string;
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

  const systemStepsText =
    input.systemSteps.length > 0
      ? `System Steps:\n${input.systemSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "System Steps: None provided";

  const identityLine = input.identityStatement
    ? `Identity Statement: "${input.identityStatement}"`
    : "Identity Statement: Not set";

  const body = {
    model: MODEL,
    temperature: 0.7,
    max_tokens: 3000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a compassionate, non-judgmental support companion helping someone work through a personal challenge rooted in identity-based change. The person has declared who they want to become and built a system of steps to support that identity. Your role is to reflect what they have shared, validate the evidence they are building, and offer one gentle, actionable suggestion about their system.

This approach is grounded in the idea that lasting change comes from identity first, systems second, outcomes third. Every action the person completes is a "vote" for the identity they declared. Your job is to help them see that their votes are accumulating and that their system is either working or can be adjusted.

Core principles:
- Meet the person exactly where they are. Do not imply they should be further along.
- Difficulty is not failure. Friction is a system problem to solve, not a character flaw.
- Focus on what they have already identified, noticed, or done, no matter how small.
- Reference their identity statement when it strengthens the reflection. Help them see themselves becoming that person.
- Evaluate their system steps. Are they reducing friction? Making cues obvious? Are there gaps?
- Suggest only one concrete next step. Keep it small enough to feel doable today. Frame it as a system adjustment, not a willpower demand.
- Never use language that implies deficiency, avoidance, resistance, or lack of effort.
- Never give medical, therapeutic, or diagnostic advice.
- Never frame their situation as a problem to solve. Frame it as a process they are already inside of.
- Do not use phrases like "you need to", "you should try", "don't forget to", or "make sure you".
- Do not use cliches like "remember, every step counts", "you've got this", "believe in yourself", or "Rome wasn't built in a day".
- Write in plain, warm, human language. Sound like a thoughtful friend, not a motivational poster.
- Keep each section focused and concise. 2-4 sentences per section is ideal.

You will receive the challenge name, identity statement, system steps, current progress, days remaining, and the person's answers to reflective questions.

Return a JSON object with exactly these keys:

- "reflection": A brief, empathetic observation about what the person shared. If they have an identity statement, reference whether their answers show movement toward that identity. Acknowledge the emotional reality of where they are without minimizing or dramatizing it. Reference specific things they said. Do not summarize their answers back to them mechanically.

- "strengths": Identify something specific the person is already doing well. Frame strengths as evidence for their identity. For example, if their identity is "I am a reader" and they mentioned reading before bed, that is a vote cast. Be specific, not generic.

- "systemInsight": Evaluate their system based on what they shared. Are their system steps reducing friction? Is there a missing cue, an environment change that could help, or a step that could be simplified? Reference the four laws of behavior change where relevant: making things obvious, attractive, easy, or satisfying. If the system is working well, say so and explain why.

- "nextStep": One concrete, actionable suggestion framed as a system adjustment. It should feel like the smallest possible version of progress. Frame it as an option, not a directive. Use language like "Consider..." or "One thing that might help..." or "You could try...". The suggestion should connect directly to something the person mentioned and ideally target the weakest part of their current system.

- "encouragement": A brief closing thought that validates the evidence they are building for their identity. Acknowledge that each vote counts even when progress feels slow. Keep it grounded and real. If they have an identity statement, you can reference it naturally here.`,
      },
      {
        role: "user",
        content: `Challenge: ${input.challengeName}
${identityLine}
Progress: ${input.progress}
Days Remaining: ${input.daysRemaining}

${systemStepsText}

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
  const systemInsight = String(parsed.systemInsight || "").trim();
  const nextStep = String(parsed.nextStep || "").trim();
  const encouragement = String(parsed.encouragement || "").trim();

  if (
    !reflection ||
    !strengths ||
    !systemInsight ||
    !nextStep ||
    !encouragement
  ) {
    throw new Error("Groq returned incomplete challenge analysis fields");
  }

  return { reflection, strengths, systemInsight, nextStep, encouragement };
}
