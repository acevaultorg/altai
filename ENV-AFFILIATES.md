# ENV-AFFILIATES.md — affiliate tracking URLs via environment variables

Every outbound "Try X →" button on the site can have its tracking URL
swapped in at **build time** from an environment variable, without
editing `data/tools.json`. This is the mechanism operator uses once an
affiliate program approval comes through.

**TL;DR for operator:**

1. Get your tracking URL from Impact / PartnerStack / the vendor dashboard.
2. Add a Vercel Project Environment Variable named `ALTAI_AFFILIATE_<SLUG>`
   (or `ALTAI_AFFILIATE_<SLUG>_NO_UTM=1` if the program forbids UTM params).
3. Redeploy (Vercel triggers a rebuild and the new URL is baked in).
4. That's it. No code change. No `tools.json` edit. No PR.

---

## How env-var swap works

The build script (`scripts/build.js`) calls `affiliateUrl()` for every
outbound link. Lookup order:

1. **Env override** — `ALTAI_AFFILIATE_<SLUG>` is set → that value is the base URL.
2. **Fallback** — raw URL from `data/tools.json` is used.
3. **UTM layering** — `utm_source=altai`, `utm_medium=altai`, `utm_campaign=<source>`
   is appended unless `ALTAI_AFFILIATE_<SLUG>_NO_UTM=1`.

`<SLUG>` is the tool's slug, uppercased with dashes replaced by underscores:

| Slug in `tools.json` | Env variable name |
| --- | --- |
| `jasper` | `ALTAI_AFFILIATE_JASPER` |
| `copyai` | `ALTAI_AFFILIATE_COPYAI` |
| `leonardo-ai` | `ALTAI_AFFILIATE_LEONARDO_AI` |
| `notion-ai` | `ALTAI_AFFILIATE_NOTION_AI` |
| `claude-code` | `ALTAI_AFFILIATE_CLAUDE_CODE` |

One env variable per tool. Applies everywhere that tool appears — its own
page CTA, its name in any other tool's alternatives list, any compare page
it's on, and any blog post it's featured in.

---

## Placeholders — `{source}`, `{campaign}`, `{medium}`

Many programs want a sub-id / click-ref in the tracking URL so you can see
which page drove the click. The env value may contain these placeholders:

| Placeholder | Substituted with | Example |
| --- | --- | --- |
| `{source}` | The `source` arg passed to `affiliateUrl()` — usually the tool.slug of the parent page | `chatgpt`, `jasper`, `vs-chatgpt-winner`, `blog-best-chatgpt-alternatives-2026` |
| `{campaign}` | Same as `{source}` (alias for readability) | — |
| `{medium}` | Usually `altai`; `reference` for the tool's own page | `altai`, `reference` |

All placeholders are URI-encoded before substitution.

### Example — Impact.com (uses subid)

Impact tracking URLs look like:
```
https://jasperai.go2cloud.org/aff_c?offer_id=5&aff_id=123456&source={source}
```

Set:
```
ALTAI_AFFILIATE_JASPER=https://jasperai.go2cloud.org/aff_c?offer_id=5&aff_id=123456&source={source}
```

Generated links:
- On `/tools/jasper-alternatives.html` → `...&source=reference&utm_source=altai&utm_medium=altai&utm_campaign=reference`
- On `/tools/copyai-alternatives.html` (Jasper is an alt) → `...&source=copyai&utm_campaign=copyai`
- On `/compare/jasper-vs-writesonic.html` → `...&source=vs-writesonic-winner&utm_campaign=vs-writesonic-winner`
- On `/blog/best-ai-coding-tools-2026.html` → `...&source=blog-best-ai-coding-tools-2026`

### Example — PartnerStack (uses clickref)

```
ALTAI_AFFILIATE_CURSOR=https://partner.cursor.sh/r/AL-TAI-xyz?clickref={campaign}
```

### Example — ShareASale (no placeholder needed, static link)

```
ALTAI_AFFILIATE_GRAMMARLY=https://shareasale.com/r.cfm?b=12345&u=6789&m=0
```

The site will layer `utm_source=altai&utm_medium=altai&utm_campaign=<page>`
on top automatically so your own analytics still attribute clicks.

