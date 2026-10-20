/**
 * Main chat feed, 1:1 with Muse: fit-content agent bubbles on --fill-secondary
 * with rich markdown, user bubbles right-aligned on --chat-user-bubble, a
 * small action row under each bubble (emoji/share/copy; user gets ⋯), group
 * timestamps ('8:27 AM') centered between message groups, and the three-dot
 * hatch-dot-pulse thinking indicator in a small gray bubble.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, ChevronDown, Copy, MoreHorizontal, Share, Smile } from "lucide-react";
import type { Entity, Prompt, Reply, State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { thinking, time } from "../view.ts";
import { ApprovalCard, BrowserCard, ConnectionCard, TaskCard } from "./cards";
import { RichText } from "./markdown";

type Message = Prompt | Reply;
type Thumb = ((id: string) => string) | null;

/** Messages render as bubbles; every other entity is a card. */
function EntityView({ entity, previous, thumb, actions }: { entity: Entity; previous: Entity | undefined; thumb: Thumb; actions: Actions }) {
  switch (entity.kind) {
    case "prompt":
    case "reply":
      return (
        <div className="flex flex-col gap-3">
          {previous?.kind !== entity.kind && <TimeDivider time={time(entity.at)} />}
          <MessageGroup item={entity} />
        </div>
      );
    case "task":
      return <TaskCard task={entity} actions={actions} />;
    case "approval":
      return <ApprovalCard approval={entity} actions={actions} />;
    case "connection":
      return <ConnectionCard connection={entity} actions={actions} />;
    case "browser":
      return <BrowserCard browser={entity} thumb={thumb} actions={actions} />;
  }
}

function ActionRow({ mine, text }: { mine: boolean; text: string }) {
  const copy = () => navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <div className="mt-1 flex items-center gap-0.5 px-1">
      {!mine ? (
        <button aria-label="React" className="hover-fade rounded-full p-1" style={{ color: "var(--icon-secondary)" }}>
          <Smile size={14} />
        </button>
      ) : (
        <button aria-label="More" className="hover-fade rounded-full p-1" style={{ color: "var(--icon-secondary)" }}>
          <MoreHorizontal size={14} />
        </button>
      )}
      <button aria-label="Share" className="hover-fade rounded-full p-1" style={{ color: "var(--icon-secondary)" }}>
        <Share size={13} />
      </button>
      <button aria-label="Copy" className="hover-fade rounded-full p-1" style={{ color: "var(--icon-secondary)" }} onClick={copy}>
        <Copy size={13} />
      </button>
    </div>
  );
}

