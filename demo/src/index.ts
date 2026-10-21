/**
 * Scripted ports and a seeded conversation: what the web demo and dev
 * server run until the real agent, browser pool and connectors are plugged
 * in. Behavior lives here only as port reactions; the rules stay in decide.
 */
import {
  type AppDirectory,
  type Emit,
  type Ports,
  type Rules,
  type Timers,
  kinds,
  memoryRules,
  newId,
  noKeys,
  noWorkspace,
  permissionOf,
  verdict,
} from "@amuse/core";
import type { Account, App, Entity } from "@amuse/protocol";

const demoApp = (id: string, name: string, description: string): App => ({
  id,
  name,
  description,
  logo: `https://logos.composio.dev/api/${id}`,
});
const catalog: App[] = [
  demoApp("gmail", "Gmail", "Read, search and send email"),
  demoApp("googlecalendar", "Google Calendar", "See and plan events"),
  demoApp("googlesheets", "Google Sheets", "Read and update spreadsheets"),
  demoApp("googledrive", "Google Drive", "Find and share files"),
  demoApp("notion", "Notion", "Pages, notes and databases"),
  demoApp("slack", "Slack", "Messages and channels"),
  demoApp("github", "GitHub", "Code, issues and pull requests"),
  demoApp("outlook", "Outlook", "Microsoft email and calendar"),
];

/** The demo's apps: a short list, connected at once (there is no provider to authorize with). */
function demoApps(rules: Rules): AppDirectory {
  const accounts = new Map<string, Account>([
    [
      "ca_demo_gmail",
      {
        id: "ca_demo_gmail",
        app: demoApp("gmail", "Gmail", "Read, search and send email"),
        label: "you@example.com",
        status: "active",
      },
    ],
  ]);
  return {
    async search(query) {
      const q = query.trim().toLowerCase();
      return {
        apps: catalog.filter((a) =>
          `${a.id} ${a.name} ${a.description}`.toLowerCase().includes(q),
        ),
        cursor: null,
      };
    },
    accounts: async () => [...accounts.values()],
    async connect(id) {
      const app = catalog.find((a) => a.id === id);
      if (!app) throw new Error(`No app "${id}"`);
      // another account of an app the demo has: a second address
      const n = [...accounts.values()].filter((a) => a.app.id === id).length;
      accounts.set(`ca_demo_${id}_${n}`, {
        id: `ca_demo_${id}_${n}`,
        app,
        label: n === 0 ? "you@example.com" : `you+${n}@example.com`,
        status: "active",
      });
      return "https://example.com/";
    },
    async disconnect(account) {
      accounts.delete(account);
    },
    async permissions(app) {
      const mine = await rules.of(app);
      return kinds.map((kind) => ({
        kind,
        permission: permissionOf(kind, mine),
        chosen: mine[kind] !== undefined,
      }));
    },
    permit: (app, kind, permission) => rules.set(app, kind, permission),
  };
}

