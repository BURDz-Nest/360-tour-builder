# Info Hotspot HTML Templates

Copy-paste snippets for the **description field** of an info hotspot in
ATLAS Explore. Each `.html` file here is a ready-to-use fragment: open it,
copy everything (or the part you need), and paste it into a hotspot's
description in the builder.

## How this works
The description field renders as **live HTML** inside the info popup, so you
can format text, add images, links, video, tables, and more — not just plain
sentences. (See `../ARCHITECTURE.md` for the mechanics.)

## The snippets
| File | What it gives you |
|---|---|
| `01-image-caption.html` | A photo with a caption underneath |
| `02-checklist.html` | A titled checklist / numbered steps |
| `03-callout-note.html` | Colored callout boxes (info / warning / success) |
| `04-policy-link.html` | A short blurb + a big "Read the policy" button-link |
| `05-video-embed.html` | An embedded video (local file or YouTube) |
| `06-spec-table.html` | A small data table (e.g. load limits) |

## Rules of thumb
- **Editable bits** in each file are wrapped in `[[ SQUARE BRACKETS ]]` or an
  HTML comment `<!-- like this -->`. Replace those with your content.
- **Images/video you host yourself:** drop the file in the tour's `images/`
  folder and reference it with a **relative path**, e.g.
  `<img src="images/label-closeup.jpg">`. Relative paths work offline and on a
  kiosk — prefer them over external URLs.
- **Colors** use the official Walmart palette: blue `#0053e2`, spark `#ffc220`,
  success green `#2a8703`, error red `#ea1100`.
- **Accessibility (WCAG AA):** always give images real `alt` text, keep link
  text descriptive ("Read the load-limit policy", not "click here"), and don't
  rely on color alone to convey meaning.
- **Inline styles only.** The popup won't know about custom CSS classes, so
  style with `style="..."` (that's how these templates are written).
- **Trust:** only paste HTML you wrote/trust into the field — it runs as-is.
