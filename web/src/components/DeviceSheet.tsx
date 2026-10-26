/**
 * The card a trusted device gets when a new one signs in with the password: what it is, where it came from and
 * when, and Approve (with the PIN) or Turn away. Until then the new device only waits (api/src/access.ts).
 */
import { useState } from "react";
import { Laptop, Smartphone, Tablet } from "lucide-react";
import { Sheet } from "./Sheet";
import { Button } from "./Button";
import { usePin } from "./PinSheet";
import { useT } from "../i18n/react.ts";
import { useFail } from "../ask.tsx";
import { type DeviceInfo, approveDevice, denyDevice } from "../account.ts";
import { type DeviceKind, describeDevice } from "../device.ts";
import { moment } from "../schedules.ts";
import { withPin } from "../pin.ts";

export const DEVICE_ICONS: Record<DeviceKind, typeof Laptop> = { phone: Smartphone, tablet: Tablet, computer: Laptop };

export function DeviceSheet({ device, onClose }: { device: DeviceInfo | null; onClose: (answered: boolean) => void }) {
  const t = useT();
  const { ask } = usePin();
  const [busy, setBusy] = useState(false);
  const failed = useFail();
  const [shown, setShown] = useState(device);
  if (device && device !== shown) setShown(device);
  const described = describeDevice(shown?.agent ?? "");
  const Icon = DEVICE_ICONS[described.kind];
  const answer = async (approve: boolean) => {
    if (!shown) return;
    setBusy(true);
    const said = approve ? await withPin(ask, () => approveDevice(shown.id)) : await denyDevice(shown.id);
    setBusy(false);
    if (said.ok) return onClose(true);
    failed(new Error(said.reason), approve ? "Devices › approve a device" : "Devices › deny a device", () => void answer(approve));
  };
  return (
    <Sheet open={device !== null} onClose={() => onClose(false)} bare>
      <div className="flex flex-col items-center px-6 pb-6 pt-5 text-center">
        <span className="flex size-14 items-center justify-center rounded-[16px]" style={{ background: "#ffffff", color: "#111112" }}>
          <Icon size={26} />
        </span>
        <p className="mt-4 text-[20px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {t.devices.waitingTitle}
        </p>
        <p className="mt-3 text-[16px] font-medium" style={{ color: "var(--text-primary)" }}>
          {described.name || t.devices.unknown}
        </p>
        <p className="text-[14px]" style={{ color: "var(--text-secondary)" }}>
          {t.devices.seen(shown ? moment(shown.seen) : "", shown?.address ?? "")}
        </p>
        <p className="mt-3 text-[14px]" style={{ color: "var(--text-secondary)" }}>
          {t.devices.waitingHelp}
        </p>
        <Button variant="primary" size="lg" className="mt-6" disabled={busy} onClick={() => void answer(true)}>
          {t.devices.approve}
        </Button>
        <Button variant="plain" size="lg" className="mt-2" disabled={busy} onClick={() => void answer(false)}>
          {t.devices.deny}
        </Button>
      </div>
    </Sheet>
  );
}
