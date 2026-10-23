/**
 * Another client of the owner's existing Paseo daemon, not another agent host.
 * The installed CLI owns endpoint discovery and local-credential loading. No
 * provider executable is launched here, and closing this client leaves runs alone.
 */
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";

export interface PaseoConfig {
  home: string;
  /** Absolute path to the installed CLI's dist/utils/client.js. */
  clientModule: string;
  cwd: string;
  /** This installation's existing multi-agent profile. Its defaults stay in Paseo. */
  providerId?: string;
}

/** Structural views of the native 0.11.2 payloads; extra provider fields survive. */
export interface PaseoPermissionRequest {
  id: string;
  provider: string;
  name: string;
  kind: "tool" | "plan" | "question" | "mode" | "other";
  title?: string;
  description?: string;
  input?: Record<string, unknown>;
  detail?: unknown;
  suggestions?: Record<string, unknown>[];
  actions?: { id: string; label: string; behavior: "allow" | "deny"; variant?: string; intent?: string }[];
  metadata?: Record<string, unknown>;
}

export type PaseoPermissionResponse =
  | { behavior: "allow"; selectedActionId?: string; updatedInput?: Record<string, unknown>; updatedPermissions?: Record<string, unknown>[] }
  | { behavior: "deny"; selectedActionId?: string; message?: string; interrupt?: boolean };

export interface PaseoAgent {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string;
  model: string | null;
  title: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastUserMessageAt: string | null;
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
  activeTurn?: { turnId: string; startedAt: string | null } | null;
  runtimeInfo?: { provider: string; sessionId?: string; model?: string | null; modeId?: string | null; extra?: Record<string, unknown> };
  pendingPermissions: PaseoPermissionRequest[];
  persistence: { provider: string; sessionId: string; nativeHandle?: string; metadata?: Record<string, unknown> } | null;
  labels: Record<string, string>;
  lastUsage?: Record<string, unknown>;
  lastError?: string;
  requiresAttention?: boolean;
  attentionReason?: "finished" | "error" | "permission" | null;
  archivedAt?: string | null;
  [key: string]: unknown;
}

export interface PaseoDirectoryPage {
  requestId: string;
  entries: { agent: PaseoAgent; project?: unknown; [key: string]: unknown }[];
  pageInfo: { nextCursor: string | null; prevCursor: string | null; hasMore: boolean };
  [key: string]: unknown;
}

export interface PaseoTimelineItem {
  type: string;
  text?: string;
  message?: string;
  messageId?: string;
  clientMessageId?: string;
  status?: string;
  [key: string]: unknown;
}

export interface PaseoTimelineEntry {
  provider: string;
  item: PaseoTimelineItem;
  turnId?: string;
  timestamp: string;
  seqStart: number;
  seqEnd: number;
  sourceSeqRanges: { startSeq: number; endSeq: number }[];
  collapsed: string[];
}

export interface PaseoTimelineCursor { epoch: string; seq: number }
export interface PaseoTimeline {
  requestId: string;
  agentId: string;
  agent: PaseoAgent | null;
  epoch: string;
  direction: "tail" | "before" | "after";
  projection: "projected" | "canonical";
  reset: boolean;
  staleCursor: boolean;
  gap: boolean;
  window: { minSeq: number; maxSeq: number; nextSeq: number };
  startCursor: PaseoTimelineCursor | null;
  endCursor: PaseoTimelineCursor | null;
  hasOlder: boolean;
  hasNewer: boolean;
  entries: PaseoTimelineEntry[];
  error: string | null;
}

export interface PaseoStreamEvent {
  type: string;
  provider?: string;
  item?: PaseoTimelineItem;
  turnId?: string;
  request?: PaseoPermissionRequest;
  requestId?: string;
  error?: string;
  [key: string]: unknown;
}

export type PaseoAgentUpdate =
  | { kind: "upsert"; agent: PaseoAgent; project?: unknown; subscriptionId?: string }
  | { kind: "remove"; agentId: string; subscriptionId?: string };
export type PaseoConnectionState = { status: string; reason?: string; attempt?: number };
export type PaseoDaemonEvent =
  | { type: "agent_update"; agentId: string; payload: PaseoAgentUpdate }
  | { type: "agent_stream"; agentId: string; event: PaseoStreamEvent; timestamp: string; seq?: number; epoch?: string }
  | { type: "agent_deleted"; agentId: string }
  | { type: "agent_permission_request"; agentId: string; request: PaseoPermissionRequest }
  | { type: "agent_permission_resolved"; agentId: string; requestId: string; resolution: PaseoPermissionResponse }
  | { type: "status" | "workspace_update" | "project.update" | "workspace_setup_progress" | "providers_snapshot_update"; payload: Record<string, unknown> }
  | { type: "error"; message: string };

