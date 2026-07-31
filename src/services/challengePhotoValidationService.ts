const PUTER_OPENAI_URL = "https://api.puter.com/puterai/openai/v1/chat/completions";
const MODEL =
  process.env.PUTER_CHALLENGE_PHOTO_MODEL ||
  process.env.PUTER_MODEL ||
  "openai/gpt-4o";

export type ChallengePhotoValidationStatus =
  | "approved"
  | "needsMoreInfo"
  | "rejected";

export interface ChallengePhotoValidationPacket {
  challengeTitle: string;
  requirementText: string;
  validationType: string;
  requiredThemes: string[];
  bookTitles: string[];
  submissionNote: string;
  proofSummary: string;
  photoURL: string;
}

export interface ChallengePhotoValidationResponse {
  status: ChallengePhotoValidationStatus;
  message: string;
  confidence: number;
  visibleEvidence: string[];
  missingEvidence: string[];
}

export async function validateChallengePhoto(
  input: ChallengePhotoValidationPacket,
): Promise<ChallengePhotoValidationResponse> {
  const apiKey = process.env.PUTER_API_KEY;
  if (!apiKey) throw new Error("Missing PUTER_API_KEY");

  const safeInput = sanitizeInput(input);
  if (!safeInput.photoURL) throw new Error("Invalid photoURL");

  const body = {
    model: MODEL,
    temperature: 0.1,
    max_tokens: 550,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are validating photo proof for Lumey reading challenges.

Return a JSON object with exactly these keys:
- "status": "approved" | "needsMoreInfo" | "rejected"
- "message": A short user-facing explanation.
- "confidence": A number from 0 to 1.
- "visibleEvidence": An array of short phrases describing what is visible in the photo.
- "missingEvidence": An array of short phrases describing what is missing or unclear.

Rules:
- Validate the photo against the challenge title, requirement text, required themes, proof summary, and submission note.
- Photo proof is allowed for any challenge when the image visibly supports the requirement.
- Be fair and practical. Approve when the photo clearly shows the requested real-world proof or an unmistakable equivalent.
- For "Coffee & Chapters" or "Pages and Coffee", a visible cup, mug, tumbler, bottle, thermos, or beverage container is enough proof.
- Do not require faces, private information, receipts, exact book titles, or metadata.
- Reject unrelated photos.
- Use needsMoreInfo when the photo might be relevant but is too unclear, too dark, too cropped, or missing the important object.
- Do not mention being an AI.
- Keep the message to 1-2 sentences.
- Return valid JSON only. No markdown. No code fences. No extra keys.`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                challengeTitle: safeInput.challengeTitle,
                requirementText: safeInput.requirementText,
                validationType: safeInput.validationType,
                requiredThemes: safeInput.requiredThemes,
                bookTitles: safeInput.bookTitles,
                submissionNote: safeInput.submissionNote,
                proofSummary: safeInput.proofSummary,
              },
              null,
              2,
            ),
          },
          {
            type: "image_url",
            image_url: {
              url: safeInput.photoURL,
            },
          },
        ],
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 75_000);

  let resp: Response;

  try {
    resp = await fetch(PUTER_OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error("Puter request timed out after 75s");
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error("[challenge-photo] Puter error body:", text);
    throw new Error(`Puter error ${resp.status}: ${text}`);
  }

  const json: any = await resp.json();
  const raw = String(json?.choices?.[0]?.message?.content || "").trim();

  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("[challenge-photo] JSON parse error:", error);
    throw new Error(`Failed to parse Puter JSON response: ${raw}`);
  }

  const status = normalizeStatus(parsed.status);
  const message = cleanString(parsed.message, 320);

  if (!message) {
    throw new Error("Puter returned empty validation message");
  }

  return {
    status,
    message,
    confidence: normalizeConfidence(parsed.confidence),
    visibleEvidence: cleanStringArray(parsed.visibleEvidence, 8, 100),
    missingEvidence: cleanStringArray(parsed.missingEvidence, 8, 100),
  };
}

function sanitizeInput(
  input: ChallengePhotoValidationPacket,
): ChallengePhotoValidationPacket {
  return {
    challengeTitle: cleanString(input.challengeTitle, 160),
    requirementText: cleanString(input.requirementText, 400),
    validationType: cleanString(input.validationType, 80),
    requiredThemes: cleanStringArray(input.requiredThemes, 30, 80),
    bookTitles: cleanStringArray(input.bookTitles, 20, 180),
    submissionNote: cleanString(input.submissionNote, 1200),
    proofSummary: cleanString(input.proofSummary, 1600),
    photoURL: cleanURL(input.photoURL),
  };
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanURL(value: unknown): string {
  const url = cleanString(value, 2000);
  if (!url) return "";

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function cleanStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxItemLength))
    .filter((item) => item.length > 0)
    .slice(0, maxItems);
}

function normalizeStatus(value: unknown): ChallengePhotoValidationStatus {
  if (value === "approved") return "approved";
  if (value === "rejected") return "rejected";
  return "needsMoreInfo";
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
