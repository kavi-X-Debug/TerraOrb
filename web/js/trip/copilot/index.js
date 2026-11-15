// Copilot provider layer. ask(message, context) tries the providers in order:
//   1. rules  (always; runs in the browser, grounded in real data through the tools)
//   2. remote (only if the backend says it is enabled AND the visitor has not turned it off): it rewords the facts the rules provider
//             retrieved; if it fails, is slow, is disabled or adds a number that is not in the facts, the rules answer is used.
//
//   context = { env: { data, cfg, t, lang, fmt?, today?, deps?, getList }, memory: {lastDests, pending}, useRemote: boolean }
//   -> { answer, provider: "rules" | "remote", remoteText: string|null, remoteTried: boolean, remoteError: string|null, parsed }
import { parseQuestion } from "./intents.js";
import { answerFor, plain, resolve } from "./rules.js";
import { createTools } from "./tools.js";
import * as remote from "./remote.js";

const stripLead = (s) => String(s || "").trim().slice(0, 500);

export async function ask(message, context) {
  const env = context.env;
  const memory = context.memory || {};
  const text = stripLead(message);
  const today = env.today || (await createTools(env).today()).today;
  let parsed = parseQuestion(text, { destinations: env.data.destinations, today, getList: env.getList });
  // a bare place name answers the "which place?" question that was asked before
  if (memory.pending && parsed.defaulted && parsed.dests.length) {
    parsed = { ...parsed, intent: memory.pending.intent, dates: parsed.dates || memory.pending.dates, days: parsed.days || memory.pending.days, interests: parsed.interests.length ? parsed.interests : memory.pending.interests || [], defaulted: false };
  }
  // a follow-up such as "what about tomorrow?" keeps talking about the last place
  if (!parsed.intent && parsed.dates && memory.lastDests?.length) parsed = { ...parsed, intent: "will_it_rain", confidence: "medium" };
  const tools = createTools({ ...env, today });
  let answer;
  try {
    answer = await answerFor(parsed, { ...env, tools, today }, memory);
  } catch (err) {                                                     // a bug must not look like an answer
    console.error(err);
    answer = { intent: parsed.intent || "unknown", ok: false, headline: { key: "tripd.fail.head", params: {} }, blocks: [{ type: "p", key: "tripd.fail.tool", params: {}, tone: "warn" }, { type: "p", key: "tripd.fail.no_guess", params: {} }],
      sources: [], uncertain: null, disclaimer: false, links: [], followups: [], meta: {}, interp: null };
  }
  const result = { answer, provider: "rules", remoteText: null, remoteTried: false, remoteError: null, parsed };
  if (context.useRemote && answer.ok && answer.intent !== "unknown" && answer.intent !== "help") {
    try {
      const st = await remote.status({ fetchImpl: env.fetchImpl });
      if (st.enabled) {
        result.remoteTried = true;
        const facts = plain(answer, env.t, env.fmt?.time);
        result.remoteText = await remote.rephrase({ message: text, lang: env.lang, facts, fetchImpl: env.fetchImpl });
        result.provider = "remote";
      }
    } catch (err) { result.remoteError = String(err.message || err); }
  }
  return result;
}

export { parseQuestion, answerFor, plain, resolve, createTools, remote };
