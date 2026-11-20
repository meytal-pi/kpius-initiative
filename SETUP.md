# D&D Initiative Tracker — Setup & Use

Plain website (HTML/CSS/JS), no build step, nothing to install.
Hosting: **GitHub Pages** (free) · Live sync: **Firebase Realtime Database** (free "Spark" plan, no credit card).

> **Try it right now:** double-click `index.html`. It runs in *local mode* (works, but doesn't sync between devices).

---

## 1. Firebase (live sync) — ~5 min

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. **Create a project** → any name (e.g. `dnd-initiative`) → you can turn *Google Analytics* **off** → Create.
3. Left menu: **Build → Realtime Database → Create Database**
   - Location: pick the closest (e.g. *europe-west1*).
   - Choose **Start in locked mode** → Enable.
4. Open the **Rules** tab, replace everything with this, then click **Publish**:

   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "rooms": {
         "$room": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
   (Nobody can list rooms; you need to know the room name to see a table.)

5. Go to **Project Overview** (house icon) → click the **`</>` (Web)** icon → nickname e.g. `tracker` →
   *don't* tick Firebase Hosting → **Register app**.
6. Firebase shows a code block containing `const firebaseConfig = { ... }`.
   Copy the `{ ... }` part into **`firebase-config.js`**, replacing `null`:

   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "dnd-initiative.firebaseapp.com",
     databaseURL: "https://dnd-initiative-default-rtdb.europe-west1.firebasedatabase.app",
     projectId: "dnd-initiative",
     ...
   };
   ```
   ⚠ Make sure **`databaseURL`** is there. If it's missing, copy the URL shown at the top of the
   *Realtime Database → Data* page (starts with `https://` and ends with `firebasedatabase.app` or `firebaseio.com`).
7. Leave `DEFAULT_ROOM` as `null`. The app asks each device for a **table code** instead (see below).

> The `apiKey` is not a secret — it's normal for it to be in a public website. Access is controlled by the rules above.

## 2. GitHub Pages (hosting) — ~5 min

1. Create a free account at <https://github.com>.
2. Top-right **+** → **New repository** → name e.g. `initiative` → **Public** → Create.
3. On the new repo page click **"uploading an existing file"** and drag in **all files of this folder**
   (`index.html`, `app.js`, `styles.css`, `firebase-config.js`, `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png`) → **Commit changes**.
4. Repo **Settings → Pages** → *Source:* **Deploy from a branch** → Branch: **main**, folder **/(root)** → Save.
5. After 1–2 minutes your app is live at: **`https://<your-username>.github.io/initiative/`**

To update later (e.g. new version of the files): repo → **Add file → Upload files** → drag the changed files → Commit.

## 3. Devices

**Table code:** the first time each device opens the app, it asks for a **table code**. Make one up that's
hard to guess and enter the *same* code on the tablet and the PC — that's what links them. It's remembered
on each device and never stored in the public files. Change it in **⚙ Settings → Table code**.

**Tablet (players):** open the URL in Chrome → menu **⋮ → Add to Home screen**. Now it opens like an app.
After the code, it asks *"Who is using this device?"* → choose **🎲 Players**.

**DM's PC:** open the same URL in Chrome and bookmark it. On first open choose **🛡 Dungeon Master**.
Only DM screens show hidden enemies. The badge at the top (**🎲 Players** / **🛡 DM screen**) always shows the
current role — tap it to switch. DM screens also have a purple line above and below the list.

**Always-on-top mini view:** click **⧉** (top right) in Chrome on the PC. A small window opens that stays above
all other windows and updates live. It has Next/Prev buttons when turn tracking is on. You can resize it.
Close it with its own ✕ or click ⧉ again.

The green dot top-right = synced. Amber = reconnecting (changes are kept and sent when back online).

---

## Quick guide

| Task | How |
|---|---|
| Save players once | **Party** → type name → Save. Next session: **Party → Add all to encounter** (or the button on the empty screen). |
| Enter initiative | Tap a name under *Needs initiative* → keypad → **Set & next ▶** jumps straight to the next player. |
| Ties | The app asks who goes first (compare DEX / roll off). |
| Add a monster mid-fight | **＋ Add** → name, type, initiative → it's slotted into the right place. **Add & another** pre-fills "Goblin 2". |
| Hidden monster (DM) | In *Add*, switch **Hidden from players** on. To reveal it, click its purple **🙈 Hidden · Reveal** button (one click, with Undo). Also works in the mini view. |
| Player delays / readies | Drag the **⠿** handle to move them, or tap the name → **Move to end of round**. |
| Change initiative | Tap the number. |
| Conditions | Tap **✚** on a row. Tap a condition to toggle it. Custom text works too (e.g. "Hexed"). |
| Turn tracking (optional) | **⚙ → Turn tracking**. Adds **Start combat / Next turn**, round counter, NOW/NEXT highlights and condition durations (count down at the end of that creature's turn). |
| After a fight | **Encounter ▾ → Remove all except players** or **New encounter** (also clears players' initiative). |
| Oops | Destructive actions show an **Undo** button for a few seconds. |
| Screen turning off | **⚙ → Keep screen awake** (on by default on tablets). Only while the app is open — the tablet's normal sleep settings aren't changed. |
| Edit / duplicate / remove | Tap the name. |

Keyboard on PC: **A** = add · **N / →** = next turn · **P / ←** = previous turn · numbers + **Enter** in the keypad.

Colors: 🔵 Player · 🟢 Ally · 🟡 NPC · 🔴 Enemy · 🟣 Lair / Other.

## Costs / limits
Firebase free plan: 1 GB stored, 10 GB/month downloads, 100 simultaneous connections. A session uses a few kilobytes.
GitHub Pages: free for public repositories.
