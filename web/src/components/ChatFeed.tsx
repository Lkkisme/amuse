/**
 * Main chat feed: user bubbles right-aligned on --chat-user-bubble, agent
 * bubbles on --chat-agent-bubble, inline cards dispatched by kind.
 */
import { useEffect, useRef } from "react";
import type { DemoState, FeedItem } from "../data/fakeMuse";
import type { MuseActions } from "./actions";
import { ApprovalCard, BrowserCard, ConnReqCard, TaskCard } from "./cards";

function FeedEntry({ item, actions }: { item: FeedItem; actions: MuseActions }) {
  if (item.role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[78%] rounded-[22px] px-4 py-2.5 text-[15px] leading-snug"
          style={{ background: "var(--chat-user-bubble)", color: "var(--chat-user-text)" }}
        >
          {item.text}
        </div>
      </div>
    );
  }
  if (item.role === "agent") {
    return (
      <div className="flex justify-start">
        <div
          className="max-w-[78%] rounded-[22px] px-4 py-2.5 text-[15px] leading-snug"
          style={{ background: "var(--chat-agent-bubble)", color: "var(--chat-agent-text)" }}
        >
          {item.text}
        </div>
      </div>
    );
  }
  switch (item.kind) {
    case "task":
      return <TaskCard task={item.task} actions={actions} />;
    case "approval":
      return <ApprovalCard approval={item.approval} actions={actions} />;
    case "connreq":
      return <ConnReqCard connreq={item.connreq} actions={actions} />;
    case "browser":
      return <BrowserCard browser={item.browser} actions={actions} />;
  }
}

export function ChatFeed({ state, actions }: { state: DemoState; actions: MuseActions }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.feed.length, state.assistantThinking]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3" style={{ background: "var(--chat-background)" }}>
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {state.feed.map((item) => (
          <FeedEntry key={item.id} item={item} actions={actions} />
        ))}
        {state.assistantThinking && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-1.5 rounded-[22px] px-4 py-3"
              style={{ background: "var(--chat-agent-bubble)" }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="size-1.5 animate-bounce rounded-full"
                  style={{ background: "var(--text-tertiary)", animationDelay: `${i * 150}ms` }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
