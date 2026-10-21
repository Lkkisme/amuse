/**
 * Talking with background runs while they work (browser tasks, schedules'
 * runs). A briefing goes down and reports come up, like mail: Muse can tell a
 * run something more or stop it; a run can ask what only the user can answer,
 * and waits for Muse to relay the answer by the question's id. Every exchange
 * is recorded through the core's rules, so the user sees it in the chat.
 */
import { type ToolDefinition, defineTool } from "@earendil-works/pi-coding-agent";
import { type AgentIO, describe } from "@remuse/core";
import { Type } from "typebox";
import { status } from "./status.ts";
import { untrusted } from "./untrusted.ts";

type Text = { content: { type: "text"; text: string }[]; details: null };
const text = (value: string): Text => ({ content: [{ type: "text", text: value }], details: null });

/** The chat agent's tools for its runs in flight. */
export function relayTools(io: () => AgentIO): ToolDefinition[] {
  return [
    defineTool({
      name: "message_run",
      label: "Tell a background run",
      description:
        "Tell one of your runs in flight (a browser task b-…, or a schedule s-… while it runs) something more: a further instruction, a correction, what the user just added. It reads it before its next step. Not for answering its questions: use answer_question.",
      parameters: Type.Object({ status, run: Type.String({ description: "The run's id, e.g. b-…" }), text: Type.String({ description: "What it should know or do, in full" }) }),
      async execute(_, { run, text: message }) {
        const told = io().act({ kind: "instruct", run, text: message });
        return text(told.ok ? `Sent to ${run}; it reads it before its next step.` : `Not sent: ${describe(told.rejection)}.`);
      },
    }),
    defineTool({
      name: "answer_question",
      label: "Answer a run's question",
      description: "Answer a question a run asked (q-…), with what the user said. Answer only what the user actually said; if they have not said, ask them first.",
      parameters: Type.Object({ status, question: Type.String({ description: "The question's id, e.g. q-…" }), answer: Type.String() }),
      async execute(_, { question, answer }) {
        const done = io().act({ kind: "answer", id: question, text: answer });
        return text(done.ok ? "Answered; the run goes on with it." : `Not answered: ${describe(done.rejection)}.`);
      },
    }),
    defineTool({
      name: "stop_run",
      label: "Stop a background run",
      description: "Stop one of your runs in flight (b-… or s-…) when the user wants it stopped or it is no longer needed. A browser the user has taken over is theirs: tell them instead.",
      parameters: Type.Object({ status, run: Type.String() }),
      async execute(_, { run }) {
        const done = io().act({ kind: "stopRun", run });
        return text(done.ok ? `Stopped ${run}.` : `Not stopped: ${describe(done.rejection)}.`);
      },
    }),
  ];
}

/** A run as its tools see it: who it is, what to say to whom, and when it is stopped. */
export interface RunHandle {
  id: string;
  title: string;
  /** "browser task" or "scheduled task", for reports */
  noun: string;
  io: AgentIO;
  stop: AbortSignal;
}

/** `promise`, or null once `signal` aborts. */
function unlessStopped<T>(signal: AbortSignal, promise: Promise<T>): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * A run's tool for asking the user, through Muse: the question gets an id, Muse
 * is told, and the tool returns the answer (or that none came). `waiting` and
 * `working` tell the run's card, where it has one.
 */
export function askTool(run: RunHandle, hooks: { waiting?: () => void; working?: () => void } = {}): ToolDefinition {
  return defineTool({
    name: "ask_user",
    label: "Ask the user",
    description:
      "Ask the user a question only they can answer (which of two options, a detail the task left open). Muse relays it; this waits for the answer, up to 30 minutes. Not for things to do in the browser.",
    parameters: Type.Object({ status, question: Type.String({ description: "One clear question, in the user's language" }) }),
    async execute(_, { question }) {
      const asked = run.io.act({ kind: "question", run: run.id, text: question });
      if (!asked.ok) return text(`Could not ask: ${describe(asked.rejection)}.`);
      hooks.waiting?.();
      run.io.report(`[${run.noun} "${run.title}" (${run.id}) asks; question ${asked.id}]\n${untrusted(question)}`);
      const outcome = await unlessStopped(run.stop, run.io.answer(asked.id));
      if (outcome === null || outcome.kind === "closed") return text("The task was stopped.");
      hooks.working?.();
      if (outcome.kind === "timed_out")
        return text("No answer came in time. Go on without it if you safely can (never guess anything that commits the user); otherwise finish and say what is needed.");
      return text(`The user answered: ${outcome.text}`);
    },
  });
}

/**
 * Where a run hears Muse: an instruction reaches its Pi session before its
 * next step (or, between prompts, with the next one: `drain`); a stop calls
 * `onStop`. Close it when the run ends.
 */
/** What the inbox needs of a Pi session (AgentSession has it): whether it is mid-run, and a way in. */
export interface Steerable {
  isStreaming: boolean;
  steer(text: string): Promise<unknown>;
}

export function inbox(run: RunHandle, session: () => Steerable | null, onStop: () => void): { drain(): string; close(): void } {
  const pending: string[] = [];
  const say = (message: string) => `[Message from Muse, the user's assistant, while you work]\n${message}`;
  const close = run.io.listen(run.id, (message) => {
    if (message.kind === "stop") return onStop();
    const live = session();
    if (live?.isStreaming) void live.steer(say(message.text)).catch(() => pending.push(message.text));
    else pending.push(message.text);
  });
  return {
    drain: () => pending.splice(0).map(say).join("\n\n"),
    close,
  };
}
