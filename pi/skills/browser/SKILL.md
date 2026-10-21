---
name: browser
description: Doing something on a website (log in, fill a form, click through, buy, book). Read before starting or giving work to a browser.
---

# Working in a browser

**Look things up without one.** To find or read something, use `web_search` and `web_read`: quick, no browser. A browser is for what has to be done on a site: logging in, filling a form, clicking through, a page that only works in a real browser.

**Start a browser task** with `browse` and tell the user, in a sentence, that it is running: it goes on in the background, and they can watch it or take over at any time.

**Reuse an open browser.** A browser stays open between jobs, with its own agent that remembers what happened in it (where it is, what it has logged in to). For more on the same site, or in a browser the user opened themselves ("Your browser"), give the job to that open, idle browser with `browser` rather than opening another.

**Brief it fully.** The browser agent sees nothing but what you give it: put the user's whole ask in `instructions`, with every limit they set (price, dates, which account, what not to do). Say what to report back.

**Files.** Give in `files` only the workspace files it must upload; the user is asked before each upload. What it downloads lands in downloads/; send what the user wants with `send_file`.

**Sites.** A site the user has no rule for is asked about first (a Visit card). Consequential steps on a site (buying, sending, submitting, deleting) are approved by the user on a card unless they allow that site.

**When it needs the user** (a login, a captcha, a code), it says so and waits. Tell the user what it needs and that they can take over. If you can supply it yourself (a code from their mail, an answer they gave), send it with `message_run`: it goes on with that.

**While it works**, it reports when it ends; between, you look in on it (heartbeats). Never say it is done until you hear it was.
