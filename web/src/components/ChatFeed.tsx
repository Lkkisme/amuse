/**
 * Main chat feed, 1:1 with Muse: fit-content agent bubbles on --fill-secondary
 * with rich markdown, user bubbles right-aligned on --chat-user-bubble, a
 * small action row under each bubble (emoji/share/copy; user gets ⋯), group
 * timestamps ('8:27 AM') centered between message groups, and the three-dot
 * hatch-dot-pulse thinking indicator in a small gray bubble.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ChevronDown, Copy, Share } from "lucide-react";
import type { Entity, Prompt, Reply, State } from "@remuse/protocol";
import type { Actions } from "../ui.ts";
import { thinking, time } from "../view.ts";
import { ApprovalCard, BrowserCard, ConnectionCard, InstructionCard, QuestionCard, ScheduleCard, TaskCard } from "./cards";
import { RichText } from "./markdown";
import { type Place, type Side, corners } from "./shape.ts";

type Message = Prompt | Reply;
type Thumb = ((id: string) => string) | null;

/** Messages this close together, from the same side, read as one group (Muse). */
const GROUP_GAP_MS = 5 * 60_000;
/** Who an entity comes from: the user's messages, or Muse (its replies and every card). */
const side = (e: Entity): Side => (e.kind === "prompt" ? "user" : "muse");
const joins = (a: Entity | undefined, b: Entity | undefined): boolean =>
  !!a && !!b && side(a) === side(b) && Date.parse(b.at) - Date.parse(a.at) < GROUP_GAP_MS;
const isMessage = (e: Entity | undefined) => e?.kind === "prompt" || e?.kind === "reply";

/** A time line goes in only after a pause this long (and before the first item). */
const STAMP_GAP_MS = 10 * 60_000;
const stamped = (previous: Entity | undefined, entity: Entity) => !previous || Date.parse(entity.at) - Date.parse(previous.at) > STAMP_GAP_MS;


/** Messages render as bubbles; every other entity is a card. */
function EntityView({ entity, place, thumb, actions, onMenu }: { entity: Entity; place: Place; thumb: Thumb; actions: Actions; onMenu: (menu: Menu) => void }) {
  switch (entity.kind) {
    case "prompt":
    case "reply":
      return <Bubble item={entity} place={place} onMenu={onMenu} />;
    case "task":
      return <TaskCard task={entity} place={place} actions={actions} />;
    case "approval":
      return <ApprovalCard approval={entity} place={place} actions={actions} />;
    case "connection":
      return <ConnectionCard connection={entity} place={place} actions={actions} />;
    case "browser":
      return <BrowserCard browser={entity} thumb={thumb} place={place} actions={actions} />;
    case "schedule":
      return <ScheduleCard schedule={entity} place={place} actions={actions} />;
    case "instruction":
      return <InstructionCard instruction={entity} place={place} />;
    case "question":
      return <QuestionCard question={entity} place={place} />;
  }
}

/** What can be done with a message's text: copy it, or share it where the system can. */
const copyText = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});
const canShare = () => typeof navigator.share === "function";
const shareText = (text: string) => void navigator.share?.({ text }).catch(() => {});

/** Desktop: a message's actions, beside its bubble while the pointer is on it or its side (index.css: .msg-actions). */
function ActionRow({ mine, text }: { mine: boolean; text: string }) {
  return (
    <div className={`msg-actions ${mine ? "msg-actions-mine" : ""} flex items-center gap-0.5`}>
      {canShare() && (
        <button aria-label="Share" className="hover-fade rounded-full p-1.5" style={{ color: "var(--icon-secondary)" }} onClick={() => shareText(text)}>
          <Share size={16} />
        </button>
      )}
      <button aria-label="Copy" className="hover-fade rounded-full p-1.5" style={{ color: "var(--icon-secondary)" }} onClick={() => copyText(text)}>
        <Copy size={16} />
      </button>
    </div>
  );
}

/** A message's long-press menu, and the bubble it came from (where it sits on screen). */
type Menu = { message: Message; at: DOMRect };

const MENU_WIDTH = 288;
const MARGIN = 12;

/**
 * Touch: a long press on a bubble opens this (Muse): a card over the bubble, from its sender's
 * side, kept on screen; when it was said, and what can be done with it. A tap elsewhere closes it.
 */
