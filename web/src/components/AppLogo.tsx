/** An app's logo on a white tile; its initial where there is none, or it does not load. */
import { useState } from "react";

export function AppLogo({ name, logo, size = 36 }: { name: string; logo: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const tile = "flex shrink-0 items-center justify-center overflow-hidden rounded-[10px]";
  const box = { width: size, height: size };
  if (!logo || broken)
    return (
      <span className={`${tile} font-semibold`} style={{ ...box, fontSize: size * 0.42, background: "var(--fill-secondary)", color: "var(--text-secondary)" }}>
        {name.charAt(0).toUpperCase()}
      </span>
    );
  return (
    <span className={tile} style={{ ...box, background: "#fff", border: "1px solid var(--fill-divider)" }}>
      <img src={logo} alt="" className="object-contain" style={{ width: size * 0.66, height: size * 0.66 }} loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
