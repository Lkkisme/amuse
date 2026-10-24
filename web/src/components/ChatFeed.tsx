/**
 * Main chat feed, 1:1 with Muse: fit-content agent bubbles on --fill-secondary
 * with rich markdown, user bubbles right-aligned on --chat-user-bubble, a
 * small action row under each bubble (emoji/share/copy; user gets ⋯), group
 * timestamps ('8:27 AM') centered between message groups, and the three-dot
 * hatch-dot-pulse thinking indicator in a small gray bubble.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ChevronDown,
  Copy,
  File as FileIcon,
  Share,
} from "lucide-react";
import type { Attachment, Entity, Prompt, Reply, State } from "@amuse/protocol";
import { size } from "@amuse/core";
import { useFiles } from "../files.ts";
import type { Actions } from "../ui.ts";
import { useT } from "../i18n/react.ts";
import { thinking, time } from "../view.ts";
import {
  ApprovalCard,
  BrowserCard,
  ConnectionCard,
  SecretCard,
  FailureCard,
  ScheduleCard,
  TaskCard,
} from "./cards";
import { RichText, linked } from "./markdown";
import { type Place, type Side, corners } from "./shape.ts";

type Message = Prompt | Reply;
type Thumb = ((id: string) => string) | null;

/** Messages this close together, from the same side, read as one group (Muse). */
const GROUP_GAP_MS = 5 * 60_000;
/** Who an entity comes from: the user's messages, or Muse (its replies and every card). */
const side = (e: Entity): Side => (e.kind === "prompt" ? "user" : "muse");
const joins = (a: Entity | undefined, b: Entity | undefined): boolean =>
  !!a &&
  !!b &&
  side(a) === side(b) &&
  Date.parse(b.at) - Date.parse(a.at) < GROUP_GAP_MS;

/** A time line goes in only after a pause this long (and before the first item). */
const STAMP_GAP_MS = 10 * 60_000;
const stamped = (previous: Entity | undefined, entity: Entity) =>
  !previous || Date.parse(entity.at) - Date.parse(previous.at) > STAMP_GAP_MS;

/**
 * What the chat shows. Not Muse's exchanges with its background runs: those
 * are between the agents (Muse tells the user what matters in its own words).
 * Not a reply that ended with nothing to read (a model's stray line breaks
 * before a tool call).
 */
function shown(entity: Entity): boolean {
  switch (entity.kind) {
    case "instruction":
    case "question":
      return false;
    case "reply":
      return (
        entity.streaming ||
        entity.text.trim() !== "" ||
        entity.attachments.length > 0
      );
    // one every instance starts with was not asked for here: it is in Settings › Schedules; one that is over
    // (cancelled, or done) is a record, not shown (Amuse still knows of it)
    case "schedule":
      return (
        !entity.preset &&
        entity.status !== "cancelled" &&
        entity.status !== "done"
      );
    // one refused by the user's own rule was never a card: it is in the Approvals list, and Amuse says so in a line
    case "approval":
      return !entity.byRule;
    case "prompt":
    case "task":
    case "connection":
    case "secret":
    case "browser":
    case "failure":
      return true;
  }
}

/** Messages render as bubbles; every other entity is a card. */
function EntityView({
  entity,
  place,
  thumb,
  actions,
  onMenu,
  sending,
}: {
  entity: Entity;
  place: Place;
  thumb: Thumb;
  actions: Actions;
  onMenu: (menu: Menu) => void;
  /** a message of the user's still on its way */
  sending: boolean;
}) {
  switch (entity.kind) {
    case "prompt":
    case "reply":
      return (
        <Bubble item={entity} place={place} onMenu={onMenu} sending={sending} />
      );
    case "task":
      return <TaskCard task={entity} place={place} actions={actions} />;
    case "approval":
      return <ApprovalCard approval={entity} place={place} actions={actions} />;
    case "connection":
      return (
        <ConnectionCard connection={entity} place={place} actions={actions} />
      );
    case "secret":
      return <SecretCard secret={entity} place={place} actions={actions} />;
    case "browser":
      return (
        <BrowserCard
          browser={entity}
          thumb={thumb}
          place={place}
          actions={actions}
        />
      );
    case "schedule":
      return <ScheduleCard schedule={entity} place={place} actions={actions} />;
    case "failure":
      return <FailureCard failure={entity} place={place} actions={actions} />;
    case "instruction":
    case "question":
      return null; // between the agents (see `shown`)
  }
}

