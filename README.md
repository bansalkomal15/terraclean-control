# Terra Clean — Control Tower

Projects and their work breakdown, offtake and PPA pipeline, enablers, a CEO
decision queue, and daily and weekly trackers. The CEO sees everything; everyone
else sees only what carries their name.

**Sign-in is set per person, under Organisation.** Two things are chosen
separately: whether someone has **full rights** (sees the whole portfolio), and
**how they sign in**.

| How they sign in | What happens |
| --- | --- |
| **Password** | Press **Send login** against their name. A password is set and you are handed the message — link, login, password — to send by Outlook, Teams or WhatsApp. Nothing has to arrive by email for them to get in. |
| **One-time code** | A six-digit code is emailed on every sign-in. No password. Only where email is known to arrive. |

Seeded to start with:

- `bansalkomal15@gmail.com` — **Administrator**, full rights, one-time code
- `atul.parmar@indianoil.in` — **Atul Parmar**, CEO, full rights, password

Both see exactly the same dashboard. Forgotten a password? Press **Send login**
again — that sets a new one.

Assigning somebody their first project does the same by itself: the message
carries the work *and* their login details together.

---

# Putting it online — the same route as your planner

Last time it was one `index.html` on GitHub → Vercel. This one has a server
behind it, so there are two extra clicks: a database and an email key. Twenty
minutes, one time.

## Step 1 — Put the folder on GitHub

1. Go to **github.com** → sign in.
2. **+** top right → **New repository**.
3. Name it `terraclean-control` → **Public** or **Private**, either is fine → **Create repository**.
4. On the new repo page click **"uploading an existing file"**.
5. **Unzip the folder first**, then drag in **everything inside `terraclean-web`** — the files *and* the folders (`api`, `lib`, `public`, `seed`, `server`, `test`).
   Do not drag the `terraclean-web` folder itself; its contents must sit at the top level, exactly like `index.html` had to last time.
6. **Commit changes**.

After uploading, the repo's front page should list `package.json`, `server.js`,
`vercel.json` and the folders. If you instead see a single folder called
`terraclean-web`, click into it, delete it, and re-upload the contents.

## Step 2 — Import it into Vercel

1. **vercel.com** → **Add New → Project**.
2. Find `terraclean-control` → **Import**.
3. Leave every setting alone. Framework will say *Other* — correct.
4. Click **Deploy**.

It will deploy and give you a URL. **Opening it now will show an error** — there
is no database yet. That is expected; Step 3 fixes it.

## Step 3 — Add the database (this is the bit your planner did with Firebase)

Vercel wipes the file system after every request, so the data has to live
somewhere else.

1. In your project → **Storage** tab → **Create Database**.
2. Choose **Upstash → Redis** → **Continue**.
3. Pick the free plan, any region near India → **Create**.
4. When it asks to connect it to the project, say yes.

That is it. Vercel writes `KV_REST_API_URL` and `KV_REST_API_TOKEN` into your
project by itself — nothing to copy.

## Step 4 — Add email, so you can receive your sign-in code

1. Go to **resend.com** → **Sign up** — use **bansalkomal15@gmail.com**.
2. **API Keys** → **Create API Key** → copy it (starts `re_`).
3. Back in Vercel → your project → **Settings → Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `RESEND_API_KEY` | the key you just copied |
   | `ADMIN_EMAIL` | `bansalkomal15@gmail.com` |
   | `APP_URL` | your Vercel URL, e.g. `https://terraclean-control.vercel.app` |

4. **Deployments** tab → the **⋯** menu on the newest one → **Redeploy**.

On Resend's free plan without your own domain, you can only send **to the
address you signed up with** — which is exactly the CEO account, so sign-in
works. Everyone else gets their invite code from you directly, so they never
need email at all. If Terra Clean later verifies a domain in Resend, assignment
notifications start reaching everyone too.

## Step 5 — Sign in

1. Open your Vercel URL.
2. Type `bansalkomal15@gmail.com` → **Continue**.
3. Check your Gmail for the six-digit code → enter it.

You are in as CEO.

**If the code does not arrive:** Vercel → your project → **Logs**. The code is
printed there whenever email is not working, so you are never locked out.

## Step 6 — Bring your team in

1. **Organisation** → **+ Add a person** opens a panel with the fields from your
   own sheet: **E. No. · Name (S/Shri/ Ms) · Design. · I.Com · Mobile no. ·
   Mail address**. Or load the whole list from an .xlsx, a .csv, or cells copied
   out of Excel, using those same headings.
2. Make them the owner of a project. Nobody can sign in until a project carries
   their name.
3. Press **Send login** next to them. A password is set and the message appears
   with link, login and password — open it in Outlook or copy it for Teams.
4. They open the link, type their email, then the password. Done.

