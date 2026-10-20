/**
 * Main chat feed, 1:1 with Muse: fit-content agent bubbles on --fill-secondary
 * with rich markdown, user bubbles right-aligned on --chat-user-bubble, a
 * small action row under each bubble (emoji/share/copy; user gets ⋯), group
 * timestamps ('8:27 AM') centered between message groups, and the three-dot
 * hatch-dot-pulse thinking indicator in a small gray bubble.
 */
import { useEffect, useRef } from "react";
import { Copy, MoreHorizontal, Share, Smile } from "lucide-react";
import type { DemoState, FeedItem } from "../data/fakeMuse";
import type { MuseActions } from "./actions";
import { ApprovalCard, BrowserCard, ConnReqCard, TaskCard } from "./cards";
import { RichText } from "./markdown";

function isMsg(item: FeedItem): item is Extract<FeedItem, { role: "user" | "agent" }> {
  return item.role === "user" || item.role === "agent";
}

function ActionRow({ role, text }: { role: "user" | "agent"; text: string }) {
  const copy = () => navigator.clipboard?.writeText(text).catch(() => {});
  return (
    <div className="mt-1 flex items-center gap-0.5 px-1">
      {role === "agent" ? (
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

function MessageGroup({ item }: { item: Extract<FeedItem, { role: "user" | "agent" }> }) {
  const isUser = item.role === "user";
  return (
    <div className={`anim-fade-in flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className="w-fit max-w-[78%] rounded-[22px] px-4 py-2.5 text-[15px] leading-snug"
        style={{
          background: isUser ? "var(--chat-user-bubble)" : "var(--fill-secondary)",
          color: isUser ? "var(--chat-user-text)" : "var(--chat-agent-text)",
        }}
      >
        {isUser ? (
          item.text
        ) : (
          <div className={item.streaming ? "shimmer-text" : undefined}>
            <RichText text={item.text} />
          </div>
        )}
      </div>
      <ActionRow role={item.role} text={item.text} />
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

export function ChatFeed({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.feed.length, state.assistantThinking, state.feed]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "var(--chat-background)" }}>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {state.feed.map((item, idx) => {
          if (!isMsg(item)) {
            switch (item.kind) {
              case "task":
                return <TaskCard key={item.id} task={item.task} actions={actions} />;
              case "approval":
                return <ApprovalCard key={item.id} approval={item.approval} actions={actions} />;
              case "connreq":
                return <ConnReqCard key={item.id} connreq={item.connreq} actions={actions} />;
              case "browser":
                return <BrowserCard key={item.id} browser={item.browser} actions={actions} />;
            }
          }
          const prev = state.feed[idx - 1];
          const newGroup = !prev || !isMsg(prev) || prev.role !== item.role;
          return (
            <div key={item.id} className="flex flex-col gap-3">
              {newGroup && <TimeDivider time={item.time} />}
              <MessageGroup item={item} />
            </div>
          );
        })}
        {state.assistantThinking && (
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
    </div>
  );
}
