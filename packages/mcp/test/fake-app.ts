import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ClientDeps, FetchLike } from '../src/client';
import type { Config } from '../src/config';
import { createMontagioServer } from '../src/index';

/** One request the fake app received. */
export type Call = {
  method: string;
  path: string;
  url: string;
  headers: Record<string, string>;
  json?: Record<string, unknown>;
  form?: FormData;
};

export const BASE_URL = 'http://127.0.0.1:3000';

export const reply = (body: unknown, status = 200) => Response.json(body, { status });

/** A fetch that answers from `handler` and records every call: no network, no app. */
export function fakeFetch(handler: (call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => (headers[name] = value));
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.pathname,
      url: url.href,
      headers,
      ...(typeof init.body === 'string' ? { json: JSON.parse(init.body) as Record<string, unknown> } : {}),
      ...(init.body instanceof FormData ? { form: init.body } : {}),
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch, calls };
}

/** A clock that only moves when the client sleeps: polling runs at once. */
export function fakeClock(): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  let time = 0;
  const sleeps: number[] = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    sleeps,
  };
}

export function testConfig(overrides: Partial<Config> = {}): Config {
  return { baseUrl: BASE_URL, pollIntervalMs: 2000, timeoutMs: 30 * 60_000, ...overrides };
}

/** The MCP server and a client linked in memory. */
export async function connect(config: Config, deps: ClientDeps): Promise<Client> {
  const server = createMontagioServer(config, deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'montagio-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

export type ToolOutput = { isError: boolean; data: Record<string, unknown> };

/** Call a tool and read its JSON text. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<ToolOutput> {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text?: string }[] };
  const text = result.content.find((part) => part.type === 'text')?.text ?? '';
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // The SDK's own answer to arguments its schema refuses is a sentence.
    data = { text };
  }
  return { isError: result.isError === true, data };
}