## Updating it later

Exactly like the planner: edit a file in GitHub → **Commit changes** → Vercel
redeploys within a minute. Or paste a new version of a file the same way.

---

# Running it on your own laptop first

```bash
npm install
cp .env.example .env
npm start          # → http://localhost:3000
```

No database or email needed locally — it uses a SQLite file in `./data` and
prints sign-in codes to the terminal.

`npm test` runs 33 checks on the permission rules.

---

# Who sees what

**One project, one owner.** A project belongs to exactly one person. They run
all of it — every package, the schedule, the lot. Nobody else is sent it. There
is no ownership below project level, so there is nothing to filter by.

| | Full access | Project owner |
| --- | --- | --- |
| Portfolio, heatmap, every project | ● | — |
| Their own project, whole | ● | ● |
| Offtake, enablers, directory, templates | ● | — |
| Colleagues' email addresses | ● | — |

**Workload** in the sidebar shows every person in the directory, what they own
and what is open against their name.
| Hand a project to somebody else | ● | — |

This is enforced on the server, not in the browser. A member's page does not
merely hide the rest of the project — the server never sends it. `npm test`
checks exactly that, including that a member's data contains no unrelated
package names and no colleague email addresses, and that a forged request
trying to edit someone else's activity, grant themselves CEO access, delete a
project or clear their own CEO request is thrown away.

# How messages are sent

Settings → **Email** offers three routes. The first is the default and needs no
setup at all.

| Route | What happens | Reaches a corporate domain |
| --- | --- | --- |
| **From my own mailbox** | Outlook opens with the message written — address, subject, body, login details. You press send. | Yes, always |
| **Server first, my mailbox if it fails** | Tries automatically, falls back to a draft. | Yes |
| **Server only** | Fully automatic. Needs `BREVO_API_KEY` set. | Only once a domain the business owns is verified |

Sending *as* a Gmail address *to* a corporate domain is the thing that fails: the
receiving filter sees a message claiming to come from `gmail.com` that arrived
from somewhere else, and quarantines it silently. Sending from your own mailbox
sidesteps that, which is why it is the default.

Do not set `MAIL_FROM` to a company address you have not been authorised to send
from. That is precisely what those filters exist to stop.

# Templates

Settings → **Templates**. Build a project the way you want it, copy it to a
template, then apply it to any number of projects at once:

- **Add what is missing** — existing lines keep their progress, dates and full
  status history; only genuinely new lines are added, nothing is deleted.
- **Replace** — throws the breakdown away and starts again.

Change a template later and re-apply it, and the new lines flow into every
project you pick without disturbing what is already recorded.

# Adding projects in bulk

Projects → **Add several**. One project per line:

```
Name | State | Solar MWp | Wind MW | BESS MWh
```

Vertical bars, tabs or commas all work, so a block copied out of a spreadsheet
goes straight in. A name that already exists is not duplicated — tick the box and
its capacity is corrected instead, keeping its breakdown, progress and history.
**Fill in the substation list** loads the current portfolio.

# How data is stored

The whole portfolio is one JSON document with a revision number. Saves are
batched, so typing does not fire a request per keystroke, and the sidebar shows
*Saving… / Saved*. If two people save at once, the second gets the current
picture back and the page redraws rather than overwriting the first.

**Back it up:** Settings → **Download a backup**. Do this before any large
change — deleting a work breakdown cannot be undone.

# Passwords

Stored as scrypt hashes with a per-person salt, never in the portfolio document,
so they are not in your backups either. Minimum eight characters. Invite codes
expire after 14 days and work once. Sign-in codes last ten minutes, allow five
attempts, and work once. Sessions last 14 days in an httpOnly cookie.

# What is in the box

```
api/index.js              Vercel entry point
server/app.js             The API — sign-in, state, notifications
server.js                 Entry point for a normal server
lib/scope.js              Who may see what, and change what. The important file.
lib/auth.js               Passwords, one-time codes, invite codes, sessions
lib/store.js              Upstash Redis on Vercel, SQLite locally
lib/mailer.js             Resend, or SMTP, or the log
seed/seed.js              The first document: Morena's breakdown, 8 projects
public/                   The whole front end
test/permissions.test.js  33 assertions on the permission rules
```

# Two things to settle before real use

**Fonts.** The interface uses Henderson BCG, which is licensed to BCG rather
than Terra Clean. If this becomes the client's own tool, replace the three files
in `public/fonts` and the three `@font-face` rules at the top of
`public/index.html`. It falls back to Arial cleanly if you simply delete them.

**Where it lives.** The database will hold land records, tariffs and
counterparty names. A personal Vercel and Upstash account is fine for a pilot;
before this becomes the real system of record, move both into Terra Clean's own
accounts.
