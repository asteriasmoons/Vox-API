import express from "express";

const router = express.Router();

type WellnessWallRequest = {
  journal: {
    entryCount: number;
    topTags: string[];
  };
  water: {
    currentOz: number;
    goalOz: number;
    progress: number;
  };
  steps: {
    currentSteps: number;
    goalSteps: number;
    progress: number;
  };
  habits: {
    completedActions: number;
    targetActions: number;
    progress: number;
  };
};

type WellnessWallResponse = {
  journal: string | null;
  water: string | null;
  steps: string | null;
  habits: string | null;
};

type GroqChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

router.post("/wellness-wall", async (req, res) => {
  try {
    const body = req.body as WellnessWallRequest;

    const apiKey = process.env.GROQ_WALL_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: "Missing GROQ_WALL_KEY" });
    }

    const derivedData = {
      ...body,
      water: {
        ...body.water,
        goalMet: body.water.currentOz >= body.water.goalOz,
      },
      steps: {
        ...body.steps,
        goalMet: body.steps.currentSteps >= body.steps.goalSteps,
      },
      habits: {
        ...body.habits,
        fullyCompleted: body.habits.completedActions >= body.habits.targetActions,
      },
    };

    const prompt = `
Write four Wellness Wall insights for a self-care dashboard.

Return valid JSON only with exactly these keys:
journal, water, steps, habits.

Each category value must be exactly two sentences. Do not return one sentence. Do not return three or more sentences.

General rules:
- Each category must name at least one specific data point from the data.
- Each category must include an interpretation of what that data may suggest today.
- The two sentences inside each category should work together: sentence one names the data, sentence two interprets what is notable or worth noticing.
- Do not repeat phrasing, rhythm, sentence openings, or sentence structure across categories.
- Do not make every category sound like the same sentence with different numbers swapped in.
- Vary the wording naturally so the wall does not feel repetitive, robotic, or monotone.
- Do not give generic motivation or encouragement.
- Do not diagnose, moralize, exaggerate, or overstate.
- Keep the tone warm, grounded, neutral, and observant.
- Do not shame low numbers.
- Never sound judgmental, disappointed, critical, scolding, harsh, or corrective.
- Never imply failure, laziness, weakness, irresponsibility, lack of discipline, or personal inadequacy.
- Do not frame low numbers as “bad,” “concerning,” “not enough,” or “behind.”
- Do not compare the user against an ideal standard or expectation.
- Do not use guilt-based language or pressure-based wording.
- Avoid phrasing that sounds like performance evaluation, productivity scoring, or behavioral criticism.
- Do not use passive-aggressive wording or subtle disappointment.
- Treat all data neutrally and compassionately, especially when progress is low or partially complete.
- Prefer observational language over evaluative language.
- Use wording that feels emotionally safe, supportive, calm, and non-punitive.
- The tone should feel reflective and understanding, not corrective or managerial.
- Avoid language that sounds like a lecture, warning, or self-help coach.
- Do not overpraise or infantilize the user either; keep the tone grounded and emotionally intelligent.
- Frame observations as neutral patterns or states, not personal shortcomings.
- Speak about the data, not the user's character.
- If a value is low or missing, describe it neutrally (e.g., "still in progress" or "not yet logged") without implying failure or deficiency.

Each category must feel distinct and purposeful. Do not simply summarize the data.
Each insight should:
- Reference real values from the data.
- Interpret what those values suggest.
- Highlight what feels notable, different, or worth noticing about today.

Category guidance:

Journal:
- Focus on themes, emotional tone, or focus of writing based on tags.
- Reflect what the entries suggest about mental or emotional direction.

Water:
- Focus on hydration progress relative to the goal.
- Interpret how this level of hydration may affect energy or physical comfort.

- If water.goalMet is true, the water insight must explicitly say the hydration goal has been met or exceeded.
- If water.goalMet is true, the water insight must include both currentOz and goalOz in the wording.
- Never incorrectly state that currentOz is below goalOz when currentOz is equal to or greater than goalOz.

Steps:
- Focus on movement level relative to the goal.
- Describe whether movement is light, steady, or strong today.

- If steps.goalMet is true, the steps insight must explicitly say the step goal has been met or exceeded.
- If steps.goalMet is true, the steps insight must include both currentSteps and goalSteps in the wording.
- If steps.goalMet is true, do not describe the movement as below goal, low, light, lacking, needing more activity, or less than expected.
- If currentSteps is below goalSteps, describe movement neutrally without framing it negatively.
- Never incorrectly state that currentSteps is below goalSteps when currentSteps is equal to or greater than goalSteps.

Habits:
- Focus on routine follow-through.
- Describe whether routines are holding, partially complete, or still open.

- If habits.fullyCompleted is true, the habits insight must explicitly say the target actions are fully completed today.
- If habits.fullyCompleted is true, the habits insight must include both completedActions and targetActions in the wording.
- Never incorrectly state that completedActions is below targetActions when completedActions is equal to or greater than targetActions.

Output example shape only:
{
  "journal": "Sentence one. Sentence two.",
  "water": "Sentence one. Sentence two.",
  "steps": "Sentence one. Sentence two.",
  "habits": "Sentence one. Sentence two."
}

Data:
${JSON.stringify(derivedData, null, 2)}
`;

    const aiResponse = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.4,
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      return res.status(500).json({
        error: "AI request failed",
        details: errorText,
      });
    }

    const aiData = (await aiResponse.json()) as GroqChatCompletionResponse;

    const outputText =
      aiData.choices?.[0]?.message?.content ?? "";

    let parsed: WellnessWallResponse;

    try {
      const jsonMatch = outputText.match(/\{[\s\S]*\}/);

      if (!jsonMatch) {
        return res.status(500).json({
          error: "AI response did not contain JSON",
          raw: outputText,
        });
      }

      parsed = JSON.parse(jsonMatch[0]) as WellnessWallResponse;
    } catch {
      return res.status(500).json({
        error: "AI returned invalid JSON",
        raw: outputText,
      });
    }

    return res.json({
      journal: parsed.journal ?? null,
      water: parsed.water ?? null,
      steps: parsed.steps ?? null,
      habits: parsed.habits ?? null,
    });
  } catch {
    return res.status(500).json({
      error: "Wellness Wall request failed",
    });
  }
});

export default router;