---

## `_NO_UTM` — opt out of UTM layering

Some programs (Impact "deep-link redirect" URLs, raw tracking pixels) reject
clicks if extra query params are appended. In that case:

```
ALTAI_AFFILIATE_JASPER=https://impact.com/c/12345/67890/ABC
ALTAI_AFFILIATE_JASPER_NO_UTM=1
```

When `_NO_UTM` is truthy (`1`, `true`, `yes`, `on`), the base URL is emitted
as-is — no `utm_*` appended. Placeholders still substitute.

---

## Operator priority list (P0 → P1 from LAUNCH-CHECKLIST.md §1)

Start all applications in parallel (2–7 days approval each). Set the env
var the moment an approval lands — the next push auto-rebuilds.

| Priority | Tool | Env variable | Program | Typical format |
| --- | --- | --- | --- | --- |
| P0 | Jasper | `ALTAI_AFFILIATE_JASPER` | Impact | `...&source={source}` |
| P0 | Copy.ai | `ALTAI_AFFILIATE_COPYAI` | Impact | `...&source={source}` |
| P0 | Cursor | `ALTAI_AFFILIATE_CURSOR` | PartnerStack | `...?clickref={campaign}` |
| P0 | Grammarly | `ALTAI_AFFILIATE_GRAMMARLY` | Impact | Static ShareASale-style URL |
| P0 | Notion | `ALTAI_AFFILIATE_NOTION_AI` + `ALTAI_AFFILIATE_NOTION` | Impact | `...&subid={source}` |
| P0 | Synthesia | `ALTAI_AFFILIATE_SYNTHESIA` | Impact | `...&source={source}` |
| P1 | ElevenLabs | `ALTAI_AFFILIATE_ELEVENLABS` | PartnerStack | `...?clickref={campaign}` |
| P1 | HeyGen | `ALTAI_AFFILIATE_HEYGEN` | PartnerStack | `...?clickref={campaign}` |
| P1 | Descript | `ALTAI_AFFILIATE_DESCRIPT` | Impact | `...&source={source}` |
| P1 | Leonardo AI | `ALTAI_AFFILIATE_LEONARDO_AI` + `ALTAI_AFFILIATE_LEONARDO` | PartnerStack | `...?clickref={campaign}` |
| P1 | Writesonic | `ALTAI_AFFILIATE_WRITESONIC` | Impact | `...&source={source}` |

**Note on dual slugs:** `Notion` has a slug in tools.json of `notion-ai`,
but the directory page URL is `/tools/notion-ai-alternatives.html`. Set
`ALTAI_AFFILIATE_NOTION_AI` (the canonical slug). If you later add a
"plain Notion" entry, set `ALTAI_AFFILIATE_NOTION` too. Same for
`leonardo-ai` vs `leonardo`.

## Full slug → env-var map (all 212 slugs)

This is the exhaustive list — only set the env var for tools you actually
have an approved tracking URL for. Unset tools fall back to the raw URL
in `tools.json` with UTM attribution.

<details>
<summary>Click to expand — 212 tool slugs</summary>

