/**
 * Main chat feed, 1:1 with Muse: fit-content agent bubbles on --fill-secondary
 * with rich markdown, user bubbles right-aligned on --chat-user-bubble, a
 * small action row under each bubble (emoji/share/copy; user gets ⋯), group
 * timestamps ('8:27 AM') centered between message groups, and the three-dot
 * hatch-dot-pulse thinking indicator in a small gray bubble.
 */
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronDown, Copy, MoreHorizontal, Share, Smile } from "lucide-react";
import type { Entity, Prompt, Reply, State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { thinking, time } from "../view.ts";
import { ApprovalCard, BrowserCard, ConnectionCard, TaskCard } from "./cards";
import { RichText } from "./markdown";

type Message = Prompt | Reply;

/** Messages render as bubbles; every other entity is a card. */
function EntityView({ entity, previous, actions }: { entity: Entity; previous: Entity | undefined; actions: Actions }) {
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
      return <BrowserCard browser={entity} actions={actions} />;
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

export function ChatFeed({ conversation, actions }: { conversation: State; actions: Actions }) {
  const feed = conversation.entities;
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  /** far enough from the bottom to offer the jump button, new messages or not */
  const [far, setFar] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const seenRef = useRef(feed.length);
  const atBottomRef = useRef(true);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    atBottomRef.current = true;
    setAtBottom(true);
    seenRef.current = feed.length;
    setPendingCount(0);
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distance < 80;
    setFar(distance > JUMP_BUTTON_DISTANCE);
    if (near !== atBottomRef.current) {
      atBottomRef.current = near;
      setAtBottom(near);
    }
    if (near) {
      seenRef.current = feed.length;
      setPendingCount(0);
    }
  };

  useEffect(() => {
    // New content: follow it only when the user is already at the bottom.
    // Otherwise leave the scroll position alone and surface a jump-to-latest pill.
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      seenRef.current = feed.length;
    } else {
      setPendingCount(Math.max(0, feed.length - seenRef.current));
    }
  }, [feed, conversation.activity]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto px-4 pt-16 pb-28 chat-scroll-fade"
        style={{ background: "var(--chat-background)" }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {feed.map((entity, i) => (
          <EntityView key={entity.id} entity={entity} previous={feed[i - 1]} actions={actions} />
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
        <div ref={bottomRef} />
      </div>
      {/* Jump-to-bottom: a plain down-arrow button while far from the bottom;
          "N messages" pill (Muse ref 09-waiting) when new ones arrived. */}
      {(far || pendingCount > 0) && !atBottom &&
        (pendingCount > 0 ? (
          <button
            className="absolute bottom-[86px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full py-1.5 pl-3 pr-2 text-[12px] font-semibold"
            style={{ background: "var(--chat-user-bubble)", color: "var(--chat-user-text)", boxShadow: "0 1px 6px rgba(0,0,0,0.10)" }}
            onClick={scrollToBottom}
          >
            {pendingCount} {pendingCount === 1 ? "message" : "messages"}
            <ChevronDown size={14} />
          </button>
        ) : (
          <button
            aria-label="Scroll to bottom"
            className="absolute bottom-[86px] left-1/2 z-30 flex size-9 -translate-x-1/2 items-center justify-center rounded-full"
            style={{ background: "var(--fill-primary)", color: "var(--icon-primary)", boxShadow: "0 1px 6px rgba(0,0,0,0.12)" }}
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