/** What can be done with a message's text: copy it, or share it where the system can. */
const copyText = (text: string) =>
  void navigator.clipboard?.writeText(text).catch(() => {});
const canShare = () => typeof navigator.share === "function";
const shareText = (text: string) =>
  void navigator.share?.({ text }).catch(() => {});

/** Desktop: a message's actions, beside its bubble while the pointer is on it or its side (index.css: .msg-actions). */
function ActionRow({ mine, text }: { mine: boolean; text: string }) {
  const t = useT();
  return (
    <div
      className={`msg-actions ${mine ? "msg-actions-mine" : "msg-actions-wide"} flex items-center gap-0.5`}
    >
      {canShare() && (
        <button
          aria-label={t.chat.share}
          className="hover-fade rounded-full p-1.5"
          style={{ color: "var(--icon-secondary)" }}
          onClick={() => shareText(text)}
        >
          <Share size={16} />
        </button>
      )}
      <button
        aria-label={t.chat.copy}
        className="hover-fade rounded-full p-1.5"
        style={{ color: "var(--icon-secondary)" }}
        onClick={() => copyText(text)}
      >
        <Copy size={16} />
      </button>
    </div>
  );
}

/** A tapped message: where the finger was, and its bubble (where it sits on screen). */
type Menu = {
  message: Message;
  point: { x: number; y: number };
  bubble: HTMLElement;
};

const MENU_WIDTH = 176;
const MARGIN = 12;

/**
 * Touch: a tap on a bubble opens this: a card over the bubble (above it, else below), from its
 * sender's side, kept on screen; what can be done with it. A tap elsewhere closes it. A long press
 * is the phone's own: it selects words, with the phone's handles and its copy button.
 */