```
a1111                        → ALTAI_AFFILIATE_A1111
activepieces                 → ALTAI_AFFILIATE_ACTIVEPIECES
adobe-express                → ALTAI_AFFILIATE_ADOBE_EXPRESS
adobe-firefly                → ALTAI_AFFILIATE_ADOBE_FIREFLY
adobe-podcast                → ALTAI_AFFILIATE_ADOBE_PODCAST
affine                       → ALTAI_AFFILIATE_AFFINE
airtable                     → ALTAI_AFFILIATE_AIRTABLE
aiva                         → ALTAI_AFFILIATE_AIVA
albato                       → ALTAI_AFFILIATE_ALBATO
andi                         → ALTAI_AFFILIATE_ANDI
anima                        → ALTAI_AFFILIATE_ANIMA
anyword                      → ALTAI_AFFILIATE_ANYWORD
assemblyai                   → ALTAI_AFFILIATE_ASSEMBLYAI
audacity                     → ALTAI_AFFILIATE_AUDACITY
auphonic                     → ALTAI_AFFILIATE_AUPHONIC
avoma                        → ALTAI_AFFILIATE_AVOMA
bardeen                      → ALTAI_AFFILIATE_BARDEEN
baseten                      → ALTAI_AFFILIATE_BASETEN
beatoven                     → ALTAI_AFFILIATE_BEATOVEN
beautiful-ai                 → ALTAI_AFFILIATE_BEAUTIFUL_AI
bing-image                   → ALTAI_AFFILIATE_BING_IMAGE
bolt                         → ALTAI_AFFILIATE_BOLT
boomy                        → ALTAI_AFFILIATE_BOOMY
brave-search                 → ALTAI_AFFILIATE_BRAVE_SEARCH
bubble                       → ALTAI_AFFILIATE_BUBBLE
canva-ai                     → ALTAI_AFFILIATE_CANVA_AI
capcut                       → ALTAI_AFFILIATE_CAPCUT
cartesia                     → ALTAI_AFFILIATE_CARTESIA
character-ai                 → ALTAI_AFFILIATE_CHARACTER_AI
chatgpt                      → ALTAI_AFFILIATE_CHATGPT
civitai                      → ALTAI_AFFILIATE_CIVITAI
claap                        → ALTAI_AFFILIATE_CLAAP
claude                       → ALTAI_AFFILIATE_CLAUDE
claude-code                  → ALTAI_AFFILIATE_CLAUDE_CODE
clickup-ai                   → ALTAI_AFFILIATE_CLICKUP_AI
cline                        → ALTAI_AFFILIATE_CLINE
coda                         → ALTAI_AFFILIATE_CODA
codesandbox                  → ALTAI_AFFILIATE_CODESANDBOX
cody                         → ALTAI_AFFILIATE_CODY
colossyan                    → ALTAI_AFFILIATE_COLOSSYAN
comfyui                      → ALTAI_AFFILIATE_COMFYUI
confluence-ai                → ALTAI_AFFILIATE_CONFLUENCE_AI
continue                     → ALTAI_AFFILIATE_CONTINUE
copilot                      → ALTAI_AFFILIATE_COPILOT
copyai                       → ALTAI_AFFILIATE_COPYAI
coqui                        → ALTAI_AFFILIATE_COQUI
crello                       → ALTAI_AFFILIATE_CRELLO
crushon                      → ALTAI_AFFILIATE_CRUSHON
cursor                       → ALTAI_AFFILIATE_CURSOR
dalle                        → ALTAI_AFFILIATE_DALLE
decktopus                    → ALTAI_AFFILIATE_DECKTOPUS
deepbrain                    → ALTAI_AFFILIATE_DEEPBRAIN
deepseek                     → ALTAI_AFFILIATE_DEEPSEEK
descript                     → ALTAI_AFFILIATE_DESCRIPT
devin                        → ALTAI_AFFILIATE_DEVIN
did                          → ALTAI_AFFILIATE_DID
diffusionbee                 → ALTAI_AFFILIATE_DIFFUSIONBEE
draftbit                     → ALTAI_AFFILIATE_DRAFTBIT
elai                         → ALTAI_AFFILIATE_ELAI
elevenlabs                   → ALTAI_AFFILIATE_ELEVENLABS
exa                          → ALTAI_AFFILIATE_EXA
fal                          → ALTAI_AFFILIATE_FAL
fathom                       → ALTAI_AFFILIATE_FATHOM
figma-ai                     → ALTAI_AFFILIATE_FIGMA_AI
fireflies                    → ALTAI_AFFILIATE_FIREFLIES
firefly                      → ALTAI_AFFILIATE_FIREFLY
fireworks                    → ALTAI_AFFILIATE_FIREWORKS
fliki                        → ALTAI_AFFILIATE_FLIKI
flux                         → ALTAI_AFFILIATE_FLUX
fooocus                      → ALTAI_AFFILIATE_FOOOCUS
framer                       → ALTAI_AFFILIATE_FRAMER
frase                        → ALTAI_AFFILIATE_FRASE
gamma                        → ALTAI_AFFILIATE_GAMMA
gemini                       → ALTAI_AFFILIATE_GEMINI
ginger                       → ALTAI_AFFILIATE_GINGER
gitpod                       → ALTAI_AFFILIATE_GITPOD
glide                        → ALTAI_AFFILIATE_GLIDE
grain                        → ALTAI_AFFILIATE_GRAIN
grammarly                    → ALTAI_AFFILIATE_GRAMMARLY
grok                         → ALTAI_AFFILIATE_GROK
groq                         → ALTAI_AFFILIATE_GROQ
hailuo                       → ALTAI_AFFILIATE_HAILUO
haiper                       → ALTAI_AFFILIATE_HAIPER
hedra                        → ALTAI_AFFILIATE_HEDRA
hemingway                    → ALTAI_AFFILIATE_HEMINGWAY
heygen                       → ALTAI_AFFILIATE_HEYGEN
huggingchat                  → ALTAI_AFFILIATE_HUGGINGCHAT
huggingface                  → ALTAI_AFFILIATE_HUGGINGFACE
hyperwrite                   → ALTAI_AFFILIATE_HYPERWRITE
ideogram                     → ALTAI_AFFILIATE_IDEOGRAM
ifttt                        → ALTAI_AFFILIATE_IFTTT
invideo                      → ALTAI_AFFILIATE_INVIDEO
janitorai                    → ALTAI_AFFILIATE_JANITORAI
jasper                       → ALTAI_AFFILIATE_JASPER
jetbrains-ai                 → ALTAI_AFFILIATE_JETBRAINS_AI
kagi                         → ALTAI_AFFILIATE_KAGI
kimi                         → ALTAI_AFFILIATE_KIMI
kindroid                     → ALTAI_AFFILIATE_KINDROID
kling                        → ALTAI_AFFILIATE_KLING
kokoro                       → ALTAI_AFFILIATE_KOKORO
komo                         → ALTAI_AFFILIATE_KOMO
krea                         → ALTAI_AFFILIATE_KREA
krisp                        → ALTAI_AFFILIATE_KRISP
languagetool                 → ALTAI_AFFILIATE_LANGUAGETOOL
leonardo                     → ALTAI_AFFILIATE_LEONARDO
leonardo-ai                  → ALTAI_AFFILIATE_LEONARDO_AI
leonardo-motion              → ALTAI_AFFILIATE_LEONARDO_MOTION
lindy                        → ALTAI_AFFILIATE_LINDY
linguix                      → ALTAI_AFFILIATE_LINGUIX
locofy                       → ALTAI_AFFILIATE_LOCOFY
loom                         → ALTAI_AFFILIATE_LOOM
loudly                       → ALTAI_AFFILIATE_LOUDLY
lovable                      → ALTAI_AFFILIATE_LOVABLE
lovo                         → ALTAI_AFFILIATE_LOVO
luma                         → ALTAI_AFFILIATE_LUMA
magicslides                  → ALTAI_AFFILIATE_MAGICSLIDES
make                         → ALTAI_AFFILIATE_MAKE
mem                          → ALTAI_AFFILIATE_MEM
midjourney                   → ALTAI_AFFILIATE_MIDJOURNEY
minimax                      → ALTAI_AFFILIATE_MINIMAX
mistral                      → ALTAI_AFFILIATE_MISTRAL
modal                        → ALTAI_AFFILIATE_MODAL
moemate                      → ALTAI_AFFILIATE_MOEMATE
mureka                       → ALTAI_AFFILIATE_MUREKA
murf                         → ALTAI_AFFILIATE_MURF
n8n                          → ALTAI_AFFILIATE_N8N
neuraltext                   → ALTAI_AFFILIATE_NEURALTEXT
nightcafe                    → ALTAI_AFFILIATE_NIGHTCAFE
notebooklm                   → ALTAI_AFFILIATE_NOTEBOOKLM
notion-ai                    → ALTAI_AFFILIATE_NOTION_AI
notta                        → ALTAI_AFFILIATE_NOTTA
obsidian-ai                  → ALTAI_AFFILIATE_OBSIDIAN_AI
openai-tts                   → ALTAI_AFFILIATE_OPENAI_TTS
openrouter                   → ALTAI_AFFILIATE_OPENROUTER
opus                         → ALTAI_AFFILIATE_OPUS
otter                        → ALTAI_AFFILIATE_OTTER
pabbly                       → ALTAI_AFFILIATE_PABBLY
perplexity                   → ALTAI_AFFILIATE_PERPLEXITY
phind                        → ALTAI_AFFILIATE_PHIND
picsart                      → ALTAI_AFFILIATE_PICSART
pictory                      → ALTAI_AFFILIATE_PICTORY
pika                         → ALTAI_AFFILIATE_PIKA
pipedream                    → ALTAI_AFFILIATE_PIPEDREAM
pitch                        → ALTAI_AFFILIATE_PITCH
pixverse                     → ALTAI_AFFILIATE_PIXVERSE
playground                   → ALTAI_AFFILIATE_PLAYGROUND
playground-ai                → ALTAI_AFFILIATE_PLAYGROUND_AI
playht                       → ALTAI_AFFILIATE_PLAYHT
podcastle                    → ALTAI_AFFILIATE_PODCASTLE
poe                          → ALTAI_AFFILIATE_POE
prezi                        → ALTAI_AFFILIATE_PREZI
prowritingaid                → ALTAI_AFFILIATE_PROWRITINGAID
quillbot                     → ALTAI_AFFILIATE_QUILLBOT
read-ai                      → ALTAI_AFFILIATE_READ_AI
recraft                      → ALTAI_AFFILIATE_RECRAFT
reflect                      → ALTAI_AFFILIATE_REFLECT
relay                        → ALTAI_AFFILIATE_RELAY
replicate                    → ALTAI_AFFILIATE_REPLICATE
replika                      → ALTAI_AFFILIATE_REPLIKA
replit                       → ALTAI_AFFILIATE_REPLIT
resemble                     → ALTAI_AFFILIATE_RESEMBLE
rev                          → ALTAI_AFFILIATE_REV
riverside                    → ALTAI_AFFILIATE_RIVERSIDE
runpod                       → ALTAI_AFFILIATE_RUNPOD
runway                       → ALTAI_AFFILIATE_RUNWAY
rytr                         → ALTAI_AFFILIATE_RYTR
screenpal                    → ALTAI_AFFILIATE_SCREENPAL
simplified                   → ALTAI_AFFILIATE_SIMPLIFIED
slides-ai                    → ALTAI_AFFILIATE_SLIDES_AI
slides-com                   → ALTAI_AFFILIATE_SLIDES_COM
snappa                       → ALTAI_AFFILIATE_SNAPPA
sora                         → ALTAI_AFFILIATE_SORA
soundraw                     → ALTAI_AFFILIATE_SOUNDRAW
speechify                    → ALTAI_AFFILIATE_SPEECHIFY
stable-audio                 → ALTAI_AFFILIATE_STABLE_AUDIO
stable-diffusion             → ALTAI_AFFILIATE_STABLE_DIFFUSION
stackblitz                   → ALTAI_AFFILIATE_STACKBLITZ
sudowrite                    → ALTAI_AFFILIATE_SUDOWRITE
suno                         → ALTAI_AFFILIATE_SUNO
surfer-seo                   → ALTAI_AFFILIATE_SURFER_SEO
svd                          → ALTAI_AFFILIATE_SVD
synthesia                    → ALTAI_AFFILIATE_SYNTHESIA
tabnine                      → ALTAI_AFFILIATE_TABNINE
tactiq                       → ALTAI_AFFILIATE_TACTIQ
tavern-ai                    → ALTAI_AFFILIATE_TAVERN_AI
tella                        → ALTAI_AFFILIATE_TELLA
tldv                         → ALTAI_AFFILIATE_TLDV
together                     → ALTAI_AFFILIATE_TOGETHER
tome                         → ALTAI_AFFILIATE_TOME
udio                         → ALTAI_AFFILIATE_UDIO
uizard                       → ALTAI_AFFILIATE_UIZARD
v0                           → ALTAI_AFFILIATE_V0
veed                         → ALTAI_AFFILIATE_VEED
veo                          → ALTAI_AFFILIATE_VEO
vidu                         → ALTAI_AFFILIATE_VIDU
vimeo-clip                   → ALTAI_AFFILIATE_VIMEO_CLIP
visme                        → ALTAI_AFFILIATE_VISME
wandb                        → ALTAI_AFFILIATE_WANDB
webflow                      → ALTAI_AFFILIATE_WEBFLOW
wellsaid                     → ALTAI_AFFILIATE_WELLSAID
whisper                      → ALTAI_AFFILIATE_WHISPER
whitesmoke                   → ALTAI_AFFILIATE_WHITESMOKE
windsurf                     → ALTAI_AFFILIATE_WINDSURF
wix-studio                   → ALTAI_AFFILIATE_WIX_STUDIO
wordtune                     → ALTAI_AFFILIATE_WORDTUNE
writesonic                   → ALTAI_AFFILIATE_WRITESONIC
you                          → ALTAI_AFFILIATE_YOU
zapier                       → ALTAI_AFFILIATE_ZAPIER
zed                          → ALTAI_AFFILIATE_ZED
zoom-ai                      → ALTAI_AFFILIATE_ZOOM_AI
```

