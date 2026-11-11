# Sardiye Studio: setup and user guide

Sardiye Studio adds broadcast-style graphics to a talking-head video: name cards for people and institutions, short definitions of difficult terms, numbers the host quotes, maps, quotes, lists, topic headlines, keywords that flash up as he says them, timelines, side-by-side comparisons, bar charts and photos with a caption. It runs entirely on your own computer. The only thing that leaves the machine is the transcript text, which goes to Claude so it can decide where the graphics belong. The video file itself never leaves your computer.

The output keeps your original resolution and frame rate. If you shoot in 4K, the graphics are rendered at 4K.

## 1. What you need

- A Mac, Windows or Linux computer. More memory and a faster CPU make transcription quicker; 16 GB of RAM is comfortable.
- Node.js 20 or newer, from https://nodejs.org (choose the LTS download). The Mac one-line installer brings its own copy, so this is only for the manual way.
- Python 3.9 or newer, from https://www.python.org/downloads (on Windows, tick "Add python.exe to PATH" in the installer). Again only for the manual way: the Mac one-line installer brings its own copy.
- An Anthropic API key. Section 3 explains how to get one.
- About 2 GB of free disk space for the tools, plus room for your renders.

Internet is needed for the one-time installation, for downloading the speech model the first time you transcribe, and for the Claude planning step. Transcription, rendering and export work offline.

## 2. Install (one time)

### The short way (Mac)