function MessageMenu({ menu, onClose }: { menu: Menu | null; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => setHeight(card.current?.offsetHeight ?? 0), [menu]);
  if (!menu) return null;
  const { message, at } = menu;
  const mine = message.kind === "prompt";
  const left = Math.min(Math.max(MARGIN, mine ? at.right - MENU_WIDTH : at.left), innerWidth - MENU_WIDTH - MARGIN);
  const top = Math.min(Math.max(MARGIN, at.top + 10), innerHeight - height - MARGIN);
  const act = (fn: (text: string) => void) => () => {
    fn(message.text);
    onClose();
  };
  const row = "hover-fade flex h-12 w-full items-center gap-3 rounded-xl px-3 text-[16px]";
  return (
    <div className="fixed inset-0 z-[80]" onClick={onClose}>
      <div
        ref={card}
        role="menu"
        className="anim-popover-in absolute rounded-[22px] px-3 pb-2 pt-3"
        style={{
          left,
          top,
          width: MENU_WIDTH,
          transformOrigin: mine ? "top right" : "top left",
          background: "var(--fill-primary)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
          {`${sameDay(message.at) ? "Today" : new Date(message.at).toLocaleDateString()} at ${time(message.at)}`}
        </p>
        <div className="mt-2 border-t pt-1" style={{ borderColor: "var(--fill-divider)" }}>
          {canShare() && (
            <button role="menuitem" className={row} style={{ color: "var(--text-primary)" }} onClick={act(shareText)}>
              <Share size={18} /> Share
            </button>
          )}
          <button role="menuitem" className={row} style={{ color: "var(--text-primary)" }} onClick={act(copyText)}>
            <Copy size={18} /> Copy
          </button>
        </div>
      </div>
    </div>
  );
}

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

/** Long press: held this long without moving. */
const PRESS_MS = 450;
function useLongPress(onPress: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const cancel = () => clearTimeout(timer.current);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        onPress();
        // lifting the finger clicks where it is, which is now the menu's backdrop: that click is the press's own
        const swallow = (click: MouseEvent) => {
          click.stopPropagation();
          click.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 600);
      }, PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      if (timer.current !== undefined && matchMedia("(hover: none)").matches) e.preventDefault();
    },
  };
}

function Bubble({ item, place, onMenu }: { item: Message; place: Place; onMenu: (menu: Menu) => void }) {
  const isUser = item.kind === "prompt";
  const bubble = useRef<HTMLDivElement>(null);
  const press = useLongPress(() => {
    const at = bubble.current?.getBoundingClientRect();
    if (at) onMenu({ message: item, at });
  });
  return (
    <div className={`anim-fade-in flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        {...press}
        ref={bubble}
        // Muse (measured): 16px text on 22px lines, 10px above and below, 16px at the sides
        className="msg relative w-fit max-w-[78%] px-4 py-2.5 text-[16px] leading-[22px]"
        style={{
          ...corners(isUser ? "user" : "muse", place),
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
        <ActionRow mine={isUser} text={item.text} />
      </div>
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
  // a reply that ended with nothing to read (a model's stray line breaks before a tool call) is not shown
  const feed = useMemo(() => conversation.entities.filter((e) => e.kind !== "reply" || e.streaming || e.text.trim() !== ""), [conversation.entities]);
  /** messages in the whole feed: what "new" is counted against, so pages fetched back are not new */
  const total = conversation.earlier + conversation.entities.length;
  /** the message whose long-press menu is open (touch) */
  const [menu, setMenu] = useState<Menu | null>(null);
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
    if (!smooth) {
      el.scrollTop = el.scrollHeight;
      return;
    }
    gliding.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    // the glide aims where the end was; once it settles, land on where the end is now (content may have grown)
    const land = () => {
      el.removeEventListener("scrollend", land);
      clearTimeout(fallback);
      gliding.current = false;
      if (stick.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("scrollend", land);
    const fallback = setTimeout(land, 800); // where scrollend is not fired
  };
  const scrollToBottom = () => toEnd(true);

  // stuck to the end, it stays there whatever grows or shrinks: content, or the view (the keyboard)
  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const follow = new ResizeObserver(() => {
      if (!stick.current) return;
      if (gliding.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); // keep the glide aimed at the end
      else el.scrollTop = el.scrollHeight;
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
    if (gliding.current) return; // positions a glide passes through are not the user's
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
          // joining the one above: 2px under it between bubbles, 4px where a card is involved (the feed's gap is 12px)
          <div
            key={entity.id}
            data-entity={entity.id}
            className={`flex flex-col gap-3 ${joins(feed[i - 1], entity) ? (isMessage(entity) && isMessage(feed[i - 1]) ? "-mt-2.5" : "-mt-2") : ""}`}
          >
            {stamped(feed[i - 1], entity) && <TimeDivider time={time(entity.at)} />}
            <EntityView entity={entity} place={{ joinsPrevious: joins(feed[i - 1], entity), joinsNext: joins(entity, feed[i + 1]) }} thumb={thumb} actions={actions} onMenu={setMenu} />
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
      <MessageMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