export function demoPorts<H>(timers: Timers<H>): Ports {
  let replying: H[] = [];
  const later = (ms: number, fn: () => void) =>
    replying.push(timers.set(ms, fn));
  const now = () => new Date().toISOString();

  /** Stream a reply word by word, with the activity line set while it does. */
  const reply = (emit: Emit, text: string, delay = 600) => {
    emit({ kind: "activity", activity: { kind: "responding", label: null } });
    later(delay, () => {
      const id = newId("r");
      const [first = "", ...rest] = text.split(" ");
      emit({
        kind: "upserted",
        entity: {
          kind: "reply",
          id,
          at: now(),
          text: first,
          streaming: true,
          attachments: [],
        },
      });
      rest.forEach((word, i) =>
        later(70 * (i + 1), () =>
          emit({ kind: "appended", id, text: ` ${word}` }),
        ),
      );
      later(70 * (rest.length + 1), () => {
        emit({
          kind: "upserted",
          entity: {
            kind: "reply",
            id,
            at: now(),
            text,
            streaming: false,
            attachments: [],
          },
        });
        emit({ kind: "activity", activity: null });
        replying = [];
      });
    });
  };

  const rules = memoryRules();
  return {
    rules,
    apps: demoApps(rules),
    fit: () => {}, // the demo's browsers are sketches
    files: noWorkspace, // the demo keeps no files
    keys: noKeys, // nor keys: its agent is scripted
    // a side chat is named after its first few words
    title: async (text) => text.split(/\s+/).slice(0, 4).join(" "),
    prompt: (turn, { emit, act, time }) => {
      if (turn.kind === "note")
        return reply(emit, turn.text.replace(/^\[[^\]]*\]\n?/, ""));
      const { text } = turn;
      // the scripted agent shows its tools on cue: a URL starts a browser task, "connect <app>" asks to connect, "every morning" schedules
      const url = text.match(/https?:\/\/\S+/)?.[0];
      const app = text.match(/connect\s+(\w+)/i)?.[1];
      const daily = /every (morning|day)|每天/i.test(text);
      if (url)
        act({
          kind: "browse",
          title: `Look at ${new URL(url).host}`,
          url,
          instructions: text,
          files: [],
        });
      if (app)
        act({
          kind: "connect",
          provider: app.toLowerCase(),
          title: app.charAt(0).toUpperCase() + app.slice(1),
        });
      if (daily)
        act({
          kind: "schedule",
          title: "Morning briefing",
          instructions: text,
          when: {
            kind: "repeat",
            cron: "0 8 * * *",
            timezone: time().timezone,
          },
        });
      reply(
        emit,
        url || app || daily
          ? "On it — follow along in the card below."
          : `Got it — **"${text}"**. I'll take that from here and post updates in this chat.`,
        1400,
      );
    },
    // a scripted run: it has something to tell
    schedule: (schedule, { act, report }) => {
      timers.set(1500, () => {
        report(
          `[scheduled task "${schedule.title}"]\nNothing urgent today; two newsletters came in.`,
        );
        act({
          kind: "scheduleRan",
          id: schedule.id,
          outcome: "reported",
          summary: "Read the inbox; two newsletters, nothing urgent",
        });
      });
    },
    // a next job in an open browser: done at once
    job: (browser, { act }) => {
      timers.set(2000, () => act({ kind: "browserEnded", id: browser.id, status: "completed", result: "Done in the same browser." }));
    },
    browse: (browser, { act }) => {
      if (browser.instructions === "") return; // the user's own: theirs to browse
      // a login page needs the user; anything else finishes on its own
      timers.set(3000, () =>
        /login|signin/.test(browser.url)
          ? act({ kind: "browserStatus", id: browser.id, status: "needs_you" })
          : act({
              kind: "browserEnded",
              id: browser.id,
              status: "completed",
              result: "Looked the page over.",
            }),
      );
    },
    interrupt: () => {
      replying.forEach(timers.clear);
      replying = [];
    },
    browser: ({ browser, action }, { emit, act }) => {
      if (action === "handBack") {
        emit({
          kind: "activity",
          activity: { kind: "working", label: "Re-observing page" },
        });
        timers.set(2500, () => {
          emit({ kind: "activity", activity: null });
          if (
            act({
              kind: "browserEnded",
              id: browser.id,
              status: "completed",
              result: "Signed in; the page checks out.",
            }).ok
          )
            reply(
              emit,
              "Thanks, I have the browser back. The page checks out and the run is **complete**.",
              0,
            );
        });
      }
      if (action === "stop")
        reply(
          emit,
          "Stopped the browser run where it was. Nothing was submitted.",
        );
    },
    approval: ({ resolution }, { emit }) =>
      reply(
        emit,
        verdict(resolution) === "approved"
          ? "Approved — **sending it now**."
          : "Understood, I dropped the draft.",
      ),
    stopTask: () => {},
    // a scripted helper: it plans, works a while, and comes back
    task: (task, { act, report }) => {
      act({ kind: "taskSteps", id: task.id, steps: [{ label: "Look into it", done: false }, { label: "Sum it up", done: false }] });
      timers.set(2000, () => act({ kind: "taskSteps", id: task.id, steps: [{ label: "Look into it", done: true }, { label: "Sum it up", done: false }] }));
      timers.set(4000, () => {
        if (act({ kind: "taskEnded", id: task.id, status: "completed", result: "Looked into it; here is the summary." }).ok)
          report(`[task "${task.title}" finished]\nLooked into it; here is the summary.`);
      });
    },
    connect: async (connection, { emit, act }) => {
      // the provider's hosted page would call back; here it just succeeds
      timers.set(800, () => {
        if (act({ kind: "connected", id: connection.id }).ok)
          reply(
            emit,
            "**Connected.** I can read from it now — want me to pull a sample?",
          );
      });
      return `https://connect.example.com/${connection.id}`;
    },
  };
}

