/**
 * The sidebar's Skills: how Amuse does a kind of work, written down. The
 * user's own first (theirs, installed, or written by Amuse), then the ones
 * that ship with Amuse. A tap opens a skill's page: what it says, its files,
 * and removing it (the user's own only). + asks Amuse to install one.
 */
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { BookOpen, ChevronLeft, FileText, Plus, Trash2 } from "lucide-react";
import type { Session, SkillInfo, SkillOrigin } from "@amuse/protocol";
import type { Actions } from "../ui.ts";
import { activeT } from "../i18n/language.ts";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
import { reason } from "./Goals";
import { RichText } from "./markdown";
import { Sheet } from "./Sheet";
import { useT } from "../i18n/react.ts";
import { detailOf, useFail } from "../ask.tsx";
import { ErrorState } from "./Errors";

export function Skills({
  session,
  actions,
  onOpen,
}: {
  session: Session;
  actions: Actions;
  onOpen: (name: string, origin: SkillOrigin) => void;
}) {
  const t = useT();
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    session.call("skills.list", {}).then(
      ({ skills }) => setSkills(skills),
      () => setSkills([]),
    );
  }, [session]);

  const yours = (skills ?? []).filter((s) => s.origin === "yours");
  const builtIn = (skills ?? []).filter((s) => s.origin === "built-in");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-5">
      <div className="flex items-center">
        <p
          className="flex-1 text-[17px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {t.skills.title}
        </p>
        <button
          aria-label={t.skills.add}
          className="hover-fade -mr-1 flex size-8 items-center justify-center rounded-full"
          style={{ color: "var(--icon-primary)" }}
          onClick={() => setAdding(true)}
        >
          <Plus size={20} />
        </button>
      </div>
      {skills === null ? (
        <div className="skeleton mt-3 h-12 rounded-[10px]" />
      ) : (
        <>
          <Group title={t.skills.yours}>
            {yours.length === 0 ? (
              <p
                className="text-[14px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {t.skills.yoursNone}
              </p>
            ) : (
              yours.map((s) => (
                <Row
                  key={s.name}
                  skill={s}
                  onOpen={() => onOpen(s.name, s.origin)}
                />
              ))
            )}
          </Group>
          <Group title={t.skills.builtIn}>
            {builtIn.map((s) => (
              <Row
                key={s.name}
                skill={s}
                onOpen={() => onOpen(s.name, s.origin)}
              />
            ))}
          </Group>
        </>
      )}

      <AddSkill
        open={adding}
        onClose={() => setAdding(false)}
        onAsk={(what) => {
          setAdding(false);
          void actions.send(activeT().skills.installMessage(what), []).catch(() => {});
        }}
      />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <p
        className="mb-2 text-[13px] font-semibold"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
      </p>
      <ul className="space-y-3">{children}</ul>
    </section>
  );
}

function Row({ skill, onOpen }: { skill: SkillInfo; onOpen: () => void }) {
  const t = useT();
  return (
    <li className={skill.replaced ? "opacity-50" : undefined}>
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
          <BookOpen size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-[15px] font-medium"
            style={{ color: "var(--text-primary)" }}
          >
            {skill.name}
          </span>
          <span
            className="line-clamp-2 block text-[14px]"
            style={{ color: "var(--text-secondary)" }}
          >
            {skill.replaced ? t.skills.replaced : skill.description}
          </span>
        </span>
      </button>
    </li>
  );
}

function AddSkill({
  open,
  onClose,
  onAsk,
}: {
  open: boolean;
  onClose: () => void;
  onAsk: (what: string) => void;
}) {
  const t = useT();
  const [what, setWhat] = useState("");
  useEffect(() => {
    if (open) setWhat("");
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} bare>
      <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
        <span
          className="flex size-14 items-center justify-center rounded-[16px]"
          style={{ background: "#ffffff", color: "#111112" }}
        >
          <BookOpen size={26} />
        </span>
        <p
          className="mt-4 text-[20px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {t.skills.add}
        </p>
        <p
          className="mt-1 text-[14px]"
          style={{ color: "var(--text-secondary)" }}
        >
          {t.skills.addHelp}
        </p>
        <div
          className="mt-5 w-full overflow-hidden rounded-[18px] text-left"
          style={{ background: "var(--field)" }}
        >
          <input
            autoFocus
            aria-label={t.skills.skill}
            className="w-full bg-transparent px-4 py-3.5 text-[16px] outline-none"
            style={{ color: "var(--text-primary)" }}
            placeholder={t.skills.placeholder}
            maxLength={500}
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && what.trim() && onAsk(what.trim())
            }
          />
        </div>
        <Button
          variant="primary"
          size="lg"
          className="mt-6"
          disabled={!what.trim()}
          onClick={() => onAsk(what.trim())}
        >
          {t.skills.askAmuse}
        </Button>
        <Button variant="plain" size="lg" className="mt-2" onClick={onClose}>
          {t.common.cancel}
        </Button>
      </div>
    </Sheet>
  );
}

