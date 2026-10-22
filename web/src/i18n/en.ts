/**
 * The English messages: the source every other language follows. Each other
 * catalog must have every key (zh-CN.ts is checked against this one by the type
 * system). A message that takes values is a function of them, so a language
 * can put them in its own order and plural forms.
 */
export const en = {
  settings: {
    language: "Language",
    languageSystem: "Follow the system",
  },
  time: {
    today: (at: string) => `Today, ${at}`,
    tomorrow: (at: string) => `Tomorrow, ${at}`,
    yesterday: (at: string) => `Yesterday, ${at}`,
    onDay: (day: string, at: string) => `${day}, ${at}`,
  },
  schedule: {
    once: (when: string) => `Once, ${when}`,
    everyDayAt: (at: string) => `Every day at ${at}`,
  },
};

/** The shape every language's catalog takes. */
export type Messages = typeof en;
