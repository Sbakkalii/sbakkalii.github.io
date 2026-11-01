# sbakkalii.github.io

Personal site of Souhail Bakkali — research and products in Document
Intelligence. Built with Jekyll and served by GitHub Pages straight from
`main` (no build step to configure: Pages builds it with the `github-pages`
gem).

The site is organized around the 2026 survey *Amnesia by Design, Memory By
Necessity: Persistent State for Document Intelligence* (arXiv:2609.32041) and
the six SynaptYon products that implement it, one per part of its
architecture (Mnemos, Argus, Chronos, Ariadne, Lethe, Anamnesis).

## Where things live

| What | Where |
| --- | --- |
| Profile, links, bibliometrics (with source and date) | `_data/profile.yml` |
| Publications, one file each (front matter = the record, incl. BibTeX) | `_publications/*.md` |
| Research themes used for filtering | `_data/themes.yml` |
| The paper explorer's content (tables, equations, lists) | `_data/paper.yml` |
| Products, the capability stack, datasets & benchmarks | `_data/products.yml` |
| Fictional documents used by every demo | `_data/demo.yml` |
| Grants, collaborations, service · talks · teaching | `_data/activities.yml`, `_data/talks.yml`, `_data/teaching.yml` |
| Pages | `_pages/` |
| Layouts and shared partials | `_layouts/`, `_includes/` |
| Interactive components (markup · script · styles) | `_includes/components/<name>.html`, `assets/js/components/<name>.js`, `_includes/css/components/<name>.css` |
| Design tokens and global styles | `_includes/css/` (bundled into `assets/css/site.css` at build time) |

## Common edits

**Add a publication.** Copy any file in `_publications/`, rename it
`YYYY-short-slug.md`, and fill the front matter: `title`, `date`, `authors`
(abbreviated, with `S. Bakkali` exactly so it is highlighted), `venue`,
`venue_short`, `pub_type` (`journal`, `conference`, `workshop`, `preprint` or
`thesis`), `themes` (ids from `_data/themes.yml`), links (`paperurl`, `arxiv`,
`doi`, `hal`, `url_ext`), a one-sentence `summary`, and a `bibtex` block. Add
`featured: true` to show it on the home page and `first_author: true` when it
applies. Counts, the CV lists, the search index and the feed update
themselves.

**Update citation metrics.** Edit `metrics` in `_data/profile.yml`, including
`as_of`.

**Change a product's status or copy.** `_data/products.yml`. The SynaptYon
site keeps an identical copy, so change both. Each product's `demo` names an
include in `_includes/components/`, and its `metrics` are ids from
`harness.metrics` in `_data/paper.yml`.

## Interactive components

Every component is a progressive enhancement: the include renders complete
static HTML (readable without JavaScript and by search engines) and
`assets/js/site.js` loads the component's module when it nears the viewport.
There are no runtime dependencies and no build step; modules are plain ES
modules.

## Run locally

With Docker, using the same image GitHub Pages uses:

```sh
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/src:ro -v "$PWD/_site":/out \
  -e JEKYLL_ENV=production -e HOME=/tmp --workdir /usr/local/bundle \
  --entrypoint /usr/local/bundle/bin/github-pages \
  ghcr.io/actions/jekyll-build-pages:v1.0.13 build --source /src --destination /out
python3 -m http.server 4000 --directory _site
```

Or with Ruby (needs the Ruby development headers): `bundle install` then
`bundle exec jekyll serve`.