</details>

---

## Testing locally

```bash
# No env → falls back to naked URLs with UTM
node scripts/build.js
grep 'data-affiliate="jasper"' tools/copyai-alternatives.html

# With env override — simulate an Impact URL
ALTAI_AFFILIATE_JASPER='https://jasperai.go2cloud.org/aff_c?offer_id=5&aff_id=123&source={source}' \
  node scripts/build.js
grep 'jasperai.go2cloud' tools/jasper-alternatives.html

# With _NO_UTM — for tracking URLs that reject extra params
ALTAI_AFFILIATE_JASPER='https://impact.com/c/12345/67890/ABC' \
ALTAI_AFFILIATE_JASPER_NO_UTM=1 \
  node scripts/build.js
```

---

## Email provider — `ALTAI_EMAIL_PROVIDER` family

The homepage + every tool/compare page carries an email form. Until a
provider is configured, submitting the form shows "Newsletter signup isn't
live yet" — never a fake success.

Pick one provider, set its env vars on Vercel, redeploy. Four supported
providers, one env var each to identify the account:

| Provider | Required env vars | Free tier |
| --- | --- | --- |
| **Buttondown** | `ALTAI_EMAIL_PROVIDER=buttondown`<br>`ALTAI_EMAIL_BUTTONDOWN_USER=<username>` | 100 subs |
| **ConvertKit** | `ALTAI_EMAIL_PROVIDER=convertkit`<br>`ALTAI_EMAIL_CONVERTKIT_FORM_ID=<form_id>` | 1,000 subs |
| **Beehiiv** | `ALTAI_EMAIL_PROVIDER=beehiiv`<br>`ALTAI_EMAIL_BEEHIIV_PUB_ID=<pub_id>` | 2,500 subs |
| **Custom** (Mailgun, SendGrid, self-host) | `ALTAI_EMAIL_PROVIDER=custom`<br>`ALTAI_EMAIL_CUSTOM_ENDPOINT=<url>`<br>`ALTAI_EMAIL_CUSTOM_FIELD=<field>` (optional, default `email`) | — |

The build script resolves these at build time and emits a single
`<script>window.ALTAI_EMAIL_ENDPOINT=…;window.ALTAI_EMAIL_FIELD=…;</script>`
into every page head. `js/main.js` reads those globals at runtime and
POSTs with the right field name.

Test without deploying:
```bash
ALTAI_EMAIL_PROVIDER=buttondown ALTAI_EMAIL_BUTTONDOWN_USER=altai node scripts/build.js
grep window.ALTAI_EMAIL_ENDPOINT index.html
# → window.ALTAI_EMAIL_ENDPOINT="https://buttondown.email/api/emails/embed-subscribe/altai"
```

---

## Setting env vars on Vercel

Vercel dashboard → Project → Settings → Environment Variables → Add new.

- **Name:** `ALTAI_AFFILIATE_JASPER` (exact, uppercase)
- **Value:** full tracking URL with `{source}` / `{campaign}` placeholder if needed
- **Environments:** Production (and Preview if you want to test)
- **Type:** Plaintext (not a secret — tracking URLs are public-by-design once rendered)

After saving, trigger a redeploy — the new env var is only read at build time,
not at runtime.