export type PaseoTimelineMessage =
  | { type: "agent_stream"; payload: { agentId: string; event: PaseoStreamEvent; timestamp: string; seq?: number; epoch?: string; subscriptionId?: string } }
  | { type: "agent.timeline.replacement"; payload: { agentId: string; epoch: string; subscriptionId?: string } }
  | { type: "agent.timeline.subscription_restored"; payload: { agentId: string; subscriptionId: string } }
  | { type: "agent.timeline.error"; payload: { agentId: string; error: string } };

export type PaseoClientEvent = PaseoDaemonEvent
  | { type: "connection"; state: PaseoConnectionState }
  | { type: "catalog"; page: PaseoDirectoryPage }
  | { type: "timeline"; message: Exclude<PaseoTimelineMessage, { type: "agent_stream" }> };
export type PaseoEvent = PaseoClientEvent;

export interface PaseoAttachment { type: string; [key: string]: unknown }
export type PaseoMcpServer =
  | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string>; alwaysLoad?: boolean }
  | { type: "http" | "sse"; url: string; headers?: Record<string, string>; alwaysLoad?: boolean };
export interface PaseoCreateOptions {
  mcpServers?: Record<string, PaseoMcpServer>;
  systemPrompt?: string;
}
export interface PaseoSendOptions {
  /** Native deduplication ID, returned as clientMessageId in the timeline. */
  messageId?: string;
  clientMessageId?: string;
  /** Paseo has no queue mode. Steer is its non-default, active-turn guidance path. */
  activeTurnBehavior?: "steer" | "interrupt";
  images?: { data: string; mimeType: string }[];
  attachments?: PaseoAttachment[];
}

export interface PaseoClient {
  listAgents(): Promise<PaseoAgent[]>;
  createAgent(title?: string, cwd?: string, options?: PaseoCreateOptions): Promise<PaseoAgent>;
  /** Full native projected entries; after returns complete changed entries for upsert. */
  history(agentId: string, options?: { after?: PaseoTimelineCursor }): Promise<PaseoTimeline>;
  subscribe(listener: (event: PaseoClientEvent) => void): () => void;
  /** Establish live delivery before sending; release only removes this client's watch. */
  watch(agentId: string): Promise<() => Promise<void>>;
  send(agentId: string, text: string, options?: PaseoSendOptions): Promise<void>;
  cancel(agentId: string): Promise<void>;
  rename(agentId: string, title: string): Promise<void>;
  respondPermission(agentId: string, requestId: string, response: PaseoPermissionResponse): Promise<void>;
  close(): Promise<void>;
}

interface Observation<T> {
  ready: Promise<T>;
  subscribe(observer: { snapshot(value: T): void; update(message: unknown): void; error(error: unknown): void }): () => void;
  release(): Promise<void>;
}
interface TimelineSubscription {
  (): void;
  ready: Promise<void>;
  release(): Promise<void>;
}
interface DirectoryQuery { filter: { includeArchived: boolean }; page: { limit: number; cursor?: string }; timeout: number }
interface Driver {
  /** Public SDK API; the short-lived CLI helper disables this by default. */
  setReconnectEnabled(enabled: boolean): void;
  fetchAgents(options: DirectoryQuery): Promise<PaseoDirectoryPage>;
  observeAgents(options: DirectoryQuery): Observation<PaseoDirectoryPage>;
  createAgent(options: { provider: string; cwd: string; title?: string } & PaseoCreateOptions): Promise<PaseoAgent>;
  fetchAgentTimeline(agentId: string, options: { direction: "tail" | "before" | "after"; projection: "projected"; limit: number; cursor?: PaseoTimelineCursor; timeout: number }): Promise<PaseoTimeline>;
  subscribeAgentTimeline(agentId: string, listener: (message: PaseoTimelineMessage) => void): TimelineSubscription;
  subscribe(listener: (event: PaseoDaemonEvent) => void): () => void;
  subscribeConnectionStatus(listener: (state: PaseoConnectionState) => void): () => void;
  sendMessage(agentId: string, text: string, options: Omit<PaseoSendOptions, "clientMessageId">): Promise<void>;
  cancelAgent(agentId: string): Promise<void>;
  updateAgent(agentId: string, updates: { name: string }): Promise<void>;
  respondToPermission(agentId: string, requestId: string, response: PaseoPermissionResponse): Promise<void>;
  close(): Promise<void>;
}

const timeout = 15_000;
const pageSize = 200;
const directoryQuery = (): DirectoryQuery => ({ filter: { includeArchived: true }, page: { limit: pageSize }, timeout });

