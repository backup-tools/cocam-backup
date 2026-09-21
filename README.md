# CoCam Backup

**Back up your work.**

> **Not affiliated with CompanyCam or Cloudflare; we're fans of both.** This is an independent, unofficial open-source tool. CompanyCam and Cloudflare are trademarks of their respective owners; they are named here only to describe what this tool works with.

Keep your own copy of everything in CompanyCam — every job, every photo, videos, documents, checklists, comments and notes — in storage that belongs to you.

It runs on Cloudflare, not on your phone or your computer. Once it is set up you press a button and walk away.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/backup-tools/cocam-backup)

---

## Setting it up

**Step 1 — Get a Cloudflare account with R2 turned on.**
A one-time step at [dash.cloudflare.com → R2](https://dash.cloudflare.com/?to=/:account/r2/overview). It asks for a card even though the first 10 GB are free. Do this first, or the next step fails.

**Step 2 — Press Deploy to Cloudflare.**
It sets everything up in your account. The only thing you need to fill in is **DASHBOARD_PASSWORD** — a password for your backup page. Pick anything and write it down, then press Deploy.

You will also be asked to connect a **GitHub** account, and Cloudflare will put a copy of this tool's code there. That is just how its one-click setup works: the copy is yours, so the tool keeps running even if this project goes away, and you can pick up improvements later. Nothing of yours is stored in it — no photos, no password, no CompanyCam key. Tick **Create private Git repository** if you would rather nobody else could see it. After the deploy you can ignore it entirely.

**Step 3 — Find your backup page.**

When the deploy finishes you land on a page full of technical logs — timestamps, `npm` messages, a wall of text. **Ignore all of it.** It is Cloudflare showing its work, and a green tick at the top means it worked.

Click **Overview** in the row of tabs near the top. Your backup page address is on that page and ends in `.workers.dev` — something like `cocam-backup.yourname.workers.dev`. Open it and type in the password you chose.

Bookmark that address. It is the only page you ever need.

> **Not sure it worked?** If the page asks you for a password, it worked. If you get an error instead, see *If something goes wrong* at the bottom.

**Step 4 — Paste your CompanyCam key into the page and press Save.**
The page checks it with CompanyCam straight away, so if the key is wrong you find out immediately.

**Step 5 — Press Start backup.**
Close the tab if you like. It keeps going on its own, and you can come back whenever to see how it is doing.

The password and the CompanyCam key do two different jobs: the password keeps other people out of your backup page, the key lets the page read your CompanyCam account.

### Getting your CompanyCam key

On a computer (this cannot be done on the phone app), open CompanyCam and click **Integrations** in the left-hand menu, then **Access Tokens**, then **New Personal Access Token**. Give it a name, choose **read** access, and pick an expiry date.

You need to be an Admin or Manager on the account. Read access is all this tool ever needs — it never changes or deletes anything in CompanyCam.

Keep an eye on the expiry date you chose. When the key expires the backup stops and tells you so; paste in a new one and it carries on.

---

## What you get

Everything lands in your storage in folders you can open and read:

```
cocam/
├── projects/
│   └── 12345-oak-street-reroof/      one folder per job
│       ├── photos/                   every photo, full size
│       ├── videos/
│       ├── documents/
│       └── (a few .json files)       the job's details, checklists,
│                                     comments, tasks and labels
├── _account/                         your people, tags, labels, customers
└── _report.json                      what the last backup did
```

Photos are saved at **full size** — the original file, not a shrunk copy. If someone drew on a photo in CompanyCam, you get both: the clean one and a second ending in `-annotated` with the markings on it.

Archived jobs are included. Jobs deleted from CompanyCam are not, because CompanyCam no longer has them.

### Getting files back out

Open your storage from the link on the backup page, click any file to look at it, then **Download**. To pull down a whole job or everything at once, a free tool called [rclone](https://rclone.org/s3/#cloudflare-r2) does it in one command.

---

## Running it again

Press **Start backup** again whenever you like. It only fetches what has changed since last time, so the first run does the work and later runs take almost no time.

Nothing is ever deleted from your storage. If you want a complete fresh copy, press **Reset** and then **Start**.

---

## Which Cloudflare plan

The **free plan is fine for most accounts.** There is nothing to set — the tool works out what your plan allows and paces itself.

If you have a lot of jobs — say 1,000 or more — the free plan is several times slower, enough to turn an afternoon into an overnight run. That is when the **Workers Paid plan** is worth the $5.

You do not have to decide now. Start free, and if it is slower than you want, upgrade part-way through — the backup picks up where it left off.

---

## Watching it work

Your newest jobs are copied first. If you stop it after an hour, that hour is your *most recent* work rather than a random slice, which matters if you are backing up because something has gone wrong.

The page draws a small square for each job, newest on the left:

```
waiting   copying   copied   checked   problem
  □          ▨         ■        ■         ■
```

A square fills as that job's photos come across, turns green when the job is done, and darkens once the tool has gone back and confirmed the files really are in your storage. Hover over any square to see which job it is.

Four buttons:

- **Start backup** — begins, or carries on from where it stopped.
- **Pause** — stops cleanly. Nothing is lost.
- **Retry failed** — another go at anything that did not make it.
- **Reset** — starts the whole thing over. Your files stay where they are.

### If something does not copy

The page will say **"Finished with 2 problems"** in amber — it will never claim everything worked when it did not. Each one is named in plain words, like *"Photo 4821 in Oak Street Reroof — the photo host returned an error"*, so you can tell a couple of bad files apart from something properly wrong.

Press **Retry failed**, or just press **Start backup** again — it automatically has another go at whatever it gave up on last time.

Slow responses and temporary errors are retried on their own, so most problems sort themselves out without you doing anything.

---

## Your data stays yours

- The backup page cannot be used without your password.
- Your CompanyCam key is sent only to CompanyCam, never anywhere else.
- Photos go straight from CompanyCam into your storage. Nothing passes through anyone else's computer, including ours.
- Everything lives in your own Cloudflare account and your own CompanyCam account.

One thing worth knowing: your backup page gets a web address ending in `workers.dev`, and the middle part of it is set once per Cloudflare account — often from the account holder's name. If you would rather it did not, you can change it under **Workers & Pages → Subdomain** in Cloudflare.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| A page of logs and technical text after deploying | That is normal — it is Cloudflare's build record. A green tick means it worked. Click **Overview** for your backup page address. |
| The deploy fails while setting up storage | R2 is not switched on yet. Turn it on at **dash.cloudflare.com → R2**, then deploy again. |
| You cannot find your backup page again | In Cloudflare, open **Workers & Pages**, click your project, then **Overview**. The address ends in `.workers.dev`. |
| The page says `DASHBOARD_PASSWORD is not set` | The password did not save. Set it again in Cloudflare under **Settings → Variables and Secrets**, then reload. |
| **CompanyCam rejected the API key** | The key is wrong or has expired. Paste a new one into the page. |
| The page keeps asking for a key | The key is stored in your backup, not your browser. If it keeps asking, the message on the page says why it was refused. |
| It says some things were **not included** | Your key does not have permission for those, or your account does not use that feature. Everything else is still backed up. |

---

## Licence

MIT
