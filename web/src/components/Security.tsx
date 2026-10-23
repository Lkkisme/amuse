/**
 * Settings › Security: the PIN (set or change it, how long an unlock lasts, lock now), the password (change it, lock
 * this device), and the devices that can open Amuse (approve a waiting one, remove a trusted one). What needs the PIN
 * is the server's to say: a change it holds asks for the PIN, then goes again.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Laptop } from "lucide-react";
import { Button } from "./Button";
import { ConfirmSheet } from "./ConfirmSheet";
import { DEVICE_ICONS } from "./DeviceSheet";
import { usePin } from "./PinSheet";
import { useT } from "../i18n/react.ts";
import { type AccountState, type DeviceInfo, accountState, approveDevice, changePassword, denyDevice, lockPin, revokeDevice, setUnlockMinutes } from "../account.ts";
import { describeDevice } from "../device.ts";
import { moment } from "../schedules.ts";
import { type Said, withPin } from "../pin.ts";
import { lock } from "../connection.ts";

const LENGTHS = [1, 5, 15, 30];

/** A group's heading, as General's. */
function Heading({ children, first = false }: { children: string; first?: boolean }) {
  return (
    <p className={`mb-2 ${first ? "" : "mt-6"} text-[15px] font-semibold`} style={{ color: "var(--text-primary)" }}>
      {children}
    </p>
  );
}

const row = "flex w-full items-center justify-between px-4 py-3 text-left text-[14px]";
const divided = { borderTop: "1px solid var(--fill-divider)" };