export async function connectPaseo(config: PaseoConfig): Promise<PaseoClient> {
  for (const [name, value] of Object.entries({ home: config.home, clientModule: config.clientModule, cwd: config.cwd })) {
    if (!isAbsolute(value)) throw new Error(`Paseo ${name} must be an absolute local path.`);
  }
  const provider = config.providerId ?? "qwen-multi";
  if (!provider.trim()) throw new Error("A Paseo provider profile is required.");
  // Import only the explicitly configured local CLI. It resolves its own pinned
  // SDK and reads the current daemon credential; no secret crosses this API.
  const module = await import(pathToFileURL(config.clientModule).href) as { connectToDaemon?: (options: unknown) => Promise<Driver> };
  if (typeof module.connectToDaemon !== "function") throw new Error("The Paseo client module does not export connectToDaemon.");
  const driver = await module.connectToDaemon({ target: { kind: "instance", home: config.home }, timeout });
  if (typeof driver.setReconnectEnabled !== "function") {
    await driver.close().catch(() => {});
    throw new Error("The configured Paseo CLI does not expose supported connection recovery. Update its SDK before using a persistent connection.");
  }
  // The pinned SDK owns backoff, credentials, and catalog/timeline restoration.
  // Use its public switch, never its private config or a replacement agent.
  // On transport loss the SDK rejects uncertain RPCs/sends instead of replaying them.
  driver.setReconnectEnabled(true);
  const listeners = new Set<(event: PaseoClientEvent) => void>();
  let closed = false;
  let state: PaseoConnectionState = { status: "connected" };
  const check = () => { if (closed) throw new Error("The Paseo client is closed."); };
  const checkConnected = () => {
    check();
    if (state.status !== "connected") throw new Error("Paseo is temporarily disconnected. Existing sessions are retained; retry after reconnection.");
  };
  const emit = (event: PaseoClientEvent) => {
    if (closed) return;
    for (const listener of listeners) {
      try { listener(event); } catch { /* One UI consumer must not break daemon delivery. */ }
    }
  };
  const removeEvents = driver.subscribe(emit);
  const removeConnection = driver.subscribeConnectionStatus((next) => { state = next; emit({ type: "connection", state: next }); });
  let catalog: Observation<PaseoDirectoryPage>;
  let removeCatalog: (() => void) | undefined;
  let hadCatalogSnapshot = false;
  try {
    catalog = driver.observeAgents(directoryQuery());
    removeCatalog = catalog.subscribe({
      snapshot: (page) => {
        emit({ type: "catalog", page });
        // A restored owned subscription delivers a new snapshot, not necessarily
        // agent_update for every changed entry. Publish its authoritative states
        // through the same event path the bridge already reconciles.
        if (hadCatalogSnapshot) for (const entry of page.entries)
          emit({ type: "agent_update", agentId: entry.agent.id, payload: { kind: "upsert", agent: entry.agent, ...(entry.project === undefined ? {} : { project: entry.project }) } });
        hadCatalogSnapshot = true;
      },
      update: () => {}, // Native agent_update events are forwarded once by driver.subscribe.
      error: () => emit({ type: "error", message: "Paseo session-list subscription failed." }),
    });
    await catalog.ready;
  } catch (error) {
    removeCatalog?.();
    removeEvents();
    removeConnection();
    driver.setReconnectEnabled(false);
    await driver.close().catch(() => {});
    throw error;
  }

  type Watch = { refs: number; subscription: TimelineSubscription; ready: Promise<void> };
  const watches = new Map<string, Watch>();

  return {
    async listAgents() {
      check();
      const agents = new Map<string, PaseoAgent>();
      const seen = new Set<string>();
      let cursor: string | undefined;
      while (true) {
        const query = directoryQuery();
        if (cursor) query.page.cursor = cursor;
        const page = await driver.fetchAgents(query);
        for (const entry of page.entries) agents.set(entry.agent.id, entry.agent);
        if (!page.pageInfo.hasMore) return [...agents.values()];
        const next = page.pageInfo.nextCursor;
        if (!next || seen.has(next)) throw new Error("Paseo returned a non-progressing session-list cursor.");
        seen.add(next);
        cursor = next;
      }
    },
    createAgent(title, cwd = config.cwd, options = {}) {
      checkConnected();
      if (!isAbsolute(cwd)) throw new Error("Paseo working directory must be an absolute local path.");
      // Model, thinking and permissions belong to the existing provider profile.
      // Explicit additions apply only to this new session, never to old agents.
      return driver.createAgent({
        provider, cwd, ...(title?.trim() ? { title: title.trim() } : {}),
        ...(options.mcpServers ? { mcpServers: options.mcpServers } : {}),
        ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      });
    },
    async history(agentId, options = {}) {
      check();
      // A compaction/replacement may change the epoch between pages. Restart the
      // read instead of combining incompatible histories or silently truncating.
      for (let attempt = 0; attempt < 3; attempt++) {
        const after = attempt === 0 ? options.after : undefined;
        const tail = await driver.fetchAgentTimeline(agentId, { direction: after ? "after" : "tail", projection: "projected", limit: pageSize, timeout, ...(after ? { cursor: after } : {}) });
        if (tail.error) throw new Error(tail.error);
        // A stale incremental cursor requires a complete replacement, not an
        // append. Keep reset=true in the returned replacement for the caller.
        if (after && (after.epoch !== tail.epoch || tail.reset || tail.staleCursor || tail.gap)) continue;
        const entries = new Map<string, PaseoTimelineEntry>();
        const seen = new Set<number>();
        let page = tail;
        let changed = false;
        let gap = tail.gap;
        while (true) {
          if (page.epoch !== tail.epoch || page.staleCursor || (page !== tail && page.reset) || (after && page.gap)) { changed = true; break; }
          for (const entry of page.entries) {
            // Projected tool/message entries keep their display anchor while
            // later source rows extend seqEnd. Incremental pages return the
            // complete merged item, so retain its newest version once.
            const key = `${entry.provider}:${entry.seqStart}`;
            const previous = entries.get(key);
            if (!previous || previous.seqEnd < entry.seqEnd) entries.set(key, entry);
          }
          gap ||= page.gap;
          if (after ? !page.hasNewer : !page.hasOlder) {
            return {
              ...tail,
              agent: after ? page.agent ?? tail.agent : tail.agent,
              reset: tail.reset || (options.after !== undefined && !after),
              gap,
              startCursor: after ? tail.startCursor : page.startCursor,
              endCursor: after ? page.endCursor ?? tail.endCursor ?? after : tail.endCursor,
              hasOlder: after ? tail.hasOlder : false,
              hasNewer: after ? false : tail.hasNewer,
              entries: [...entries.values()].sort((a, b) => a.seqStart - b.seqStart || a.seqEnd - b.seqEnd),
            };
          }
          const cursor = after ? page.endCursor : page.startCursor;
          if (!cursor || cursor.epoch !== tail.epoch || seen.has(cursor.seq)) throw new Error("Paseo returned a non-progressing history cursor.");
          seen.add(cursor.seq);
          page = await driver.fetchAgentTimeline(agentId, { direction: after ? "after" : "before", projection: "projected", limit: pageSize, cursor, timeout });
          if (page.error) throw new Error(page.error);
        }
        if (!changed) break;
      }
      throw new Error("Paseo history changed repeatedly while it was being read. Try again.");
    },
    subscribe(listener) {
      check();
      listeners.add(listener);
      try { listener({ type: "connection", state }); } catch { /* Same isolation as asynchronous delivery. */ }
      return () => { listeners.delete(listener); };
    },
    async watch(agentId) {
      check();
      let watch = watches.get(agentId);
      if (!watch) {
        const subscription = driver.subscribeAgentTimeline(agentId, (message) => {
          // Stream rows are already delivered by driver.subscribe. Forward only
          // lifecycle messages here so each row reaches Amuse once.
          if (message.type !== "agent_stream") emit({ type: "timeline", message });
        });
        watch = { refs: 0, subscription, ready: subscription.ready };
        watches.set(agentId, watch);
      }
      const current = watch;
      current.refs++;
      try { await current.ready; check(); } catch (error) {
        current.refs--;
        if (watches.get(agentId) === current && current.refs === 0) {
          watches.delete(agentId);
          await current.subscription.release().catch(() => {});
        }
        throw error;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        current.refs--;
        if (watches.get(agentId) === current && current.refs === 0) {
          watches.delete(agentId);
          await current.subscription.release();
        }
      };
    },
    send(agentId, text, options = {}) {
      checkConnected();
      const { clientMessageId, ...native } = options;
      if (native.messageId && clientMessageId && native.messageId !== clientMessageId) throw new Error("Conflicting Paseo message IDs.");
      const messageId = native.messageId ?? clientMessageId;
      return driver.sendMessage(agentId, text, { ...native, activeTurnBehavior: native.activeTurnBehavior ?? "steer", ...(messageId ? { messageId } : {}) });
    },
    cancel(agentId) { checkConnected(); return driver.cancelAgent(agentId); },
    rename(agentId, title) {
      checkConnected();
      if (!title.trim()) throw new Error("A Paseo session title is required.");
      return driver.updateAgent(agentId, { name: title.trim() });
    },
    respondPermission(agentId, requestId, response) { checkConnected(); return driver.respondToPermission(agentId, requestId, response); },
    async close() {
      if (closed) return;
      closed = true;
      driver.setReconnectEnabled(false);
      listeners.clear();
      removeEvents();
      removeConnection();
      removeCatalog?.();
      await Promise.allSettled([catalog.release(), ...[...watches.values()].map((watch) => watch.subscription.release())]);
      watches.clear();
      await driver.close();
    },
  };
}
