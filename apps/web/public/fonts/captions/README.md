# Caption fonts

The fonts of the burned-in captions (9:16 export). They are embedded here and never fetched at render time:
- FFmpeg (libass) reads them from this folder;
- the Studio shows the style samples with them through `@font-face`.

Each file is the upstream TTF, unchanged, under the SIL Open Font License 1.1, with its licence beside it. The fonts were downloaded on 2026-10-25 at the commits named in the URLs.

| File | Family | Licence | Licence file | Source | sha256 |
|---|---|---|---|---|---|
| `Poppins-Bold.ttf` | Poppins (Bold) | OFL-1.1 | `OFL-Poppins.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/poppins/Poppins-Bold.ttf | 983676516167748b74de6f4771fb384c664fd913acb8b471122ecacf5da5ea6c |
| `Anton-Regular.ttf` | Anton | OFL-1.1 | `OFL-Anton.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/anton/Anton-Regular.ttf | a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab |
| `BebasNeue-Regular.ttf` | Bebas Neue | OFL-1.1 | `OFL-BebasNeue.txt` | https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/bebasneue/BebasNeue-Regular.ttf | 08e4623805102d819f58601e46e345648846075e363b2ceb23313c2d1c83ec73 |
| `Montserrat-Bold.ttf` | Montserrat (Bold) | OFL-1.1 | `OFL-Montserrat.txt` | https://raw.githubusercontent.com/JulietaUla/Montserrat/555facfb2a18c72c3c0380f0d9c0f060453a9058/fonts/ttf/Montserrat-Bold.ttf | bc6e854971cea46b463be6f9eef4d9cd52f51cfc1fc0dd90c9d3e6483dc0ec61 |

Every letter of the 22 caption languages is in each file. `apps/web/test/captions-fonts.test.ts` checks the files, their sha256 and their glyphs, and the list of languages is in `packages/captions/src/languages.ts`. Vietnamese is not covered: Poppins and Bebas Neue lack its stacked accents.
