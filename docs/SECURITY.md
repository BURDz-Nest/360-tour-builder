# Security & data classification — read before publishing

These 360 photos may show store / DC / facility interiors. Depending on the
content, that can reveal floor layouts, cash office locations, exits, restricted
areas, or camera positions.

## The core risk

- **Public-read blobs + public GitHub Pages = anyone on the internet** who has
  (or guesses) the URL can view the images and the tour. There is no login.
- A static site cannot authenticate users by itself. "Security through an
  unguessable URL" is not real access control.

## Before publishing sensitive interiors

1. **Confirm the data classification** with your leadership and Information
   Security / data-governance contacts.
2. Prefer **internal GitHub Enterprise Pages** (`gecgithub01.walmart.com`) +
   access-controlled storage for anything non-public, over public `github.com`.
3. Consider **SAS tokens** (expiring URLs) for Azure images instead of
   public-read if the content is sensitive.
4. **Never commit** SAS tokens, connection strings, or `.env` files. The
   `.gitignore` blocks the common ones, and `source-photos/` (raw camera files)
   is ignored by default.

## What this tool does and doesn't do

- It is **storage-agnostic**: it only records the URLs/paths you give it.
- It does **not** add authentication, encryption, or access control.
- **You** own the hosting and access decisions.

When in doubt, keep it internal and ask before making anything public.
