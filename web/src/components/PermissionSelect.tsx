/** Allow / Ask / Deny, as a plain select styled as Muse's dropdown. */
import { ChevronDown } from "lucide-react";
import type { Permission } from "@remuse/protocol";

const PERMISSIONS: Permission[] = ["allow", "ask", "deny"];
const permissionName: Record<Permission, string> = { allow: "Allow", ask: "Ask", deny: "Deny" };

/** For websites: what each rule lets Muse do there. */
export const siteNames: Record<Permission, string> = { allow: "Allow", ask: "Visit only", deny: "Block" };

export function PermissionSelect({ value, onChange, names = permissionName }: { value: Permission; onChange: (p: Permission) => void; names?: Record<Permission, string> }) {
  return (
    <span className="relative flex items-center">
      <select
        aria-label="Permission"
        className="cursor-pointer appearance-none bg-transparent py-1 pl-2 pr-6 text-right text-[15px] outline-none"
        style={{ color: value === "deny" ? "var(--fill-red)" : "var(--text-primary)" }}
        value={value}
        onChange={(e) => {
          const next = PERMISSIONS.find((p) => p === e.target.value);
          if (next) onChange(next);
        }}
      >
        {PERMISSIONS.map((p) => (
          <option key={p} value={p}>
            {names[p]}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-0" style={{ color: "var(--icon-secondary)" }} />
    </span>
  );
}