export function Security() {
  const t = useT();
  const { ask, open } = usePin();
  const [state, setState] = useState<AccountState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<DeviceInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => accountState().then(setState), []);
  useEffect(() => void load(), [load]);
  /** a change, with the PIN when it needs it; what went wrong is said */
  const run = async (attempt: () => Promise<Said>) => {
    setProblem(null);
    const said = await withPin(ask, attempt);
    if (!said.ok) setProblem(said.reason);
    await load();
    return said.ok;
  };
  const nameOf = (device: DeviceInfo) => describeDevice(device.agent).name || (device.id.startsWith("before-") ? t.devices.before : t.devices.unknown);

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <Heading first>{t.settings.security.pin}</Heading>
      <p className="-mt-1 mb-2 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        {t.settings.security.pinHelp}
      </p>
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
        <button className={row} style={{ color: "var(--text-primary)" }} onClick={() => void open(state?.pin.set ? "change" : "set", "settings").then(load)}>
          {state?.pin.set ? t.settings.security.changePin : t.settings.security.setPin}
        </button>
        {state?.pin.set && (
          <div className={row} style={divided}>
            <span style={{ color: "var(--text-secondary)" }}>{state.pin.unlocked ? t.settings.security.unlockedUntil(moment(state.pin.unlocked)) : t.settings.security.locked}</span>
            <Button
              onCard
              disabled={!state.pin.unlocked}
              onClick={() => {
                lockPin();
                void load();
              }}
            >
              {t.settings.security.lockNow}
            </Button>
          </div>
        )}
      </div>
      {state?.pin.set && (
        <>
          <p className="mb-2 mt-4 px-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {t.settings.security.stayUnlocked}
          </p>
          <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
            {LENGTHS.map((minutes, i) => (
              <button key={minutes} className={row} style={{ color: "var(--text-primary)", ...(i === 0 ? {} : divided) }} onClick={() => void run(() => setUnlockMinutes(minutes))}>
                {t.settings.security.minutes(minutes)}
                {state.pin.minutes === minutes && <Check size={18} />}
              </button>
            ))}
          </div>
        </>
      )}

      <PasswordGroup />

      <Heading>{t.settings.security.devices}</Heading>
      <p className="-mt-1 mb-2 text-[13px] leading-snug" style={{ color: "var(--text-secondary)" }}>
        {t.settings.security.devicesHelp}
      </p>
      <ul className="divide-y divide-[var(--fill-divider)] rounded-[18px] px-4" style={{ background: "var(--fill-secondary)" }}>
        {state === null && (
          <li className="py-3">
            <div className="skeleton h-5 w-2/5 rounded" />
          </li>
        )}
        {state?.devices.map((device) => {
          const Icon = DEVICE_ICONS[describeDevice(device.agent).kind];
          return (
            <li key={device.id} className="flex items-center gap-3 py-2.5">
              <Icon size={18} style={{ color: "var(--icon-secondary)" }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]" style={{ color: "var(--text-primary)" }}>
                  {nameOf(device)}
                  {device.id === state.device ? ` · ${t.devices.thisDevice}` : ""}
                </span>
                <span className="block truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  {device.waiting ? t.devices.waitingTitle : t.devices.seen(moment(device.seen), device.address)}
                </span>
              </span>
              {device.waiting ? (
                <>
                  <Button onCard onClick={() => void run(() => denyDevice(device.id))}>
                    {t.devices.deny}
                  </Button>
                  <Button onCard tone="accent" onClick={() => void run(() => approveDevice(device.id))}>
                    {t.devices.approve}
                  </Button>
                </>
              ) : (
                <Button onCard tone="danger" onClick={() => setRemoving(device)}>
                  {t.devices.remove}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {problem && (
        <p role="alert" className="mt-2 px-1 text-[13px]" style={{ color: "var(--fill-red)" }}>
          {problem}
        </p>
      )}

      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        icon={removing ? DEVICE_ICONS[describeDevice(removing.agent).kind] : Laptop}
        title={t.devices.removeTitle(removing ? nameOf(removing) : "")}
        body={t.devices.removeHelp}
        action={t.devices.remove}
        busy={busy}
        onConfirm={() => {
          if (!removing) return;
          const mine = removing.id === state?.device;
          setBusy(true);
          void run(() => revokeDevice(removing.id)).then((done) => {
            setBusy(false);
            setRemoving(null);
            // this device, removed: it is signed out
            if (done && mine) location.reload();
          });
        }}
      />
    </div>
  );
}

/** The master password: change it (every other device then needs the new one), or lock this device. */
function PasswordGroup() {
  const t = useT();
  const { ask } = usePin();
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const field = "w-full bg-transparent px-4 py-3 text-[14px] outline-none";
  return (
    <>
      <Heading>{t.settings.general.password}</Heading>
      <div className="overflow-hidden rounded-xl" style={{ background: "var(--fill-secondary)" }}>
        {changing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!current || !next) return;
              void withPin(ask, () => changePassword(current, next)).then((result) => {
                setSaid(result.ok ? { ok: true, text: t.settings.general.changed } : { ok: false, text: result.reason });
                if (result.ok) {
                  setChanging(false);
                  setCurrent("");
                  setNext("");
                }
              });
            }}
          >
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              aria-label={t.settings.general.currentPassword}
              placeholder={t.settings.general.currentPassword}
              className={field}
              style={{ color: "var(--text-primary)" }}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
            <input
              type="password"
              autoComplete="new-password"
              aria-label={t.settings.general.newPassword}
              placeholder={t.settings.general.newPassword}
              className={field}
              style={{ color: "var(--text-primary)", ...divided }}
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
            <div className="flex justify-end gap-2 px-3 py-2" style={divided}>
              <Button variant="plain" type="button" onClick={() => setChanging(false)}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" type="submit" disabled={!current || !next}>
                {t.settings.general.change}
              </Button>
            </div>
          </form>
        ) : (
          <button
            className={row}
            style={{ color: "var(--text-primary)" }}
            onClick={() => {
              setSaid(null);
              setChanging(true);
            }}
          >
            {t.settings.general.changePassword}
          </button>
        )}
        <button className={row} style={{ color: "var(--fill-red)", ...divided }} onClick={() => void lock()}>
          {t.settings.general.lockDevice}
        </button>
      </div>
      {said && (
        <p role={said.ok ? "status" : "alert"} className="mt-2 px-1 text-[13px]" style={{ color: said.ok ? "var(--text-secondary)" : "var(--fill-red)" }}>
          {said.text}
        </p>
      )}
    </>
  );
}