function MessageGroup({ item }: { item: Message }) {
  const isUser = item.kind === "prompt";
  return (
    <div className={`anim-fade-in flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className="w-fit max-w-[78%] rounded-[22px] px-4 py-2.5 text-[15px] leading-snug"
        style={{
          background: isUser ? "var(--chat-user-bubble)" : "var(--fill-secondary)",
          color: isUser ? "var(--chat-user-text)" : "var(--chat-agent-text)",
        }}
      >
        {item.kind === "prompt" ? (
          item.text
        ) : (
          <div className={item.streaming ? "shimmer-text" : undefined}>
            <RichText text={item.text} />
          </div>
        )}
      </div>
      <ActionRow mine={isUser} text={item.text} />
    </div>
  );
}

function TimeDivider({ time }: { time: string }) {
  return (
    <div className="anim-fade-in flex justify-center py-1">
      <span className="text-[12px] font-medium" style={{ color: "var(--text-tertiary)" }}>
        {time}
      </span>
    </div>
  );
}

/** px from the bottom past which the jump-to-bottom button shows */
const JUMP_BUTTON_DISTANCE = 240;
/** px from the top within which older messages are fetched */
const OLDER_DISTANCE = 600;

interface Props {
  conversation: State;
  /** fetch the page before the oldest message held */
  older: () => Promise<void>;
  /** let go of pages fetched back */
  release: () => void;
  thumb: Thumb;
  actions: Actions;
}

export function ChatFeed({ conversation, older, release, thumb, actions }: Props) {
  const feed = conversation.entities;
  /** messages in the whole feed: what "new" is counted against, so pages fetched back are not new */
  const total = conversation.earlier + feed.length;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  /** far enough from the bottom to offer the jump button, new messages or not */
  const [far, setFar] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const seenRef = useRef(0);
  /**
   * The view sticks to the end while the user leaves it there: only their own scrolling
   * changes this, so content that grows (a streaming reply, a thumbnail loading) is followed.
   */
  const stick = useRef(true);
  /** a smooth scroll to the end is under way: the positions it passes through are not the user's */
  const gliding = useRef(false);

  const toEnd = (smooth: boolean) => {
    const el = scrollRef.current;
    if (!el) return;
    stick.current = true;
    setAtBottom(true);
    seenRef.current = total;
    setPendingCount(0);
    if (smooth) {
      gliding.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else el.scrollTop = el.scrollHeight;
  };
  const scrollToBottom = () => toEnd(true);

  // stuck to the end, it stays there whatever grows or shrinks: content, or the view (the keyboard)
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const follow = new ResizeObserver(() => {
      if (stick.current && !gliding.current) el.scrollTop = el.scrollHeight;
    });
    follow.observe(content);
    follow.observe(el);
    return () => follow.disconnect();
  }, []);
  /** the user's own hand on the scroll ends a glide: from then on, where they scroll counts */
  const handOn = () => {
    gliding.current = false;
  };

  /** Where the first message held sat before older ones went in above it, to put it back there. */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const fetching = useRef(false);
  const offset = (id: string) => {
    const el = scrollRef.current;
    const item = el?.querySelector(`[data-entity="${CSS.escape(id)}"]`);
    return el && item ? item.getBoundingClientRect().top - el.getBoundingClientRect().top : null;
  };
  const fetchOlder = () => {
    const el = scrollRef.current;
    const first = feed[0];
    if (!el || !first || conversation.earlier === 0 || fetching.current || el.scrollTop > OLDER_DISTANCE) return;
    const top = offset(first.id);
    if (top === null) return;
    fetching.current = true;
    anchor.current = { id: first.id, top };
    older().finally(() => (fetching.current = false));
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const held = anchor.current;
    if (!el || !held) return;
    anchor.current = null;
    const top = offset(held.id);
    if (top !== null) el.scrollTop += top - held.top;
  }, [conversation.earlier]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    fetchOlder();
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    setFar(distance > JUMP_BUTTON_DISTANCE);
    if (gliding.current) {
      if (distance < 2) gliding.current = false; // arrived
      return;
    }
    stick.current = near;
    setAtBottom(near);
    if (near) {
      seenRef.current = total;
      setPendingCount(0);
      release();
    }
  };

  const arrived = useRef(false);
  /** the newest message the user sent: sending one takes the view back to the end */
  const lastPrompt = useRef<string | null>(null);
  useEffect(() => {
    const newestPrompt = feed.findLast((e) => e.kind === "prompt")?.id ?? null;
    // The first content (the initial sync) lands at the bottom at once, like opening a chat.
    if (!arrived.current && feed.length > 0) {
      arrived.current = true;
      lastPrompt.current = newestPrompt;
      toEnd(false);
      return;
    }
    if (newestPrompt !== lastPrompt.current && feed.at(-1)?.id === newestPrompt) {
      lastPrompt.current = newestPrompt;
      toEnd(true); // the user just sent it
    } else if (stick.current) {
      // at the end: the view follows (the resize observer); pages fetched back can go
      seenRef.current = total;
      release();
    } else {
      // reading back: leave the view alone and count what is new for the jump-to-latest pill
      setPendingCount(Math.max(0, total - seenRef.current));
    }
    fetchOlder(); // the feed may not fill the screen yet
  }, [feed, conversation.activity]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={handOn}
        onTouchStart={handOn}
        onKeyDown={handOn}
        className="h-full overflow-y-auto px-4 pt-16 pb-28 chat-scroll-fade"
        style={{ background: "var(--chat-background)" }}
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3">
        {feed.map((entity, i) => (
          <div key={entity.id} data-entity={entity.id} className="flex flex-col">
            <EntityView entity={entity} previous={feed[i - 1]} thumb={thumb} actions={actions} />
          </div>
        ))}
        {thinking(conversation) && (
          <div className="anim-fade-in flex justify-start">
            <div
              className="flex w-fit items-center gap-1.5 rounded-[22px] px-4 py-3.5"
              style={{ background: "var(--fill-secondary)" }}
              aria-label="Muse is thinking"
            >
              {[0, 1, 2].map((i) => (
                <span key={i} className="hatch-dot" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </div>
          </div>
        )}
      </div>
      {/* Jump-to-bottom: a plain down-arrow button while far from the bottom;
          "N messages" pill (Muse ref 09-waiting) when new ones arrived. */}
      {(far || pendingCount > 0) && !atBottom &&
        (pendingCount > 0 ? (
          <button
            className="absolute bottom-[86px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full py-1.5 pl-3 pr-2 text-[12px] font-semibold"
            style={{ background: "var(--chat-user-bubble)", color: "var(--chat-user-text)", boxShadow: "var(--shadow-float)" }}
            onClick={scrollToBottom}
          >
            {pendingCount} {pendingCount === 1 ? "message" : "messages"}
            <ChevronDown size={14} />
          </button>
        ) : (
          <button
            aria-label="Scroll to bottom"
            className="absolute bottom-[86px] left-1/2 z-30 flex size-9 -translate-x-1/2 items-center justify-center rounded-full"
            style={{ background: "var(--fill-primary)", color: "var(--icon-primary)", boxShadow: "var(--shadow-float)" }}
            onClick={scrollToBottom}
          >
            <ArrowDown size={18} />
          </button>
        ))}
      {/* Muse-style scroll fade: a mask dissolves the content itself under the
          floating top bar and composer — no solid overlay sits on top. */}
      </div>
    </div>
  );
}