/** A skill's page, over the sidebar: what it says, its files, and removing it (the user's own). */
export function SkillPage({
  session,
  name,
  origin,
  onBack,
}: {
  session: Session;
  name: string;
  origin: SkillOrigin;
  onBack: () => void;
}) {
  const t = useT();
  const [shown, setShown] = useState<{
    skill: SkillInfo;
    body: string;
    files: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    session
      .call("skills.get", { name, origin })
      .then(setShown, (e: unknown) => {
        setShown(null);
        setError(reason(e));
      });
  }, [session, name, origin]);
  useEffect(() => load(), [load]);

  const failed = useFail();
  const remove = () => {
    setBusy(true);
    session
      .call("skills.remove", { name })
      .then(onBack, (e: unknown) => failed(e, `Skills › remove ${name}`, remove))
      .finally(() => {
        setBusy(false);
        setRemoving(false);
      });
  };

  const skill = shown?.skill;
  return (
    <div
      // over the sidebar: the way back at the top left, in line with ☰ at the top right
      className="anim-pane-from-right absolute inset-0 z-20 flex flex-col"
      style={{ background: "var(--panel)" }}
    >
      <div className="mt-2 flex h-12 shrink-0 items-center px-3 pt-1 md:mt-0">
        <button
          aria-label={t.skills.backTo}
          className="hover-fade flex h-9 items-center gap-0.5 rounded-full pl-1 pr-3 text-[15px] font-medium"
          style={{ color: "var(--text-secondary)" }}
          onClick={onBack}
        >
          <ChevronLeft size={20} />
          {t.skills.title}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {error && (
          <ErrorState
            title={t.ask.loadTitle}
            message={error}
            detail={detailOf(`Skills › ${name}`, "", "skills_get_failed")}
            retry={() => {
              setError(null);
              load();
            }}
          />
        )}
        {!skill || !shown ? (
          !error && <div className="skeleton h-8 w-3/5 rounded-[10px]" />
        ) : (
          <>
            <div className="flex items-start gap-2">
              <p
                className="min-w-0 flex-1 break-words text-[24px] font-semibold leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {skill.name}
              </p>
              {/* removing one of the user's own, at hand however long the skill */}
              {skill.origin === "yours" && (
                <button
                  aria-label={t.common.remove}
                  title={t.common.remove}
                  className="hover-fade -mr-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-full"
                  style={{ color: "var(--fill-red)" }}
                  onClick={() => setRemoving(true)}
                >
                  <Trash2 size={20} />
                </button>
              )}
            </div>
            <p
              className="mt-1 text-[14px]"
              style={{ color: "var(--text-secondary)" }}
            >
              {skill.origin === "built-in"
                ? skill.replaced
                  ? t.skills.builtInReplaced
                  : t.skills.builtIn
                : t.skills.yours}
            </p>
            <p
              className="mt-4 text-[15px] leading-[22px]"
              style={{ color: "var(--text-primary)" }}
            >
              {skill.description}
            </p>
            <Folded text={shown.body} />
            {shown.files.length > 0 && (
              <section className="mt-7">
                <p
                  className="mb-2 text-[13px] font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t.skills.files}
                </p>
                <ul className="space-y-1.5">
                  {shown.files.map((f) => (
                    <li
                      key={f}
                      className="flex items-center gap-2 break-all text-[13px]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <FileText size={14} className="shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {skill.origin === "built-in" && (
              <p
                className="mt-7 text-[13px]"
                style={{ color: "var(--text-tertiary)" }}
              >
                {t.skills.shipped}
              </p>
            )}
          </>
        )}
      </div>

      <ConfirmSheet
        open={removing}
        onClose={() => setRemoving(false)}
        title={t.skills.removeTitle(name)}
        body={t.skills.removeHelp}
        action={t.common.remove}
        busy={busy}
        onConfirm={remove}
      />
    </div>
  );
}

/** A skill's text, folded to its start when it is long: the rest is a tap away. */
function Folded({ text }: { text: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > 14 || text.length > 900;
  return (
    <div className="mt-5">
      <div
        className={`relative text-[15px] leading-[22px] ${long && !open ? "max-h-[300px] overflow-hidden" : ""}`}
        style={{ color: "var(--text-primary)" }}
      >
        <RichText text={text} />
        {long && !open && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
            style={{
              background: "linear-gradient(to top, var(--panel), transparent)",
            }}
          />
        )}
      </div>
      {long && (
        <Button
          variant="plain"
          tone="accent"
          className="-ml-4 mt-2"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t.skills.showLess : t.skills.showAll}
        </Button>
      )}
    </div>
  );
}