Open Terminal (press Command and Space, type Terminal, press Enter), paste this line and press Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/chadbrightside/overlay-studio/main/install-mac.sh | bash
```

It installs everything into a folder called `overlay-studio` in your home folder, with private copies of Node.js and Python in `~/.local`, and puts a **Sardiye Studio** icon on your Desktop. Nothing else needs to be installed first. Double-click that icon whenever you want to work: a small window opens and stays open, and the app appears in your browser. Close the window when you are done. Skip to section 3.

### The manual way (Mac, Windows or Linux)

1. Copy the `overlay-studio` folder somewhere permanent, for example `Documents/overlay-studio`.
2. Open a terminal in that folder.
   - Mac: open Terminal, type `cd ` (with a space), drag the folder onto the window, press Enter.
   - Windows: open the folder in Explorer, click the address bar, type `powershell`, press Enter.
3. Install the dependencies:

```bash
npm install
```

   This downloads FFmpeg, the fonts, the map data and the Claude library into the folder. Nothing is installed system-wide.

4. Run the setup check:

```bash
npm run setup
```

   It downloads the Chromium rendering engine (about 150 MB) and installs `faster-whisper` for transcription. Each line prints a tick when it is fine and a cross with instructions when it is not.

   On Windows the Python command is usually `python`, not `python3`. If the setup says Python was not found, start the app anyway, open Settings and change "Python command" to `python`, then run `npm run setup` again.

5. Start the app by double-clicking `start-mac.command` (Mac) or `start-windows.bat` (Windows), or with `npm start` in the terminal. It opens http://localhost:3777 in your browser. Keep the small window open while you use the app and close it when you are done.

The interface is in English by default. The **English / العربية** switch at the bottom of the left column changes the whole interface to Arabic, including the right-to-left layout. The sun and moon buttons next to it switch between the light and dark look.

## 3. Connect your Claude account

The app talks to Claude through the Anthropic API. The API is billed separately from a claude.ai Pro or Max subscription: you pay for what you use, from a credit balance. One episode costs a small amount (see section 7).

1. Go to https://console.anthropic.com and sign in with your Anthropic account (the same email you use for Claude works).
2. Open **Billing** and add credits. A card works, and a small balance lasts for many episodes.
3. Open **API keys**, click **Create key**, give it a name such as "overlay-studio", and copy the key. It starts with `sk-ant-`. You only see it once.
4. In Sardiye Studio, click **Settings** at the bottom of the left column, paste the key into **API key**, click **Test key** to confirm it works, then **Save settings**. The "Claude" dot in the left column turns green.

The key is stored only in `data/settings.json` inside the app folder. Do not share that file or the key.

## 4. Make an episode

### Step 1: create a project

Put the exported video file (MP4 or MOV, any resolution) into the `inbox` folder inside `overlay-studio`, or keep it where it is. In the app click **New project**, then **Choose a video…** to pick the file in the normal Mac file dialog. Files in the inbox folder are also listed there, and a file path can still be pasted under "or paste a path". The original file is never changed. The four steps at the top of the project page guide you through the rest; a step lights up once the one before it is done.

### The short way: one button

Once the project is open, a gold **Start** button sits at the top of the page. It transcribes the episode, asks Claude to plan the graphics, and opens them for review, all in one go. It needs the Claude key from section 3; without it, the button opens Settings. Steps 2 and 3 below do the same thing in two separate moves, which is useful when you want to choose the transcription model or write instructions for Claude first.

### Starting from the script instead

If you write your script before filming, you can plan the graphics before the video exists. On the start page, scroll to **Or start from the script**, give the episode a name, paste the script and click **Create from script**. Then go to step 2 and **Plan with Claude** as usual: Claude reads the script and suggests the cards in script order, each tied to the words you will say when it should appear. Review and edit them in step 3 exactly as you would after a transcript, and use the instructions box with **Revise** to discuss changes.

After filming, open step 1 and click **Choose the video…**. The app transcribes the recording and places every card at the moment you say its words. Cards whose words it cannot find in the recording, for example a passage you cut or improvised, stay marked **Not placed yet** with a yellow **check** badge; open the card and click **Place in the video…** to pick the moment from the transcript, or delete it. Export becomes available once the video is attached.

### Step 2: transcribe

In step 1, choose the model and the spoken language, then click **Transcribe**. A progress bar shows how far it is; you can leave the page open and come back.

- `large-v3` is the most accurate, including for Arabic. On a laptop CPU it takes roughly as long as the video itself, sometimes longer. The first run also downloads the model (about 3 GB).
- `large-v3-turbo` is several times faster with a small loss in accuracy.
- Choosing the language instead of "Detect automatically" avoids mistakes on the first seconds.

If you already have subtitles for the episode (for example from your editing software or from YouTube), use **Choose SRT / VTT** instead. Transcription is then skipped.

Click **Read transcript** to check the result, then **Continue to planning**.

### Step 3: plan with Claude

In step 2, choose how many overlays you want (Light, Normal, Rich or Dense; Dense aims at about three cards a minute, something on screen most of the time, with cards following each other one second apart) and the on-screen language, write instructions if you want, and click **Plan with Claude**. Claude reads the whole transcript and returns a plan in one to three minutes. The app then jumps to the review step.

The instructions box is the way to direct it. Examples that work well:

- "Add a name card for every politician mentioned, even briefly."
- "Fewer definitions, more maps."
- "Write names the way Al Jazeera spells them."
- "Overlay 4 is wrong: he is the foreign minister, not the president."
- "Do not put anything on screen during the first minute."

**Revise current plan with these instructions** keeps the plan you have, with your edits, and asks Claude to change only what the instructions say. **Plan again from scratch** replaces the plan.

### Step 4: review

Step 3 shows a timeline strip of the episode with a coloured mark for every overlay, and a row per overlay underneath. Click a mark or a row to open it. You can change the type, the start and end time in seconds, the corner, and every text field. Changes save by themselves.

- A yellow **check** badge means Claude was not certain about a fact (a person's role, a definition). Verify it, fix the text if needed, and click **Mark as checked**. Claude never invents numbers or quotes: a number card only appears when the host said the number. Even so, read every card before you publish.
- Opening a row renders a thumbnail of the graphic on the actual video frame at that moment. Use it to check that nothing covers your face or your channel logo.
- **Preview clip** renders a short 1080p clip of that moment with the animation.
- **Leave out of export** keeps an overlay in the plan but skips it in the export. **Add by hand** lets you pick a line of the transcript and place your own overlay there.
- Map cards take English country names. The main countries are painted gold and the related countries (neighbours, the other side) blue, with a legend under the map. "Names written on the map" sets what is written on each country, one per line as `Algeria | الجزائر`. A route, one place per line, draws an animated line with an arrow through those places in order: a country name, a city as `Abuja, Nigeria`, or exact coordinates as `36.8,3.1`. Cities without coordinates are placed at the centre of their country, so give coordinates when the exact spot matters. Türkiye, UAE, Western Sahara and Palestine are understood.
- Seats cards draw a parliament as a half-circle of dots that fill in party by party, with the numbers counting up and a tick at the majority line. Give the total seats and one line per party as `party | seats`, with an optional colour as a third part.
- Two camps cards show two sides as columns with their member groups as chips, each with a short tag (religion, political line), and a band of common ground between them. One line per group as `group | what defines it | 1 or 2`, and the common ground one point per line.
- Share cards fill a ring to a percentage with the number in the centre, up to four segments, one per line as `name | 45%`.
- Two sides cards put one country on the left of the screen and one on the right with their flags, the host in the middle, with an optional figure under each. They always use the "Both sides" corner. The right-hand element sits below your logo; tell the app where the logo is in Settings under **Corner with your logo**.
- Claude may vary the corner between consecutive cards about different things so the screen feels alive. The default corner and the logo corner are set in Settings.
- Image cards show a photo with a caption. Claude suggests one when you talk about a specific person, place or event, with English search words; the app then looks for a free picture on Wikipedia and Wikimedia Commons and writes the author and licence as the credit under the photo. Open the card to see up to eight candidates and click the one you want, or **Choose a file…** to use your own picture, or paste an image address. News agency photos are not searched, because they cannot be used without a licence; use a file you have the right to publish. The card centres on the subject's face, found automatically, and zooms in a little when the face is small; a gold dot on the preview marks the point, and clicking the preview moves it when the automatic choice is wrong. Every image card starts with the yellow check badge so you look at the picture before publishing. You are never stuck with Claude's choice: **Remove picture** clears it while keeping the card, **Add a picture** in the review header puts a new photo card at any moment you pick from the transcript, and **Move to another moment…** on any card moves it, keeping its length. Pictures you chose survive a Revise with Claude.
- Timeline, comparison and chart cards take one line per entry, with a vertical bar between the parts: `2024 | French troops withdraw` for a timeline, `Military spending | 22 billion | 12 billion` for a comparison, `2023 | 52` for a chart. The figures count up on screen, so write the number first.

### Step 5: export

Three outputs are available. Pick the one that fits how you publish.

**Overlay track for my editor (ProRes 4444 with alpha)**

This is the route a professional editor would take, and the only one with zero loss. The app writes a `.mov` that contains only the graphics on a transparent background, at your video's exact resolution, frame rate and length. In Premiere, DaVinci Resolve or Final Cut, drop it on the track above your footage, aligned to the start, and export as you normally do. Your footage is never re-encoded by this tool. The file is large (several GB for a long 4K episode) because ProRes 4444 is a mastering format.

**Finished video**

The app re-encodes the whole episode with the graphics composited in. The audio is copied without re-encoding. With the default setting (H.264, CRF 15, medium) the result is visually indistinguishable from the source once YouTube compresses it, and the file is a few times larger than a typical camera export. Under **Advanced encoding options**:

- H.265 / HEVC (libx265): smaller files, slower to encode.
- H.264 or HEVC hardware (Apple VideoToolbox, Mac only): five to ten times faster, with a high fixed bitrate instead of a quality setting.
- ProRes 422 HQ: visually lossless, files of roughly 5 GB per minute at 4K. Use this only if you will edit the result again.

Lower CRF means higher quality and a larger file. 15 is a safe default; 12 is overkill; 18 is still very good.

**Quick 1080p check**

A quick, lower-quality render of the whole episode to check timing and wording before the final export.

Finished files appear under the export card with a **Download** and a **Show in folder** button. On this kind of computer, rendering the graphics takes about a quarter of a second per frame of overlay, so an episode with 15 overlays of 6 seconds each takes a few minutes before encoding begins. Encoding a 4K episode with H.264 at medium speed can take about as long as the episode itself, or longer; the hardware encoders are much faster.

## 5. Settings worth knowing

- **Model**: Claude Opus 5.5 gives the best judgement about what deserves a graphic. Sonnet 5.5 costs about half and is still good.
- **Channel brief**: one or two sentences about the channel and the audience. Claude uses it to decide which terms need explaining.
- **Accent colour, panel colour, default corner, size, edge margin**: the look of every card. Keep the corner that is free of your logo. Changing these re-renders the overlays on the next export.
- **Python command** and **Device**: leave on `python3` / `auto` unless setup told you otherwise. `cuda` needs an NVIDIA GPU with the CUDA libraries installed and makes transcription much faster.

## 6. Folders and files

Everything the app creates lives in `overlay-studio/data/`:

- `data/settings.json`: your settings and API key.
- `data/projects/<name>/transcript.json`: the transcript.
- `data/projects/<name>/plan.json`: the overlay plan, including your edits.
- `data/projects/<name>/renders/`: exported files.
- `data/projects/<name>/previews/` and `frames/`: cached thumbnails and rendered frames. Safe to delete when you need disk space; they are rebuilt when needed.

To move the app to another computer, copy the folder without `node_modules`, then run `npm install` and `npm run setup` there.

## 6b. Updates

When a new version is published, a blue bar appears at the top of the app: **A new version is available**, with an **Update now** button. Click it. The app downloads the new version, installs it, and restarts itself (if you started it from the Desktop icon or the start file). Your projects, settings and API key are untouched. You can also check by hand in **Settings → Updates → Check for updates**.

## 7. Cost

Planning sends the transcript to Claude once. A 15-minute episode is a few thousand words of input and a short answer. With Opus 5.5 that comes to roughly 10 to 20 cents per plan; the app shows the estimate after each run. Revisions cost about the same. Transcription and rendering are free because they run on your machine.

## 8. When something goes wrong

- **"Port 3777 in use"**: another copy is running. Close it, or start with a different port: `PORT=3800 npm start` (Mac/Linux) or `$env:PORT=3800; npm start` (PowerShell).
- **The "Whisper" dot is red**: Python or faster-whisper is missing. On a Mac, run the one-line install command again; it repairs the Python copy. Otherwise run `npm run setup`, or install by hand with `python3 -m pip install --user faster-whisper`. You can still import SRT subtitles.
- **The "Renderer" dot is red**: run `npx playwright install chromium`.
- **"Claude rejected the API key"**: the key was pasted with a space, or it was deleted in the console. Create a new one.
- **"Rate limit reached"**: wait a minute and try again. New API accounts have low limits for the first days.
- **"Could not reach the Claude API"**: check the internet connection. If the API is blocked on your network, a VPN solves it; the app only needs to reach `api.anthropic.com`.
- **The source looks like HDR**: the app warns when the footage is HDR (PQ or HLG). The burned-in export is made in standard dynamic range. Use the overlay-track export and composite in your editor instead.
- **Transcription is very slow**: pick `large-v3-turbo` or `medium`, close other heavy apps, or transcribe overnight. Importing subtitles from your editor is the fastest path.
- **A card covers something important**: change its corner on the card, reduce the size in Settings, or shorten the text.

## 9. Command line (optional)

Everything also works without the browser:

```bash
node src/cli.js inbox/episode.mp4 --export alpha
```

That creates the project, transcribes, plans with Claude and exports the overlay track. Add `--notes "..."` to direct Claude and `--export burn` for the final video.