function MessageMenu({
  menu,
  onClose,
}: {
  menu: Menu | null;
  onClose: () => void;
}) {
  const t = useT();
  const card = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => setHeight(card.current?.offsetHeight ?? 0), [menu]);
  if (!menu) return null;
  const { message, point, bubble } = menu;
  // over the bubble, not on its selected words: above it, else below it, from the side of whoever said it;
  // a bubble too tall for either has it where the finger was
  const rect = bubble.getBoundingClientRect();
  const mine = message.kind === "prompt";
  const fits = (y: number) => y >= MARGIN && y + height <= innerHeight - MARGIN;
  const above = rect.top - 8 - height;
  const under = rect.bottom + 8;
  const top = fits(above)
    ? above
    : fits(under)
      ? under
      : Math.max(MARGIN, Math.min(point.y + 8, innerHeight - MARGIN - height));
  const left = Math.min(
    Math.max(MARGIN, mine ? rect.right - MENU_WIDTH : rect.left),
    innerWidth - MENU_WIDTH - MARGIN,
  );
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const row =
    "hover-fade flex h-11 w-full items-center gap-3 rounded-[12px] px-3 text-[15px]";
  return (
    // a press held on the menu is no selection of its words
    <div
      className="fixed inset-0 z-[80] select-none [-webkit-touch-callout:none]"
      onClick={onClose}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={card}
        role="menu"
        className="anim-popover-in absolute rounded-[18px] p-1.5"
        style={{
          left,
          top,
          width: MENU_WIDTH,
          transformOrigin: `${point.x - left}px ${point.y - top}px`,
          background: "var(--fill-primary)",
          boxShadow: "var(--shadow-sheet)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          role="menuitem"
          className={row}
          style={{ color: "var(--text-primary)" }}
          onClick={act(() => copyText(message.text))}
        >
          <Copy size={18} /> {t.chat.copy}
        </button>
        {canShare() && (
          <button
            role="menuitem"
            className={row}
            style={{ color: "var(--text-primary)" }}
            onClick={act(() => shareText(message.text))}
          >
            <Share size={18} /> {t.chat.share}
          </button>
        )}
      </div>
    </div>
  );
}

/** Files sent with a message, above its words: images and videos shown, anything else as a file to open or download. */
function Sent({
  attachments,
  mine,
}: {
  attachments: Attachment[];
  mine: boolean;
}) {
  const shown = (a: Attachment) =>
    /^image\/(png|jpeg|gif|webp|avif)$/.test(a.type) || /^video\//.test(a.type);
  const media = attachments.filter(shown);
  const others = attachments.filter((a) => !shown(a));
  const single = media.length === 1;
  return (
    <div
      className={`flex max-w-[88%] sm:max-w-[78%] flex-col gap-1.5 ${mine ? "items-end" : "items-start"}`}
    >
      {media.length > 0 && (
        <div className={single ? "" : "grid grid-cols-2 gap-1.5"}>
          {media.map((a) => (
            <Media key={a.id} file={a} single={single} />
          ))}
        </div>
      )}
      {others.map((a) => (
        <FileCard key={a.id} file={a} gone={false} />
      ))}
    </div>
  );
}

/** A picture or video; once its file is gone from the workspace, a card saying so. */
function Media({ file, single }: { file: Attachment; single: boolean }) {
  const t = useT();
  const files = useFiles();
  const [gone, setGone] = useState(false);
  if (gone) return <FileCard file={file} gone />;
  const fit = single ? "max-h-[360px] max-w-full" : "size-36 object-cover";
  if (file.type.startsWith("video/"))
    return (
      <video
        src={files?.url(file.id)}
        controls
        playsInline
        preload="metadata"
        aria-label={file.name}
        onError={() => setGone(true)}
        className={`rounded-[18px] ${fit}`}
        style={{ background: "var(--fill-secondary)" }}
      />
    );
  return (
    <a
      href={files?.url(file.id)}
      target="_blank"
      rel="noreferrer"
      aria-label={t.chat.openFile(file.name)}
    >
      <img
        src={files?.url(file.id)}
        alt={file.name}
        loading="lazy"
        onError={() => setGone(true)}
        className={`rounded-[18px] object-cover ${fit}`}
        style={{ background: "var(--fill-secondary)" }}
      />
    </a>
  );
}

/** A file as a card: its name and size, to open or download; or that it was deleted. */
function FileCard({ file, gone }: { file: Attachment; gone: boolean }) {
  const t = useT();
  const files = useFiles();
  const body = (
    <>
      <FileIcon size={20} style={{ color: "var(--icon-secondary)" }} />
      <span className="min-w-0">
        <span
          className={`block truncate text-[14px] font-medium ${gone ? "line-through" : ""}`}
          style={{
            color: gone ? "var(--text-secondary)" : "var(--text-primary)",
          }}
        >
          {file.name}
        </span>
        <span
          className="block text-[12px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {gone ? t.chat.deleted : size(file.size)}
        </span>
      </span>
    </>
  );
  const look =
    "flex max-w-full items-center gap-2.5 rounded-[18px] px-3.5 py-2.5";
  if (gone || !files)
    return (
      <div className={look} style={{ background: "var(--fill-secondary)" }}>
        {body}
      </div>
    );
  return (
    <a
      href={files.url(file.id)}
      download={file.name}
      className={`hover-fade ${look}`}
      style={{ background: "var(--fill-secondary)" }}
    >
      {body}
    </a>
  );
}

function Bubble({
  item,
  place,
  onMenu,
  sending,
}: {
  item: Message;
  place: Place;
  onMenu: (menu: Menu) => void;
  sending: boolean;
}) {
  const t = useT();
  const isUser = item.kind === "prompt";
  const bubble = useRef<HTMLDivElement>(null);
  /** A tap (touch only: with a mouse, the row under the bubble has these) opens the menu; not one on a link, nor one ending a selection. */
  const tap = (e: React.MouseEvent) => {
    if (!matchMedia("(hover: none)").matches || !bubble.current) return;
    if (
      e.target instanceof Element &&
      e.target.closest("a, button, img, video")
    )
      return;
    if (getSelection()?.isCollapsed === false) return;
    onMenu({
      message: item,
      point: { x: e.clientX, y: e.clientY },
      bubble: bubble.current,
    });
  };
  const { attachments } = item;
  return (
    <div
      className={`anim-fade-in flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"} transition-opacity ${sending ? "opacity-60" : ""}`}
    >
      {attachments.length > 0 && (
        <Sent attachments={attachments} mine={isUser} />
      )}
      {(item.text !== "" || attachments.length === 0) && (
        <div
          onClick={tap}
          ref={bubble}
          // 16px text on 22px lines; 12px above and below (15px to the eye, with the leading) to 20px at the sides, 4:3;
          // a line is 46px high, a pill with the 22px corners
          // a long run with no space (a web address) breaks where it must, inside the bubble
          // the user's fits its words, to a share of the column; Amuse's fits them too, up to the whole column
          className={`msg relative px-5 py-3 text-[16px] leading-[22px] [overflow-wrap:anywhere] ${isUser ? "w-fit max-w-[88%] sm:max-w-[78%]" : "w-fit max-w-full"}`}
          style={{
            ...corners(isUser ? "user" : "muse", place),
            background: isUser
              ? "var(--chat-user-bubble)"
              : "var(--fill-secondary)",
            color: isUser ? "var(--chat-user-text)" : "var(--chat-agent-text)",
          }}
        >
          {item.kind === "prompt" ? (
            <span data-words>{linked(item.text, item.id, true)}</span>
          ) : (
            <div
              data-words
              className={item.streaming ? "shimmer-text" : undefined}
            >
              <RichText text={item.text} />
            </div>
          )}
          <ActionRow mine={isUser} text={item.text} />
        </div>
      )}
      {sending && (
        <span
          className="activity-indicator-fade px-1 text-[12px]"
          style={{ color: "var(--text-tertiary)" }}
        >
          {t.chat.sending}
        </span>
      )}
    </div>
  );
}

function TimeDivider({ time }: { time: string }) {
  return (
    <div className="anim-fade-in flex justify-center py-1">
      <span
        className="text-[12px] font-medium"
        style={{ color: "var(--text-tertiary)" }}
      >
        {time}
      </span>
    </div>
  );
}

/** px from the bottom past which the jump-to-bottom button shows */
/** how long after the user's own touch a scroll counts as theirs (momentum runs on a while) */
const USER_SCROLL_MS = 1500;
const JUMP_BUTTON_DISTANCE = 240;
/** px from the top within which older messages are fetched */
const OLDER_DISTANCE = 600;

interface Props {
  conversation: State;
  /** messages on their way (outgoing.ts): those not on the server yet, and the keys theirs keep once there */
  outgoing: { sending: Prompt[]; keys: Map<string, string> };
  /** fetch the page before the oldest message held */
  older: () => Promise<void>;
  /** let go of pages fetched back */
  release: () => void;
  thumb: Thumb;
  actions: Actions;
}

export function ChatFeed({
  conversation,
  outgoing,
  older,
  release,
  thumb,
  actions,
}: Props) {
  const t = useT();
  // what is on its way goes at the end, as it will be once the server has it
  const feed = useMemo(
    () => [...conversation.entities.filter(shown), ...outgoing.sending],
    [conversation.entities, outgoing.sending],
  );
  const sending = useMemo(
    () => new Set(outgoing.sending.map((p) => p.id)),
    [outgoing.sending],
  );
  /** messages in the whole feed: what "new" is counted against, so pages fetched back are not new */
  const total = conversation.earlier + conversation.entities.length;
  /** the message whose menu is open (touch: tapped) */
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
    // the fades spare the scrollbar (index.css, and the composer's): how wide it is now (none where it floats, or before
    // there is anything to scroll); on the root, where the composer reads it too
    const bar = () =>
      document.documentElement.style.setProperty(
        "--chat-scrollbar",
        `${el.offsetWidth - el.clientWidth}px`,
      );
    bar();
    const follow = new ResizeObserver(() => {
      bar();
      if (!stick.current) return;
      if (gliding.current)
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }); // keep the glide aimed at the end
      else el.scrollTop = el.scrollHeight;
    });
    follow.observe(content);
    follow.observe(el);
    return () => follow.disconnect();
  }, []);
  /** the user's own hand on the scroll ends a glide: from then on, where they scroll counts */
  const handOn = () => {
    gliding.current = false;
    handled.current = Date.now();
  };
  /** when the user last touched the scroll (wheel, touch, keys, the scrollbar): a scroll long after is not theirs */
  const handled = useRef(0);

  /** Where the first message held sat before older ones went in above it, to put it back there. */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const fetching = useRef(false);
  const offset = (id: string) => {
    const el = scrollRef.current;
    const item = el?.querySelector(`[data-entity="${CSS.escape(id)}"]`);
    return el && item
      ? item.getBoundingClientRect().top - el.getBoundingClientRect().top
      : null;
  };
  const fetchOlder = () => {
    const el = scrollRef.current;
    const first = feed[0];
    if (
      !el ||
      !first ||
      conversation.earlier === 0 ||
      fetching.current ||
      el.scrollTop > OLDER_DISTANCE
    )
      return;
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
    // a scroll the user did not make (the page laid out anew as cards arrived) does not unstick the view
    if (
      !near &&
      stick.current &&
      Date.now() - handled.current > USER_SCROLL_MS
    ) {
      el.scrollTop = el.scrollHeight;
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
    if (
      newestPrompt !== lastPrompt.current &&
      feed.at(-1)?.id === newestPrompt
    ) {
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
        onTouchMove={handOn}
        onKeyDown={handOn}
        onPointerDown={handOn}
        className="h-full overflow-y-auto px-4 pt-16 pb-28 chat-scroll-fade"
        // no scroll anchoring: it moves the view when cards arrive above the end, and the view would think the user scrolled
        style={{ background: "var(--chat-background)", overflowAnchor: "none" }}
      >
        <div ref={contentRef} className="mx-auto flex max-w-3xl flex-col gap-3">
          {feed.map((entity, i) => (
            // joining the one above: 4px under it, bubble or card alike (the feed's gap is 12px)
            <div
              key={outgoing.keys.get(entity.id) ?? entity.id}
              data-entity={entity.id}
              className={`flex flex-col gap-3 ${joins(feed[i - 1], entity) ? "-mt-2" : ""}`}
            >
              {stamped(feed[i - 1], entity) && (
                <TimeDivider time={time(entity.at)} />
              )}
              <EntityView
                entity={entity}
                place={{
                  joinsPrevious: joins(feed[i - 1], entity),
                  joinsNext: joins(entity, feed[i + 1]),
                }}
                thumb={thumb}
                actions={actions}
                onMenu={setMenu}
                sending={sending.has(entity.id)}
              />
            </div>
          ))}
          {thinking(conversation) && (
            <div className="anim-fade-in flex justify-start">
              <div
                className="flex w-fit items-center gap-1.5 rounded-[22px] px-4 py-3.5"
                style={{ background: "var(--fill-secondary)" }}
                aria-label={t.chat.thinking}
              >
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="hatch-dot"
                    style={{ animationDelay: `${i * 200}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Jump-to-bottom: a plain down-arrow button while far from the bottom;
          "N messages" pill (Amuse ref 09-waiting) when new ones arrived. */}
        {(far || pendingCount > 0) &&
          !atBottom &&
          (pendingCount > 0 ? (
            <button
              className="absolute bottom-[86px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full py-1.5 pl-3 pr-2 text-[12px] font-semibold"
              style={{
                background: "var(--chat-user-bubble)",
                color: "var(--chat-user-text)",
                boxShadow: "var(--shadow-float)",
              }}
              onClick={scrollToBottom}
            >
              {t.chat.newMessages(pendingCount)}
              <ChevronDown size={14} />
            </button>
          ) : (
            <button
              aria-label={t.chat.scrollToBottom}
              className="absolute bottom-[86px] left-1/2 z-30 flex size-9 -translate-x-1/2 items-center justify-center rounded-full"
              style={{
                background: "var(--fill-primary)",
                color: "var(--icon-primary)",
                boxShadow: "var(--shadow-float)",
              }}
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
