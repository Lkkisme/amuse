/** Allow / Ask / Deny, as a plain select styled as Muse's dropdown (`options`: fewer, for what cannot be allowed). */
import { ChevronDown } from "lucide-react";
import type { Permission } from "@amuse/protocol";

const PERMISSIONS: Permission[] = ["allow", "ask", "deny"];
const permissionName: Record<Permission, string> = { allow: "Allow", ask: "Ask", deny: "Deny" };

export function PermissionSelect({ value, onChange, options = PERMISSIONS }: { value: Permission; onChange: (p: Permission) => void; options?: Permission[] }) {
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
        {options.map((p) => (
          <option key={p} value={p}>
            {permissionName[p]}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-0" style={{ color: "var(--icon-secondary)" }} />
    </span>
  );
}

/** The same, for a setting that may be left to follow another: null is "Default". */
export function ActionSelect({ value, onChange, options = PERMISSIONS }: { value: Permission | null; onChange: (p: Permission | null) => void; options?: Permission[] }) {
  return (
    <span className="relative flex items-center">
      <select
        aria-label="Permission"
        className="cursor-pointer appearance-none bg-transparent py-1 pl-2 pr-6 text-right text-[15px] outline-none"
        style={{ color: value === "deny" ? "var(--fill-red)" : value === null ? "var(--text-secondary)" : "var(--text-primary)" }}
        value={value ?? ""}
        onChange={(e) => onChange(options.find((p) => p === e.target.value) ?? null)}
      >
        <option value="">Default</option>
        {options.map((p) => (
          <option key={p} value={p}>
            {permissionName[p]}
          </option>
        ))}
      </select>
      <ChevronDown size={15} className="pointer-events-none absolute right-0" style={{ color: "var(--icon-secondary)" }} />
    </span>
  );
}

