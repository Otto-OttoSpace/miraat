# Paste this to your Chrome agent to launch rtlint

You're helping me launch my open-source dev tool **rtlint**. Repo: https://github.com/Otto-OttoSpace/rtlint
Pause for my confirmation before anything is finally submitted/posted. Do them in this order:

## 1. Make the GitHub repo public
Go to the repo → Settings → General → scroll to "Danger Zone" → **Change visibility → Public** → confirm. (Tell me when done — my terminal will then publish to npm.)

## 2. Get an npm publish token (so my terminal can publish)
Go to npmjs.com → sign in or create a free account → avatar → **Access Tokens → Generate New Token → Granular/Automation** (Read-Write, packages) → copy it and paste it back to me. (I'll put it in ~/.npmrc and run `npm publish`.)
*(Alternative: I can just run `npm login` in my terminal instead — ask me which I prefer.)*

## 3. Publish the flagship article on dev.to
Sign in to dev.to → **New Post** → Title: **"Why every AI coding tool builds broken Arabic (and the 6 fixes)"** → paste the body from my file `~/Sites/rtlint/blog/why-every-ai-tool-builds-broken-arabic.md` (I'll give it to you) → tags: `rtl, arabic, tailwindcss, ai` → set **canonical URL** to the repo → add the before/after image `~/Sites/rtlint/docs/before-after.svg` → **Publish**. (Then queue the 2nd article `the-12-rtl-bugs-ai-code-tools-make.md` for a few days later.)

## 4. Show HN (the #1 launch — do it when I can sit for 3–4h to reply)
Go to news.ycombinator.com → **submit** →
- **Title:** `Show HN: rtlint – Find and auto-fix RTL/Arabic bugs AI code tools introduce`
- **URL:** the GitHub repo
Then immediately post the first comment (I'll give you the text from `~/Sites/rtlint/LAUNCH.md`). Best window: **Sunday ~00:00–01:00 PT** or Tue–Thu 8–10am ET.

## 5. List the Cursor rule
Go to **cursor.directory** → submit a rule → paste the contents of `~/Sites/rtlint/.cursor/rules/rtl.mdc` → title "Arabic / RTL correctness" → link the repo. Then open a PR adding it to github.com/PatrickJS/awesome-cursorrules.

## 6. Post the announcement on X + LinkedIn
Use this copy + attach the before/after image:
> AI writes most of our UI now — and it's quietly bad at Arabic. It reaches for `ml-4`, `text-left`, hard-codes `dir="ltr"`, never mirrors an icon. Looks fine in English, breaks the second an Arabic user opens it. So I built **rtlint** — scans your React/Tailwind, auto-fixes the RTL mistakes, and writes an AI-rules file so your agent stops making them. `npx rtlint . --fix` — free + open source 👇 [repo link]

## 7. Reposition my bio everywhere
Set my bio on **X, LinkedIn, GitHub, and my portfolio** to:
> Arabic-RTL Design Engineer — Western-quality product design + RTL-correct code · AR / FR / EN

## 8. (Same week) Reddit Showoff + Peerlist
- Post in r/reactjs and r/webdev's "Showoff Saturday" thread with the before/after image + one line: "AI keeps writing `text-left` that breaks Arabic — I built a linter for it."
- Set up a Peerlist profile ("Arabic-RTL Design Engineer") and launch rtlint on Peerlist Launchpad.
