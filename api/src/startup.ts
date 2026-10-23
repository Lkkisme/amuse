/**
 * When Amuse cannot start for a reason it can name (a folder it cannot write to, a database from a newer version, a
 * migration that failed), the server still answers, with a page that says what went wrong and what to do, in the
 * visitor's language, instead of a restart loop with nothing to read. The app is not served then: nothing has opened
 * the data. The wording is here; what happened comes from @amuse/db as a Problem (a value, no words).
 */
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Folder, Problem } from "@amuse/db";

export type Language = "en" | "zh-CN";

export interface Explained {
  /** What went wrong. */
  what: string;
  /** What to do about it. */
  todo: string;
}

/** Every kind of problem has its words, in each language: a new kind does not compile until it has. */
type Words = { [K in Problem["kind"]]: (problem: Extract<Problem, { kind: K }>) => Explained } & { title: string; restart: string };

/** The folders by what they are for, as the page names them. */
const folders: Record<Language, Record<Folder, string>> = {
  en: { data: "data", backups: "backups", workspace: "workspace" },
  "zh-CN": { data: "数据", backups: "备份（backups）", workspace: "工作区（workspace）" },
};

export const en: Words = {
  title: "Amuse could not start",
  restart: "Once that is done, restart Amuse (docker compose restart amuse). This page goes away when it starts.",
  configuration: ({ trouble }) =>
    trouble === "empty-data"
      ? { what: "AMUSE_DATA is set, but to nothing.", todo: "Give it the data folder (/data in Docker), or take it out." }
      : { what: "AMUSE_DATA and AMUSE_JOURNAL name different folders.", todo: "Keep only AMUSE_DATA, or make them agree: Amuse keeps its data in one folder, and takes old files in only from there." },
  folder: ({ folder, trouble, hint }) => ({
    what: `The ${folders.en[folder]} folder ${trouble === "missing" ? "is not there" : trouble === "not-a-folder" ? "is not a folder" : "cannot be written to"}.`,
    todo:
      hint === "compose-up"
        ? "Run `docker compose up -d` once from the Amuse folder: it prepares the folders Amuse needs. Then restart Amuse."
        : "Check that the data volume is mounted, and that the user Amuse runs as (uid 1000 in Docker) may write to it. Then restart Amuse.",
  }),
  "database-newer": ({ needed, known }) => ({
    what: `Your data was written by a newer version of Amuse (its step ${needed}${known ? `; this version knows up to ${known}` : ""}).`,
    todo: "Update Amuse (git pull && docker compose up -d --build). Nothing was changed. To go back to this version instead, restore a copy from the backups folder.",
  }),
  "database-unreadable": () => ({
    what: "The database could not be opened.",
    todo: "Check who owns the database file in the data folder, and that the disk is neither full nor read-only; the server's log says what the database answered. If the file is damaged, restore a copy from the backups folder.",
  }),
  "backup-failed": () => ({
    what: "Amuse could not make its safety copy of your data before updating it.",
    todo: "Free some disk space, or fix who may write to the backups folder; the server's log says why. Then restart Amuse. Nothing was changed.",
  }),
  "migration-failed": ({ version, name, backup }) => ({
    what: `Updating your stored data failed at step ${version} (${name}).`,
    todo: `That step was undone, so your data is as it was.${backup ? " A copy from just before it is in the backups folder." : ""} The server's log says why: fix that, or ask for help with it. Then restart Amuse.`,
  }),
  "journal-unreadable": () => ({
    what: "The history of one of your chats could not be read: an event saved in it is not in a form this version understands.",
    todo: "If Amuse was just downgraded, update it again. Otherwise restore a copy from the backups folder, or ask for help; the server's log names the chat and the event. Nothing was changed.",
  }),
  "old-files": () => ({
    what: "Amuse found its old data files (events.jsonl, access.json and others) beside a database that has already taken them in.",
    todo: "Either an update was cut short before it renamed them, or an older version of Amuse was run on this data and wrote them. Never run an older version on this data: it would start with no password and no history. If an update was cut short, run `amuse-admin retire-old-files`: it renames them only if they are exactly what was taken in. If it says some differ, restore a copy from the backups folder or ask for help. Nothing was changed.",
  }),
};

