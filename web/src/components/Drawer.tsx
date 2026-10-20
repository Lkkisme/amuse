/**
 * Muse-style drawer (no bottom nav bar): Main chat, Tasks (plain list),
 * Settings, and the Reset demo affordance.
 */
import { ListTodo, MessageCircle, RotateCcw, Settings, X } from "lucide-react";
import type { DemoState, Task } from "../data/fakeMuse";
import { taskStatusMeta } from "../data/fakeMuse";
import type { MuseActions } from "./actions";

function TaskRow({ task }: { task: Task }) {
  const meta = taskStatusMeta[task.status];
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: "var(--fill-secondary)" }}>
      <p className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
        {task.title}
      </p>
      <p className="mt-0.5 text-[12px] font-medium" style={{ color: meta.color }}>
        {meta.label}
      </p>
    </div>
  );
}

export function Drawer({ state, actions }: { state: DemoState; actions: MuseActions }) {
  if (!state.drawerOpen) return null;
  const tasks = state.feed
    .filter((i): i is Extract<typeof i, { role: "card"; kind: "task" }> => i.role === "card" && i.kind === "task")
    .map((i) => i.task);

  const navBtn = (label: string, icon: React.ReactNode, onClick: () => void, active: boolean) => (
    <button
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium"
      style={{
        background: active ? "var(--fill-secondary)" : "transparent",
        color: "var(--text-primary)",
      }}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="absolute inset-0 bg-black/30" onClick={() => actions.setDrawer(false)} />
      <aside
        className="relative flex h-full w-[300px] flex-col p-3"
        style={{ background: "var(--bg-primary)", boxShadow: "4px 0 24px rgba(0,0,0,0.12)" }}
      >
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-[17px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {state.drawerView === "tasks" ? "Tasks" : "Chats"}
          </span>
          <button aria-label="Close menu" className="rounded-full p-2" style={{ color: "var(--icon-secondary)" }} onClick={() => actions.setDrawer(false)}>
            <X size={20} />
          </button>
        </div>

        {state.drawerView === "main" ? (
          <nav className="space-y-1">
            {navBtn("Main chat", <MessageCircle size={18} />, () => actions.setDrawer(false, "main"), true)}
            {navBtn("Tasks", <ListTodo size={18} />, () => actions.setDrawer(true, "tasks"), false)}
            {navBtn("Settings", <Settings size={18} />, () => actions.openSettings("connectors"), false)}
          </nav>
        ) : (
          <div className="space-y-2 overflow-y-auto">
            {tasks.length === 0 && (
              <p className="px-1 text-[14px]" style={{ color: "var(--text-secondary)" }}>
                No tasks yet.
              </p>
            )}
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </div>
        )}

        <div className="mt-auto space-y-1 pt-3" style={{ borderTop: "1px solid var(--fill-divider)" }}>
          {state.drawerView === "tasks" &&
            navBtn("Main chat", <MessageCircle size={18} />, () => actions.setDrawer(false, "main"), false)}
          <button
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[15px] font-medium"
            style={{ color: "var(--text-secondary)" }}
            onClick={() => actions.resetDemo()}
          >
            <RotateCcw size={18} />
            Reset demo
          </button>
        </div>
      </aside>
    </div>
  );
}
