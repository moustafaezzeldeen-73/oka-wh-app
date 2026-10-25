/**
 * Gemini call-transcription request and response handling.
 *
 * Free of network and native imports so the prompt and the parsing rules can
 * be exercised directly — see scripts/test-logic.ts.
 */

export type TranscriptionContext = {
  orderName: string;
  target: 'customer' | 'courier';
  /** The other party's name, to help Gemini spell it. */
  contactName: string;
  /** Line-item titles, so product names in speech are transcribed correctly. */
  products: string[];
};

export type Transcription = {
  /** One sentence in Egyptian Arabic: what happened on the call. */
  summary: string;
  /** Verbatim, one speaker turn per line. Empty when there was no speech. */
  transcript: string;
};

export function transcriptionPrompt(ctx: TranscriptionContext): string {
  const other = ctx.target === 'courier' ? 'Courier' : 'Customer';
  const products = ctx.products.filter(Boolean).slice(0, 20);
  return [
    `This is a recorded phone call between OKA Egypt, a shop selling hookah accessories, and a ${
      ctx.target === 'courier' ? 'delivery courier' : 'customer'
    } about order ${ctx.orderName}.`,
    ctx.contactName ? `The ${other.toLowerCase()} is ${ctx.contactName}.` : '',
    products.length ? `Products in this order: ${products.join('; ')}.` : '',
    '',
    'Return JSON with two fields:',
    `- "transcript": the whole call, word for word, in the language spoken — Egyptian Arabic in Arabic script, with English product names kept as spoken. Put each speaker turn on its own line, starting with "OKA:" for the shop's staff member or "${other}:" for the other person. Do not translate, summarise or correct anything in the transcript.`,
    '- "summary": one short sentence in Egyptian Arabic saying what happened or was agreed (for example: confirmed the order, asked to change the address, refused, wrong number).',
    'If the recording contains no speech, return an empty transcript and the summary "لا يوجد كلام في التسجيل".',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function transcriptionRequest(
  audioBase64: string,
  mimeType: string,
  ctx: TranscriptionContext,
): Record<string, unknown> {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: transcriptionPrompt(ctx) },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          summary: { type: 'STRING' },
          transcript: { type: 'STRING' },
        },
        required: ['summary', 'transcript'],
      },
    },
  };
}

type GeminiResponse = {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
};

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/**
 * Pull the transcript out of a generateContent response. Structured output
 * normally arrives as clean JSON; a fenced or prose reply is tolerated so a
 * model quirk costs the summary, not the transcript.
 */
export function parseTranscription(response: GeminiResponse): Transcription {
  if (response.promptFeedback?.blockReason) {
    throw new TranscriptionError(`Gemini blocked the recording (${response.promptFeedback.blockReason})`);
  }
  const candidate = response.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) {
    throw new TranscriptionError(
      `Gemini returned no transcript${candidate?.finishReason ? ` (${candidate.finishReason})` : ''}`,
    );
  }

  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(unfenced) as Partial<Transcription>;
    return {
      summary: String(parsed.summary ?? '').trim(),
      transcript: splitTurns(String(parsed.transcript ?? '')),
    };
  } catch {
    return { summary: '', transcript: splitTurns(text) };
  }
}

/**
 * One speaker turn per line. Inside JSON output Gemini often runs turns
 * together — separated by a space, or by nothing at all ("…حضرتك.Customer:") —
 * despite the prompt, so the labels are the reliable boundary. `\b` keeps a
 * label glued to a Latin word (e.g. "BOOKA:") from splitting; Arabic letters
 * count as a boundary, as they should.
 */
export function splitTurns(transcript: string): string {
  return transcript
    .replace(/[ \t]*\b(?=(?:OKA|Customer|Courier):)/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}