export const zhCN: Words = {
  title: "Amuse 无法启动",
  restart: "处理完后，请重启 Amuse（docker compose restart amuse）。启动成功后，本页面就会消失。",
  configuration: ({ trouble }) =>
    trouble === "empty-data"
      ? { what: "AMUSE_DATA 已设置，但内容为空。", todo: "请把它设为数据文件夹（Docker 中为 /data），或者删掉它。" }
      : { what: "AMUSE_DATA 与 AMUSE_JOURNAL 指向了不同的文件夹。", todo: "请只保留 AMUSE_DATA，或让两者一致：Amuse 的数据放在同一个文件夹里，旧文件也只从那里导入。" },
  folder: ({ folder, trouble, hint }) => ({
    what: `${folders["zh-CN"][folder]}文件夹${trouble === "missing" ? "不存在" : trouble === "not-a-folder" ? "不是文件夹" : "无法写入"}。`,
    todo:
      hint === "compose-up"
        ? "在 Amuse 所在目录运行一次 `docker compose up -d`，它会准备好 Amuse 需要的文件夹，然后重启 Amuse。"
        : "请确认数据卷已挂载，并且运行 Amuse 的用户（Docker 中为 uid 1000）可以写入，然后重启 Amuse。",
  }),
  "database-newer": ({ needed, known }) => ({
    what: `你的数据由更新版本的 Amuse 写入（其中的步骤 ${needed}${known ? `；当前版本只认识到 ${known}` : ""}）。`,
    todo: "请更新 Amuse（git pull && docker compose up -d --build），数据没有被改动。若想退回当前版本，请从 backups 文件夹恢复一份备份。",
  }),
  "database-unreadable": () => ({
    what: "无法打开数据库。",
    todo: "请检查数据文件夹中数据库文件的所有者，以及磁盘是否已满或只读；服务器日志里有数据库的回答。若文件已损坏，请从 backups 文件夹恢复一份备份。",
  }),
  "backup-failed": () => ({
    what: "更新前，Amuse 无法为你的数据做安全备份。",
    todo: "请腾出一些磁盘空间，或修正 backups 文件夹的写入权限（原因见服务器日志），然后重启 Amuse。数据没有被改动。",
  }),
  "migration-failed": ({ version, name, backup }) => ({
    what: `更新你的存储数据时，在步骤 ${version}（${name}）失败。`,
    todo: `该步骤已撤销，你的数据保持原样。${backup ? "更新前的备份在 backups 文件夹里。" : ""}原因见服务器日志：请先修复，或寻求帮助，然后重启 Amuse。`,
  }),
  "journal-unreadable": () => ({
    what: "无法读取你的某个聊天的历史：其中保存的一个事件，当前版本无法理解。",
    todo: "若 Amuse 刚被降级，请重新更新它。否则请从 backups 文件夹恢复一份备份，或寻求帮助；服务器日志里写明了是哪个聊天、哪个事件。数据没有被改动。",
  }),
  "old-files": () => ({
    what: "Amuse 发现旧的数据文件（events.jsonl、access.json 等）与一个已经导入过它们的数据库放在一起。",
    todo: "可能是更新在重命名它们之前中断了，也可能是在这份数据上运行过旧版本的 Amuse 并写入了它们。千万不要在这份数据上运行旧版本：它会在没有密码、没有历史的状态下启动。若是更新被中断，请运行 `amuse-admin retire-old-files`：只有与导入内容完全一致的文件才会被重命名。若它说有文件不一致，请从 backups 文件夹恢复备份，或寻求帮助。数据没有被改动。",
  }),
};

export const catalogs: Record<Language, Words> = { en, "zh-CN": zhCN };

/** The problem in words: its kind picks the message, which takes that kind's values. */
export function explain(problem: Problem, language: Language): Explained {
  const words = catalogs[language];
  switch (problem.kind) {
    case "configuration":
      return words.configuration(problem);
    case "folder":
      return words.folder(problem);
    case "database-newer":
      return words["database-newer"](problem);
    case "database-unreadable":
      return words["database-unreadable"](problem);
    case "backup-failed":
      return words["backup-failed"](problem);
    case "migration-failed":
      return words["migration-failed"](problem);
    case "journal-unreadable":
      return words["journal-unreadable"](problem);
    case "old-files":
      return words["old-files"](problem);
  }
}

/** The first of the visitor's languages that is Chinese or English, as the web app picks (web/src/i18n/language.ts). */
export function languageOf(acceptLanguage: string | undefined): Language {
  for (const part of (acceptLanguage ?? "").split(",")) {
    const primary = part.split(";")[0]?.trim().toLowerCase().split("-")[0];
    if (primary === "zh") return "zh-CN";
    if (primary === "en") return "en";
  }
  return "en";
}

const escaped = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** The whole page: plain, with no script and nothing loaded from anywhere. */
export function problemPage(problem: Problem, language: Language): string {
  const words = catalogs[language];
  const { what, todo } = explain(problem, language);
  return `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaped(words.title)}</title>
<body style="font:16px/1.5 system-ui,sans-serif;max-width:600px;margin:12vh auto;padding:0 24px;color:#1c1c1e">
<h1 style="font-size:20px">${escaped(words.title)}</h1><p>${escaped(what)}</p><p>${escaped(todo)}</p><p style="color:#8e8e93">${escaped(words.restart)}</p></body></html>`;
}

/** Answer every request with the page (503), until the process is stopped or restarted (or `close`d). */
export function serveProblem(problem: Problem, options: { port: number; host: string }): Promise<{ close(): Promise<void> }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const language = languageOf(req.headers["accept-language"]);
    res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(problemPage(problem, language));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve({ close: () => new Promise((done) => server.close(() => done())) }));
  });
}
