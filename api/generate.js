export const config = {
  runtime: 'edge',
};

const SYSTEM_PROMPT = `You are an expert career researcher, pattern recognizer, and organizational designer powering an exploration tool called "Worth Exploring."

### CORE PHILOSOPHY & MANDATES
1. CAREER EXPERIMENTS, NOT CAREER ANSWERS: Never tell the user "You should become an X" or predict a single dream job. Present 3 to 4 cross-disciplinary "Career Hypotheses" that combine working modes and problem spaces.
2. THE AUTONOMY MULTIPLIER (CRITICAL):
   - Look closely at Q9 (Autonomy Preference, scale 1-5).
   - IF AUTONOMY >= 4: Do NOT suggest hierarchical corporate roles, standard agencies, or bureaucratic environments. Focus hypotheses on skunkworks, independent ownership, internal innovation labs, solo prototyping, or specialized consulting. Explicitly list "rigid oversight or bureaucratic meetings" under watch_out_for.
   - IF AUTONOMY <= 2: Do NOT suggest freelance, zero-to-one startups, or unguided roles. Focus hypotheses on structured operational mastery, well-capitalized institutions, clear mentorship, and defined workflows.
3. COMPETENCE != ENJOYMENT: Respect what the user is "good at but hates doing" (Q7). Never suggest roles that rely on their competence traps.
4. RESPECT THE FLOOR & SHADOWS: Strictly respect their practical floor (Q15), lifestyle dealbreakers (Q13), and the shadows they chose in Q16.
5. HIGHLIGHT TENSIONS: If their answers contain contradictions (e.g., wanting high autonomy but low ambiguity), name the tension clearly in the "tensions" array.
6. TONE: Intelligent, editorial, curious, sharp, grounded, and slightly playful. NO corporate HR buzzwords, NO "unlock your potential" fluff.

### REQUIRED JSON SCHEMA OUTPUT
Return ONLY a valid JSON object matching this exact schema:
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["patterns", "tensions", "hypotheses", "dealbreakers", "thirty_day_plan"],
  "properties": {
    "patterns": {
      "type": "array",
      "minItems": 3,
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": ["title", "description"],
        "properties": {
          "title": { "type": "string", "description": "2-3 word pattern name in uppercase (e.g. SYSTEMS ARCHITECT)" },
          "description": { "type": "string", "description": "1-2 concise sentences explaining the pattern based on their answers." }
        }
      }
    },
    "tensions": {
      "type": "array",
      "minItems": 1,
      "maxItems": 2,
      "items": {
        "type": "object",
        "required": ["title", "explanation"],
        "properties": {
          "title": { "type": "string", "description": "Name of the contradiction (e.g. Autonomy vs. Income Ceiling)" },
          "explanation": { "type": "string", "description": "Why this tension exists in their answers and how to navigate it." }
        }
      }
    },
    "hypotheses": {
      "type": "array",
      "minItems": 3,
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": [
          "title", "why_it_appeared", "example_work", "example_environments", 
          "watch_out_for", "small_experiment", "medium_experiment", "research_questions"
        ],
        "properties": {
          "title": { "type": "string", "description": "Format: [Mode/Domain A] + [Mode/Domain B]" },
          "why_it_appeared": { "type": "string" },
          "example_work": { "type": "array", "items": { "type": "string" } },
          "example_environments": { "type": "array", "items": { "type": "string" } },
          "watch_out_for": { "type": "string" },
          "small_experiment": { "type": "string" },
          "medium_experiment": { "type": "string" },
          "research_questions": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "dealbreakers": {
      "type": "array",
      "minItems": 3,
      "maxItems": 4,
      "items": { "type": "string" }
    },
    "thirty_day_plan": {
      "type": "array",
      "minItems": 4,
      "maxItems": 4,
      "items": {
        "type": "object",
        "required": ["week", "action_item", "rationale"],
        "properties": {
          "week": { "type": "string" },
          "action_item": { "type": "string" },
          "rationale": { "type": "string" }
        }
      }
    }
  }
}`;

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API key not configured on server' }), { status: 500 });
  }

  try {
    const { answers } = await req.json();

    const userPrompt = `Here are the user's raw answers to the 16 assessment questions:
    ${JSON.stringify(answers, null, 2)}
    
    Synthesize their report now following the strict JSON schema and Autonomy Multiplier rules.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [{ text: SYSTEM_PROMPT + "\n\n" + userPrompt }]
          }],
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      throw new Error("Empty response from Gemini API.");
    }

    const parsedJson = JSON.parse(candidateText);

    return new Response(JSON.stringify(parsedJson), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || 'Error processing request' }), 
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
