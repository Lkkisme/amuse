/**
 * When Amuse cannot start for a reason it can name (a folder it cannot write to, a database from a newer version, a
 * migration that failed), the server still answers, with a page that says what went wrong and what to do, in the
 * visitor's language, instead of a restart loop with nothing to read. The app is not served then: nothing has opened
 * the data. The wording is here; what happened comes from @amuse/db as a Problem (a value, no words).
 */
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import type { Problem } from "@amuse/db";

export type Language = "en" | "zh-CN";

export interface Explained {
  /** What went wrong. */
  what: string;
  /** What to do about it. */
  todo: string;
}

/** Every kind of problem has its words, in each language: a new kind does not compile until it has. */
type Words = { [K in Problem["kind"]]: (problem: Extract<Problem, { kind: K }>) => Explained } & { title: string; restart: string };

export const en: Words = {
  title: "Amuse could not start",
  restart: "Once that is done, restart Amuse (docker compose restart amuse). This page goes away when it starts.",
  folder: ({ path, trouble, hint }) => ({
    what: `The folder ${path} ${trouble === "missing" ? "is not there" : trouble === "not-a-folder" ? "is not a folder" : "cannot be written to"}.`,
    todo:
      hint === "compose-up"
        ? "Run `docker compose up -d` once from the Amuse folder: it prepares the folders Amuse needs. Then restart Amuse."
        : "Check that the data volume is mounted, and that the user Amuse runs as (uid 1000 in Docker) may write to it. Then restart Amuse.",
  }),
  "database-newer": ({ needed, known }) => ({
    what: `Your data was written by a newer version of Amuse (its step ${needed}${known ? `; this version knows up to ${known}` : ""}).`,
    todo: "Update Amuse (git pull && docker compose up -d --build). Nothing was changed. To go back to this version instead, restore a copy from the backups folder.",
  }),
  "database-unreadable": ({ path, message }) => ({
    what: `The database ${path} could not be opened: ${message}`,
    todo: "Check who owns the file and that the disk is neither full nor read-only. If the file is damaged, restore a copy from the backups folder.",
  }),
  "backup-failed": ({ message }) => ({
    what: `Amuse could not make its safety copy of your data before updating it: ${message}`,
    todo: "Free some disk space, or fix who may write to the backups folder. Then restart Amuse. Nothing was changed.",
  }),
  "migration-failed": ({ version, name, message, backup }) => ({
    what: `Updating your stored data failed at step ${version} (${name}): ${message}`,
    todo: `That step was undone, so your data is as it was.${backup ? ` A copy from just before it is ${backup}.` : ""} Fix what the message says, or ask for help with it. Then restart Amuse.`,
  }),
};

export const zhCN: Words = {
  title: "Amuse 无法启动",
  restart: "处理完后，请重启 Amuse（docker compose restart amuse）。启动成功后，本页面就会消失。",
  folder: ({ path, trouble, hint }) => ({
    what: `文件夹 ${path} ${trouble === "missing" ? "不存在" : trouble === "not-a-folder" ? "不是文件夹" : "无法写入"}。`,
    todo:
      hint === "compose-up"
        ? "在 Amuse 所在目录运行一次 `docker compose up -d`，它会准备好 Amuse 需要的文件夹，然后重启 Amuse。"
        : "请确认数据卷已挂载，并且运行 Amuse 的用户（Docker 中为 uid 1000）可以写入，然后重启 Amuse。",
  }),
  "database-newer": ({ needed, known }) => ({
    what: `你的数据由更新版本的 Amuse 写入（其中的步骤 ${needed}${known ? `；当前版本只认识到 ${known}` : ""}）。`,
    todo: "请更新 Amuse（git pull && docker compose up -d --build），数据没有被改动。若想退回当前版本，请从 backups 文件夹恢复一份备份。",
  }),
  "database-unreadable": ({ path, message }) => ({
    what: `无法打开数据库 ${path}：${message}`,
    todo: "请检查文件的所有者，以及磁盘是否已满或只读。若文件已损坏，请从 backups 文件夹恢复一份备份。",
  }),
  "backup-failed": ({ message }) => ({
    what: `更新前，Amuse 无法为你的数据做安全备份：${message}`,
    todo: "请腾出一些磁盘空间，或修正 backups 文件夹的写入权限，然后重启 Amuse。数据没有被改动。",
  }),
  "migration-failed": ({ version, name, message, backup }) => ({
    what: `更新你的存储数据时，在步骤 ${version}（${name}）失败：${message}`,
    todo: `该步骤已撤销，你的数据保持原样。${backup ? `更新前的备份在 ${backup}。` : ""}请按提示修复，或寻求帮助，然后重启 Amuse。`,
  }),
};

export const catalogs: Record<Language, Words> = { en, "zh-CN": zhCN };

/** The problem in words: its kind picks the message, which takes that kind's values. */
export function explain(problem: Problem, language: Language): Explained {
  const words = catalogs[language];
  switch (problem.kind) {
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
