/**
 * Loaded with --import by test/fetch-weights.test.ts: Hugging Face answers from the JSON file
 * MONTAGIO_HF_ANSWERS ({ url: body }), any other URL gets a 404, so nothing leaves the machine.
 */
import { readFileSync } from 'node:fs';

const answers = JSON.parse(readFileSync(process.env.MONTAGIO_HF_ANSWERS!, 'utf8')) as Record<string, unknown>;

globalThis.fetch = async (input: string | URL | Request) => {
  const url = input instanceof Request ? input.url : String(input);
  return url in answers ? Response.json(answers[url]) : new Response(`offline test: no answer for ${url}`, { status: 404 });
};
