/** The models chosen (for the chat, the browser, background work, and the speech service), kept in the database (`model_choice`, one row). */
import { type Db, queryOne } from "@amuse/db";
import { type Choice, type Choices, Choice as ChoiceShape } from "@amuse/pi";
import { z } from "zod";

export function sqliteChoices(db: Db): Choices {
  return {
    load(): Choice | null {
      const row = queryOne(db, z.object({ choice: z.string() }), "select choice from model_choice");
      return row ? ChoiceShape.parse(JSON.parse(row.choice)) : null;
    },
    save(choice) {
      db.prepare("insert into model_choice (id, choice) values (1, ?) on conflict (id) do update set choice = excluded.choice").run(JSON.stringify(choice));
    },
  };
}
