/**
 * The Amuse panel's Goals: what the user is working toward (core goals.ts),
 * each with its latest note, Amuse's from the night or from the chat. Add one
 * with +; a tap opens it: what it is, where it stands, its log, and closing
 * it (reached, or let go of). Closed ones stay below.
 */
import { useCallback, useEffect, useState } from "react";
import { CircleCheck, Plus, Target } from "lucide-react";
import type { Goal, GoalNote, Session } from "@amuse/protocol";
import { RichText } from "./markdown";
import { Sheet } from "./Sheet";

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Goals({ session }: { session: Session }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    () =>
      session.call("goals.list", {}).then(
        ({ goals }) => setGoals(goals),
        () => setGoals([]),
      ),
    [session],
  );
  useEffect(() => void load(), [load]);

  const active = (goals ?? []).filter((g) => g.status === "active");
  const closed = (goals ?? []).filter((g) => g.status !== "active");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5">
      <div className="flex items-center">
        <p
          className="flex-1 text-[17px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Goals
        </p>
        <button
          aria-label="Add a goal"
          className="hover-fade -mr-1 flex size-8 items-center justify-center rounded-full"
          style={{ color: "var(--icon-primary)" }}
          onClick={() => setAdding(true)}
        >
          <Plus size={20} />
        </button>
      </div>
      {goals === null ? (
        <div className="skeleton mt-3 h-12 rounded-[10px]" />
      ) : active.length === 0 ? (
        <p
          className="mt-3 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          What you are working toward. Amuse looks into each one at night and
          keeps track of how it goes.
        </p>
      ) : (
        <ul className="mt-3 space-y-4">
          {active.map((g) => (
            <GoalRow key={g.id} goal={g} onOpen={() => setOpen(g.id)} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <>
          <p
            className="mt-6 text-[13px] font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            Closed
          </p>
          <ul className="mt-3 space-y-4 opacity-60">
            {closed.map((g) => (
              <GoalRow key={g.id} goal={g} onOpen={() => setOpen(g.id)} />
            ))}
          </ul>
        </>
      )}

      <AddGoal
        session={session}
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void load();
        }}
      />
      <GoalSheet
        session={session}
        id={open}
        onClose={() => setOpen(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

function GoalRow({ goal, onOpen }: { goal: Goal; onOpen: () => void }) {
  const Icon = goal.status === "done" ? CircleCheck : Target;
  const when = goal.latest ? ` · ${day(goal.latest.day)}` : "";
  const latest =
    goal.status !== "active"
      ? `${goal.status === "done" ? "Reached" : "Let go"}${when}`
      : goal.latest
        ? `${day(goal.latest.day)} · ${firstLine(goal.latest.text)}`
        : goal.added
          ? `Added ${day(goal.added)}`
          : "";
  return (
    <li>
      <button
        className="flex w-full items-start gap-3 text-left"
        onClick={onOpen}
      >
        <span
          className="flex size-[38px] shrink-0 items-center justify-center rounded-[10px]"
          style={{
            background: "var(--fill-secondary)",
            color: "var(--icon-primary)",
          }}
        >
          <Icon size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block text-[15px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {goal.title}
          </span>
          {latest && (
            <span
              className="line-clamp-2 block text-[14px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {latest}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** A note's first line, as plain text. */
function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^[-+]\s+/, "")
    .trim();
}

/** A day (YYYY-MM-DD) as the user reads dates: "Oct 21" (with the year when it is not this one). */
function day(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
  });
}

function AddGoal({
  session,
  open,
  onClose,
  onAdded,
}: {
  session: Session;
  open: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const [about, setAbout] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a fresh form each time it opens (not on closing: the sheet animates out with what it held)
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setAbout("");
    setError(null);
  }, [open]);
  const add = () => {
    setBusy(true);
    setError(null);
    session
      .call("goals.add", { title: title.trim(), about: about.trim() })
      .then(
        () => onAdded(),
        (e: unknown) => setError(reason(e)),
      )
      .finally(() => setBusy(false));
  };
  return (
    <Sheet open={open} onClose={onClose} bare>
      <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-[16px]"
          style={{ background: "#ffffff", color: "#111112" }}
        >
          <Target size={26} />
        </span>
        <p
          className="mt-4 text-[20px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Add a goal
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          Something you are working toward, over weeks or months
        </p>
        <div
          className="mt-5 w-full overflow-hidden rounded-[18px] text-left"
          style={{ background: "var(--field)" }}
        >
          <input
            autoFocus
            aria-label="Goal"
            className="w-full bg-transparent px-4 py-3.5 text-[16px] outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Like: run a half marathon"
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div
            className="mx-4 border-t"
            style={{ borderColor: "var(--fill-divider)" }}
          />
          <textarea
            aria-label="More about it"
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-3 text-[16px] outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder="Why, by when, where you are now (optional)"
            maxLength={4000}
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
        </div>
        {error && (
          <p
            role="alert"
            className="mt-2 text-[13px]"
            style={{ color: "var(--fill-red)" }}
          >
            {error}
          </p>
        )}
        <button
          disabled={!title.trim() || busy}
          className="mt-6 h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--fill-blue)" }}
          onClick={add}
        >
          Add
        </button>
        <button
          className="hover-fade mt-2 h-11 w-full rounded-full text-[16px] font-medium"
          style={{ color: "var(--text-primary)" }}
          onClick={onClose}
        >
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

function GoalSheet({
  session,
  id,
  onClose,
  onChanged,
}: {
  session: Session;
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [shown, setShown] = useState<{ goal: Goal; log: GoalNote[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (id === null) return;
    setError(null);
    session.call("goals.get", { id }).then(setShown, (e: unknown) => {
      setShown(null);
      setError(reason(e));
    });
  }, [session, id]);

  const close = (status: "done" | "dropped") => {
    if (!shown) return;
    setBusy(true);
    setError(null);
    session
      .call("goals.close", { id: shown.goal.id, status })
      .then(
        () => {
          onChanged();
          onClose();
        },
        (e: unknown) => setError(reason(e)),
      )
      .finally(() => setBusy(false));
  };

  const goal = shown?.goal;
  return (
    <Sheet open={id !== null} onClose={onClose}>
      <div className="overflow-y-auto px-6 pb-6 pt-4">
        {error && (
          <p
            role="alert"
            className="pr-8 text-[14px]"
            style={{ color: "var(--fill-red)" }}
          >
            {error}
          </p>
        )}
        {goal && (
          <>
            <p
              className="pr-8 text-[20px] font-semibold leading-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {goal.title}
            </p>
            <p
              className="mt-1 text-[13px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {
                {
                  active: "Working on it",
                  done: "Reached",
                  dropped: "Let go",
                }[goal.status]
              }
              {goal.added ? ` · added ${day(goal.added)}` : ""}
            </p>
            {goal.about && (
              <div
                className="mt-4 text-[15px] leading-[22px]"
                style={{ color: "var(--text-primary)" }}
              >
                <RichText text={goal.about} />
              </div>
            )}
            {shown.log.length > 0 && (
              <p
                className="mt-5 text-[13px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                Log
              </p>
            )}
            <ul className="mt-2 space-y-4">
              {shown.log.map((note, i) => (
                <li key={i}>
                  <p
                    className="text-[13px]"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    {day(note.day)}
                    {note.label ? ` · ${note.label}` : ""}
                  </p>
                  <div
                    className="text-[15px] leading-[22px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    <RichText text={note.text} />
                  </div>
                </li>
              ))}
            </ul>
            {goal.status === "active" && (
              <div className="mt-6 flex flex-col gap-2">
                <button
                  disabled={busy}
                  className="h-12 w-full rounded-full text-[16px] font-semibold text-white disabled:opacity-40"
                  style={{ background: "var(--fill-blue)" }}
                  onClick={() => close("done")}
                >
                  Reached it
                </button>
                <button
                  disabled={busy}
                  className="hover-fade h-11 w-full rounded-full text-[16px] font-medium disabled:opacity-40"
                  style={{ color: "var(--fill-red)" }}
                  onClick={() => close("dropped")}
                >
                  Let it go
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