const minutesAgo = (m: number) =>
  new Date(Date.now() - m * 60_000).toISOString();
/** The demo's user is wherever it runs. */
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function seed(): Entity[] {
  return [
    {
      kind: "prompt",
      id: "p-seed1",
      at: minutesAgo(32),
      text: "Check the school-trip email and research exhibits at the aquarium",
      timezone: zone(),
      attachments: [],
    },
    {
      kind: "reply",
      id: "r-seed1",
      at: minutesAgo(31),
      text: "I found the trip email, opened it, and pulled together the exhibit options. Here's the plan I'm following:",
      streaming: false,
      attachments: [],
    },
    {
      kind: "task",
      id: "t-seed1",
      at: minutesAgo(31),
      title: "Aquarium trip research",
      status: "working",
      instructions: "Research the aquarium exhibits for the school trip",
      result: null,
      steps: [
        { label: "Open the trip email", done: true },
        { label: "List exhibit options", done: true },
        { label: "Check opening hours", done: false },
        { label: "Summarize for the reply", done: false },
      ],
    },
    {
      kind: "prompt",
      id: "p-seed2",
      at: minutesAgo(29),
      text: "Book the table for Friday",
      timezone: zone(),
      attachments: [],
    },
    {
      kind: "approval",
      id: "a-seed1",
      at: minutesAgo(29),
      action: "Send email",
      target: "restaurant@example.com",
      detail: "Reserve a table for 4, Friday 7pm. Draft ready for your review.",
      remember: true,
      status: "pending",
      expires: minutesAgo(-30),
    },
    {
      kind: "browser",
      id: "b-seed1",
      at: minutesAgo(28),
      title: "Monterey Bay Aquarium exhibits",
      url: "https://mbayaq.org/exhibits",
      status: "completed",
      instructions: "List the current exhibits",
      result: "Found 12 exhibits; the kelp forest feeding is at 11:30.",
      step: null,
      live: false,
      outcome: null,
      files: [],
    },
    {
      kind: "prompt",
      id: "p-seed3",
      at: minutesAgo(5),
      text: "Also check the tide schedule, and log in to the trip portal for me",
      timezone: zone(),
      attachments: [],
    },
    {
      kind: "browser",
      id: "b-seed2",
      at: minutesAgo(5),
      title: "Check the tide schedule",
      url: "https://tidesandcurrents.noaa.gov/stationhome",
      status: "working",
      instructions: "Check Saturday's low tide at Monterey",
      result: null,
      step: null,
      live: true,
      outcome: null,
      files: [],
    },
    {
      kind: "browser",
      id: "b-seed3",
      at: minutesAgo(4),
      title: "Log in to the trip portal",
      url: "https://portal.example.edu/login",
      status: "needs_you",
      instructions: "Log in to the trip portal and open the itinerary",
      result: null,
      step: null,
      live: true,
      outcome: null,
      files: [],
    },
    {
      kind: "reply",
      id: "r-seed2",
      at: minutesAgo(4),
      text: "The portal is asking for your login. Take control, sign in, then tap **Done** and I'll pick it up from there.",
      streaming: false,
      attachments: [],
    },
    {
      kind: "connection",
      id: "c-seed1",
      at: minutesAgo(3),
      provider: "googlesheets",
      title: "Google Sheets",
      status: "pending",
    },
    {
      kind: "reply",
      id: "r-seed3",
      at: minutesAgo(3),
      text: "Connect Google Sheets and I'll put the exhibit list into your trip planner.",
      streaming: false,
      attachments: [],
    },
  ];
}
