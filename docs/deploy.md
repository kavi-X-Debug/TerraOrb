# Deploying TerraOrb (free, on GitHub Pages)

This guide is for a teammate who has never used GitHub Pages. It takes about 20 minutes.
At the end, the site is online at `https://<org>.github.io/<repo>/`, and its data refreshes
by itself every morning.

## How it fits together

```
GitHub repo (main branch)
├── web/  data/  index.html   ← published as the website (nothing else is)
├── pipeline/                 ← Python that makes data/ (runs on GitHub's computers, not the site)
└── .github/workflows/
    ├── pages.yml             ← "Publish site": copies web/ + data/ to GitHub Pages
    └── refresh.yml           ← "Refresh data": every day at 06:00 Sri Lanka time
                                 rain.py → water.py → rules.py → finish.py → commit data/ → publish
```

- **No server and no cost.** GitHub Pages serves plain files; GitHub Actions runs the Python
  for free on public repositories.
- **If anything fails, nothing changes.** A refresh commits only when every step succeeded,
  so the site keeps yesterday's data. The failed run shows as a red ✗ in the **Actions** tab,
  and GitHub emails whoever set up the workflow.
- **Dates.** Every tank file has a `generated` date, and `finish.py` stamps `data/tanks.json`.
  The app shows them as "Data updated …".
- **Offline.** After one visit, the app opens without internet (a service worker, `web/sw.js`,
  keeps the app and the last data). It then says "You are offline. Showing saved data."

## Before you start

You need:
- a **GitHub account** (free): <https://github.com/signup>;
- an **Earthdata account** (free), for the satellite water step: <https://urs.earthdata.nasa.gov/users/new>;
- **git** on your computer, and this project folder (`E:\Monsoon Compass` on the team laptop).

## Step 1: Create the repository on GitHub

1. Sign in to GitHub. Top right, click **+** → **New repository**.
   (For a team, first create an organisation: **+** → **New organization**, free plan, then
   create the repository inside it.)
2. **Repository name:** e.g. `terraorb`. This becomes part of the address.
3. Choose **Public**. GitHub Pages and Actions minutes are free for public repositories.
   Everything in the repo, including the data, will be visible to anyone.
4. Leave "Add a README" **unticked** (the project already has one). Click **Create repository**.
5. GitHub shows a page with commands. Keep it open for the next step.

## Step 2: Upload the project

In a terminal in the project folder (`E:\Monsoon Compass`), replace `<org>` with your
GitHub user or organisation name:

```
git remote add origin https://github.com/<org>/terraorb.git
git push -u origin main
```

The first push asks you to sign in to GitHub in the browser. Refresh the repository page
afterwards: you should see `web`, `data`, `pipeline`, `docs` and `.github`.

## Step 3: Turn on GitHub Pages

1. In the repository, open **Settings** → **Pages** (left menu).
2. Under **Build and deployment** → **Source**, choose **GitHub Actions**.
   (Not "Deploy from a branch". Our workflow publishes only `web/` and `data/`.)
3. Open the **Actions** tab → **Publish site** (left) → **Run workflow** → **Run workflow**.
4. Wait for the green ✓ (about a minute). Click the run: the **deploy** box shows the site
   address, `https://<org>.github.io/terraorb/`. Open it: it forwards you to `/web/`.

From now on, every push that changes `web/` or `data/` republishes the site automatically.

## Step 4: Add the Earthdata login as secrets

The refresh needs your Earthdata login to read satellite water maps. It goes into GitHub
**Secrets**: encrypted, never shown in logs, and never written into the repo.

1. Sign in at <https://urs.earthdata.nasa.gov>. Under **Applications → Authorized Apps**,
   make sure data access is allowed for **LP DAAC** (HLS) and **PO.DAAC** (OPERA DSWx).
   If either is missing, the first data download will ask you to approve it.
2. In the GitHub repository: **Settings** → **Secrets and variables** → **Actions** →
   **New repository secret**. Add two secrets:
   - Name `EARTHDATA_USERNAME`, value: your Earthdata username
   - Name `EARTHDATA_PASSWORD`, value: your Earthdata password
3. Never put these in a file, a commit, a chat message or a screenshot.

## Step 5: Run the first data refresh

1. **Actions** tab → **Refresh data** → **Run workflow** → **Run workflow**.
2. The first run is slow (up to an hour or two): it downloads 46 years of rainfall and
   measures every clear satellite scene since 2017. Later runs reuse a cache and are quick.
3. When it's green, there's a new commit "Data refresh YYYY-MM-DD" from github-actions[bot],
   and the site shows the new "Data updated" date.

After that it runs **every day at 06:00 Sri Lanka time** (00:30 UTC) by itself.

## Day-to-day

- **Pull before you work.** The bot commits to `main` every day, so run `git pull` before
  making changes, or your push will be rejected.
- **Change the schedule:** edit the `cron:` line in `.github/workflows/refresh.yml`
  (times are in UTC; Sri Lanka is UTC+5:30).
- **Pause the refresh:** Actions → Refresh data → **⋯** → **Disable workflow**.
- **GitHub pauses scheduled workflows** in repos with no activity for 60 days. If that
  happens, re-enable it in the Actions tab.

## When a refresh fails (red ✗)

The site is safe: it keeps the last good data. To find out why:

1. Actions → click the failed run → click the red step to read its log.
2. Common causes:

| The log says | What to do |
|---|---|
| `STOPPED: no Earthdata login found` | Add the two secrets (Step 4); check their names exactly |
| `Earthdata login failed (HTTP 401)` | Wrong username or password in the secrets |
| `could not read … from NASA Earthdata` | Approve LP DAAC / PO.DAAC for your Earthdata account (Step 4.1), or NASA is down: try again later |
| `STOPPED: could not reach NASA POWER` / `HTTP 5xx` | NASA service down; the next daily run usually works |
| `rainfall above 400 mm/day … data error` | Bad data from NASA POWER; see `max_daily_rain_mm` and `skip_sources` in `pipeline/config.toml` |
| `STOPPED: the data is not safe to publish` | A data file is broken; the list below it names the file and problem |
| A test failed (`Run tests` step) | Someone pushed code that breaks the pipeline; fix it and push again |

3. Fix it, then **Run workflow** again by hand.

## Checking it on your own computer

```
.venv\Scripts\python -m http.server 8000
```

Then open <http://localhost:8000/web/>. Offline mode also works on `localhost`. After a code
change to `web/`, reload the page twice: the service worker shows the new version on the
second load.
