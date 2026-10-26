# La vitrine de Montagio : construire, déployer, mettre à jour

La vitrine est le lien de démo du concours : le jury l'ouvre sans rien installer. Elle montre le vrai Studio :
- le juré choisit une photo d'exemple et un preset, et voit le clip pré-généré correspondant ;
- dans l'onglet Film, il monte un film de 2 ou 3 plans dans son navigateur ;
- il peut remixer et vérifier un preset, télécharger le workflow ComfyUI et lire la page Open Stack.

Elle ne génère rien. Ses clips ont été rendus avec Montagio sur des poids ouverts, et la page le dit.

Conception : `docs/specs/2026-10-18-vitrine-design.md` (dossier parent, hors dépôt).

## 1. Pourquoi une vitrine statique

La première idée était un conteneur Docker (Node + FFmpeg) sur l'offre gratuite de Hugging Face Spaces. Cette offre n'existe plus. La doc officielle, lue le 18/10/2026 (https://huggingface.co/docs/hub/spaces-overview), dit : « Static Spaces are free for everyone. Gradio and Docker Spaces run on compute and require a paid plan to create: PRO for personal accounts ». Le plan PRO coûte 9 $/mois.

Les autres hébergeurs gratuits avec serveur, vérifiés le même jour, ne conviennent pas :

| Hébergeur | Pourquoi il est écarté |
|---|---|
| Render Free | 0,1 CPU et 512 Mo, veille après 15 min, environ 1 min de réveil |
| Railway | 5 $ de crédit d'essai, puis 1 $ par mois |
| Google Cloud Run | carte bancaire obligatoire |
| Fly.io, Koyeb | plus d'offre gratuite pour les nouveaux comptes |

La vitrine est donc un **dossier statique**, `apps/web/out`. Il ne fait tourner aucun serveur et ne se met jamais en veille. Le Studio y fonctionne grâce à un « routeur » qui répond dans la page aux mêmes appels `/api/...` que le serveur, à partir de `showcase/data.json`. Le film de l'onglet Film est monté dans le navigateur du juré par FFmpeg compilé en WebAssembly : ffmpeg.wasm, 31 Mo, chargé une seule fois, au premier film.

## 2. Construire

Prérequis : Node 22, FFmpeg et ffprobe sur le `PATH` (comme pour le reste du projet), et `npm ci` fait.

```bash
npm run showcase:build -w @montagio/web
```

La commande enchaîne cinq étapes :
1. **`npm run check:open-stack`** écrit le rapport que lisent le badge et la page Open Stack.
2. **`npm run showcase -- prepare`** écrit `apps/web/public/showcase/`, un dossier ignoré par git :
   - les clips rendus ;
   - un clip provisoire pour chaque couple preset × photo sans rendu ;
   - la variante 9:16 de chaque clip ;
   - un aperçu léger par preset, pour la galerie ;
   - le workflow ComfyUI de chaque couple ;
   - les photos ;
   - `data.json`.

   Un fichier dont les entrées n'ont pas changé n'est pas refait. Le premier passage prend environ 4 min depuis la passe HD (223 s le 24/10), les suivants quelques secondes.
3. **La copie de ffmpeg.wasm** dans `apps/web/public/ffmpeg/`, avec ses licences (`LICENSES.txt`). La page charge ces fichiers depuis sa propre origine, jamais depuis un CDN.
4. **`next build`** en mode export (`MONTAGIO_SHOWCASE_EXPORT=1`, `NEXT_PUBLIC_MONTAGIO_MODE=showcase`), suivi de deux petits correctifs de l'export de Next 16.4.2 (`scripts/export-fixes.mjs`).

   Ce build passe par `apps/web/.next`, comme un build normal. En mode export, Next 16.4.2 ne se sert de `distDir` que pour renommer `out/` (`node_modules/next/dist/export/utils.js`). Un `distDir` séparé ne protège donc rien. Deux garde-fous existent à la place :
   - `next build` garde `.next/dev` et `.next/cache` : le cache de `next dev` et des e2e n'est pas touché ;
   - le script refuse de démarrer si `.next` contient un build de production (`next build` normal, servi par `next start`, comme celui de l'installeur local). Il faut alors construire la vitrine depuis un autre checkout, ou supprimer `apps/web/.next` puis refaire `next build` avant `next start`.
5. **La fiche du Space** (`apps/web/showcase-space/README.md`) est copiée dans `out/README.md`.

Résultat : `apps/web/out/`, environ 290 Mo, dont 254 Mo pour `showcase/`. Les clips 1080p pèsent environ 5 Mo chacun, leurs variantes 9:16 (720×1280) environ 1,5 Mo, et ffmpeg.wasm 31 Mo. C'est sous la limite d'environ 1 Go d'un Space (partie 7, « Le poids »).

**Build de publication**, avant le dépôt final :

```bash
MONTAGIO_REPO_URL=https://github.com/<compte>/montagio npm run showcase:build -w @montagio/web -- --release
```

La syntaxe `VARIABLE=valeur commande` est celle de Git Bash. Sous PowerShell, définir d'abord la variable : `$env:MONTAGIO_REPO_URL = 'https://github.com/<compte>/montagio'`.

`--release` change deux choses :
- **Vérification stricte** : `showcase verify --strict` refuse les photos et les clips provisoires, ainsi qu'un clip dont le workflow a changé depuis son rendu.
- **Lien vers le code source** : `MONTAGIO_REPO_URL` devient obligatoire. La page affiche ce lien, comme l'exige l'AGPL-3.0 (§13), avec « L'installer chez soi ». Le build refuse une adresse qui n'est pas une URL https absolue, ou qui contient un identifiant ou un jeton.

Sans `--release`, le pied de page affiche « Lien du code source ajouté à la publication ».

**Tester avant de déposer** :

```bash
node apps/web/scripts/serve-static.mjs apps/web/out 3101
```

Ouvrir ensuite http://127.0.0.1:3101/ (le serveur de test n'écoute que sur la machine) et dérouler les vérifications de la partie 4.

## 3. Déployer sur Hugging Face, pas à pas

**C'est le mainteneur du dépôt qui crée le compte et qui publie.**

1. **Créer un compte** sur https://huggingface.co (gratuit), si ce n'est pas déjà fait.
2. **Créer le Space** depuis le site : https://huggingface.co/new-space.
   - Nom : `montagio`.
   - Licence : `agpl-3.0`.
   - SDK : **Static**, modèle « Blank ».
   - Visibilité : **Public**. Un Space « Protected » demande un plan payant.
3. **Installer la CLI et se connecter** :

   ```bash
   pip install -U "huggingface_hub"
   ```

   ```bash
   hf auth login
   ```

   La commande affiche une adresse et un code à valider dans le navigateur. Autre option : coller un jeton d'accès **en écriture**, créé sur https://huggingface.co/settings/tokens. Pour vérifier la connexion : `hf auth whoami`.
4. **Construire** la version de publication (partie 2, avec `--release`).
5. **Envoyer le dossier** :

   ```bash
   hf upload <compte>/montagio apps/web/out . --repo-type=space --commit-message="Montagio showcase"
   ```

   La CLI envoie elle-même les gros fichiers (clips, wasm). Le `README.md` du dossier remplace celui du modèle « Blank » : il déclare `sdk: static` et les dépôts de poids utilisés.
6. **Trouver l'URL directe** : sur la page du Space, menu « ⋮ » puis « Embed this Space ». C'est une adresse en `*.hf.space`. **C'est elle qu'on donne au jury** : elle ouvre la vitrine seule, sans l'habillage de huggingface.co.

Pour mettre à jour la vitrine, reconstruire, puis relancer la même commande `hf upload`.

## 4. Vérifications d'après dépôt

À faire sur l'URL directe, dans Chrome, puis de nouveau dans Firefox :

- [ ] L'accueil s'affiche, avec le badge « 100% open weights — verified » et les trois photos d'exemple.
- [ ] `/open-stack/`, ouvert directement (rechargement compris), liste chaque modèle par fonction (caméra, effets, transitions et hooks, photo, avatar, musique, HD, mouvement), tous en Apache-2.0 ou MIT, et la légende d’un clip mène à la ligne de son modèle.
- [ ] Une photo, un preset, puis « Show clip » : le clip joue, et sa légende dit s'il est provisoire ou pré-généré. Depuis la passe HD (partie 7), elle nomme aussi SeedVR2, et l'ardoise sous le moniteur dit « 1080p ».
- [ ] « Open in ComfyUI » télécharge `montagio-<preset>.json`.
- [ ] Dans l'onglet Film, une photo et trois presets, puis « Assemble film » : le film joue en quelques secondes après le chargement de FFmpeg. « Download film » et « Download 9:16 » fonctionnent.
- [ ] Les étiquettes du film téléchargé sont les bonnes : `ffprobe -v error -show_entries format_tags -of json montagio-film.mp4` doit afficher `"comment": "AI-generated"` après la S3, ou `"Montagio showcase placeholder"` avant.
- [ ] Le bouton FR passe l'interface en français (les noms et descriptions des presets restent en anglais).
- [ ] Dans les outils de développement, la console n'affiche aucune erreur. L'onglet Réseau ne montre aucune requête hors du domaine `*.hf.space` et aucune réponse 404.
- [ ] Le pied de page affiche le lien du code source.

Vérifications faites le : `__/__/2026`, par : `____`.

## 5. Secours : GitHub Pages

Si le Space est indisponible, le même dossier peut être servi par GitHub Pages. Il faut seulement un préfixe d'URL : un site de projet GitHub Pages vit sous `/<dépôt>/`.

1. Construire avec le préfixe :

   ```bash
   MONTAGIO_REPO_URL=https://github.com/<compte>/montagio npm run showcase:build -w @montagio/web -- --release --base-path montagio
   ```

   Le préfixe s'écrit sans barre initiale (`montagio`) : sous Git Bash, `/montagio` serait converti en chemin Windows. Le script écrit aussi `out/.nojekyll`. Sans ce fichier, GitHub Pages ignore le dossier `_next/`.
2. Publier le contenu de `apps/web/out/` sur la branche `gh-pages` du dépôt (ou par l'action « Deploy to GitHub Pages »), puis activer Pages dans les réglages du dépôt. Comme sur Hugging Face, c'est vous qui publiez.
3. Refaire les vérifications de la partie 4 sur `https://<compte>.github.io/montagio/`.

Le préfixe sert pour toutes les URL de la vitrine (`apps/web/src/showcase/urls.ts`) et pour le `basePath` de Next.

## 6. Procédure S3 (24–25/10) : remplacer les clips provisoires

Avant la S3, chaque clip est **provisoire** : FFmpeg déplace une fenêtre sur la photo pour imiter le mouvement du preset. La page le dit, et le fichier porte l'étiquette `Montagio showcase placeholder`, jamais `AI-generated`. La S3 remplace les photos, puis les 33 clips (11 presets × 3 photos, modèle Wan 2.2 Fun Camera).

1. **Les photos** :
   - Générer trois images avec Z-Image-Turbo (Apache-2.0) : deux en 16:9 et une en 9:16. Pas de visage réel, contenu SFW.
   - Les enregistrer à la place de `demo-assets/showcase/samples/landscape-a.jpg`, `landscape-b.jpg` et `portrait-a.jpg` (garder les identifiants, ou les changer partout dans le manifeste).
   - Dans `demo-assets/showcase/manifest.yaml`, compléter pour chaque photo :
     - `title` en anglais et en français ;
     - `credit` : modèle, seed, prompt ;
     - `prompt` : le texte exact donné à Z-Image-Turbo. Il sert aussi de description de la photo pour chaque preset (étape 2), et la vitrine l'affiche dans le champ « Ce que montre la photo » ;
     - `status: final`.
   - Une taille d'environ 1664×960 (ou 960×1664) suffit.
2. **Les clips**, sur le pod, une photo à la fois et un dossier `--out` par appel :

   ```bash
   npm run smoke -w @montagio/infra-runpod -- --preset all --image demo-assets/showcase/samples/landscape-a.jpg --prompt "<le prompt de landscape-a, mot pour mot>" --out s3-results/landscape-a
   ```

   **`--prompt` est indispensable** : sans la description de la photo avant le texte du preset, Fun Camera invente ce qu'il ne voit pas et le clip devient fantôme ([S2_RESULTATS.md](S2_RESULTATS.md), partie 3). `ingest` écarte un rendu fait sans description. Le `prompt` du manifeste convient ; une description propre au clip aussi (« la voiture reste garée »), avec un `--negative` ciblé : `ingest` la note alors dans l'entrée du clip (partie 7).

   Pour goûter plusieurs seeds, ajouter `--runs 2` : la seed augmente de 1 à chaque run. `smoke.jsonl` note désormais la photo de départ (`image`, `image_sha256`).
3. **Rapatrier avant d'éteindre le pod** : les rendus sont payés, il ne faut pas les perdre. Sur le pod, archiver les résultats **et** les photos :

   ```bash
   tar czf /workspace/s3-results-$(date +%Y%m%d-%H%M).tgz s3-results demo-assets/showcase/samples
   ```

   Télécharger l'archive comme celle de la S2 (`docs/S2_CHECKLIST.md`, partie 7), et vérifier qu'elle s'ouvre sur le PC **avant** d'éteindre le pod. Sur le PC, l'extraire à la racine du dépôt : `s3-results/` est ignoré par git, et les photos reprennent leur place sous `demo-assets/showcase/samples/`.
4. **L'intégration, sur le PC**, sur le même commit que celui du pod (le dépôt et FFmpeg y sont) :

   ```bash
   npm run showcase -- ingest s3-results/landscape-a --sample landscape-a
   ```

   `ingest` :
   - garde les rendus réussis, faits sur le bon modèle, à partir de la bonne photo, avec la caméra du preset, avec une description de la photo avant le texte du preset, et à sa taille et sa durée pour ce format. Un rendu `--resolution 720p` est donc écarté (ligne `skipped:`), au lieu d'être réduit en silence ;
   - écarte aussi les rendus de la liste `withheld` du manifeste (partie 7) ;
   - les réencode dans l'encodage commun de la vitrine, avec la mention « AI-generated » ;
   - écrit leurs entrées dans le manifeste : seed, sha256, empreintes de la photo et du workflow, date, et la description (`description`) ou le négatif (`negative`) du rendu quand ils ne sont pas ceux de la photo et du preset.

   S'il y a plusieurs runs pour un preset, choisir avec `--pick crash-push=2` (une option `--pick` par preset).

   **Les exemples d'effets et de hooks**, de la même façon : sur le pod, les effets et un hook par appel, un dossier `--out` par appel (Wardrobe Swap demande aussi `--input2`, la photo de la tenue) :

   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension effect,hook --hook iris-dive --input demo-assets/showcase/samples/landscape-a.jpg --out s3-examples/landscape-a-iris-dive
   ```

   puis, sur le PC, après le rapatriement :

   ```bash
   npm run showcase -- ingest --examples s3-examples/landscape-a-iris-dive --sample landscape-a
   ```

   `ingest --examples` garde les runs `effect:<id>` et `transition:<hook>` réussis, faits à partir de la bonne photo (`image_sha256` de l'enregistrement d'extension) et à 480p pour son format, les réencode avec la mention « AI-generated », garde leur workflow pour « Ouvrir dans ComfyUI », et écrit les sections `effects` et `hooks` du manifeste. L'édition d'un hook (`hook-edit`) n'est pas un exemple : seul son clip l'est. **Un dossier `--out` par appel du smoke** : chaque enregistrement d'extension y porte `run: 1`, et deux appels dans un même dossier y écraseraient le workflow du premier ; `ingest --examples` refuse un dossier qui contient deux fois le même job. Pour choisir entre deux essais d'un effet, refaire l'appel dans un autre dossier et ingérer celui qu'on garde (`--pick` ne sert pas aux exemples).
5. **Le contrôle** :

   ```bash
   npm run showcase -- verify --strict
   ```

   La commande doit finir sur « 0 errors ». Elle vérifie :
   - les sha256 ;
   - les dimensions (1920×1080 ou 1080×1920 après la passe HD), la durée et le codec ;
   - la mention « AI-generated » ;
   - que chaque workflow n'a pas changé depuis son rendu, celui de la passe HD compris ;
   - que chaque clip vient de la photo actuelle (`image_sha256`) ;
   - qu'on peut concaténer sans réencoder les clips d'une même photo, et qu'ils partagent les mêmes en-têtes H.264.
6. **Versionner** `demo-assets/showcase/` (manifeste, photos, clips : environ 75 Mo en 480p, 205 Mo depuis la passe HD de la partie 7), jamais `s3-results/`. Puis reconstruire en `--release` (partie 2) et déposer de nouveau (partie 3).

À savoir :
- **Aperçus de la galerie** : chaque tuile joue son preset sur la première photo. La S3 peut donc se passer des aperçus séparés de `presets/previews/`.
- **Retouche d'un preset après la S3** : corriger un nom ou une description ne change pas le workflow, donc ne casse rien. Toucher à la caméra, au prompt ou à la durée est détecté par `verify --strict` : il faut alors refaire le rendu de ce preset, ou garder l'ancienne version.
- **Photo refaite après un rendu** : `verify` le voit (`image_sha256`) et refuse les clips faits à partir de l'ancienne photo.
- **S3 incomplète** : les couples manquants restent provisoires et signalés comme tels (légende sous le clip, badge sur la tuile, phrase dans la note). `verify --strict` refuse alors la publication. C'est à vous de décider de publier quand même (sans `--release`) ou non.

## 7. La passe HD 1080p (24/10)

Le 24/10, une partie des clips de la S3 a été jugée laide. Le tri (hors dépôt, `tri-qualite-2026-10-24.md` de la vidéo de démo) a donné 18 clips caméra bons, 9 moyens et 6 ratés. La résolution n'en était pas la cause principale : chaque clip était une prise unique, et le sujet partait du cadre (la voiture « garée » qui démarre, la passante qui sort) ou devenait fantôme quand la caméra traversait le bateau du port. Tout a été refait sur Modal (compte `montagio-2`) :
- **15 clips caméra rendus de nouveau en 480p**, à partir de la photo d'exemple exacte, avec une description de la photo propre au clip (`--prompt`, par exemple « The car stays parked and does not move ») et un négatif ciblé (`--negative`), en seed 7, ou 8 pour les reprises ;
- **les 43 clips de la vitrine passés en 1080p** par SeedVR2 (`smoke.ts --extension upscale --clip <clip 480p>`) : les 33 clips caméra (ces 15, et les 18 autres de la S3 tels quels), 9 effets et le hook Ignite.

Bilan caméra après la refonte : 30 bons, 3 moyens, 0 raté.

**Ce que garde le manifeste.** La vitrine ne garde un clip que s'il vient de la photo d'exemple exacte. Un clip 1080p vient d'un second run, dont l'entrée est un clip et non la photo. L'entrée du manifeste note donc toute la chaîne photo → rendu 480p → passe HD :
- `seed`, `image_sha256`, `workflow_sha256` et `rendered_at` restent ceux du rendu 480p ;
- `description` et `negative` notent les textes propres au rendu, quand ce ne sont ni le `prompt` de la photo ni le négatif du preset. **Une description change `workflow_sha256`** : elle entre dans le prompt compilé, donc dans le workflow. Le manifeste la garde pour que `verify` recompile le même workflow, et « Open in ComfyUI » donne le workflow qui a vraiment rendu le clip ;
- `hd` décrit la passe HD : le modèle (`seedvr2-upscale`), sa seed, le nom sous lequel le run a chargé le clip 480p (`input`, il est dans le workflow), le sha256 de ce clip (`source_sha256`), l'empreinte du workflow de la passe et sa date ;
- `sha256` est celui du fichier 1080p de la vitrine.

**L'intégration.** `smoke.jsonl` nomme le clip agrandi sans son sha256. `ingest --hd` relit donc ses octets dans la copie envoyée sur le volume Modal, puis remonte la chaîne :

```bash
MODAL_PROFILE=montagio-2 PYTHONUTF8=1 MSYS_NO_PATHCONV=1 modal volume get montagio-results /inputs C:/chemin/vers/volume
```

```bash
npm run showcase -- ingest --hd <dossier du run upscale> --inputs C:/chemin/vers/volume/inputs --renders <dossier d'un run caméra> --renders <autre dossier>
```

Sous Git Bash, avec `MSYS_NO_PATHCONV=1`, une destination écrite `/c/…` atterrit dans `C:\c\…` : écrire `C:/…`. Un dossier par appel, comme pour les autres `ingest`.

Pour chaque passe HD réussie, `ingest --hd` :
- retrouve le clip 480p qu'elle a pris, à son sha256 : soit un clip ou un exemple de la vitrine tel que `ingest` l'avait écrit (les 18 clips de la S3 et les 10 effets ou hooks), soit la sortie d'un run caméra d'un dossier `--renders`, qui passe alors les mêmes contrôles qu'avec `ingest` (les 15 nouveaux clips) ;
- écarte une passe qu'il ne peut pas rattacher à un rendu (les 8 clips propres à la vidéo de démo), une passe d'un rendu écarté (`withheld`), ou une passe à une autre taille que 1920×1080 ou 1080×1920 pour la photo ;
- prend la sortie à la taille HD (`smoke.ts` liste aussi le clip 480p envoyé parmi les sorties, en `…__r1.mp4`) et la réencode dans l'encodage de la vitrine ;
- refuse un dossier où le même clip a été agrandi deux fois.

Un exemple d'effet ou de hook passe en HD de la même façon, mais il doit d'abord être dans la vitrine en 480p (`ingest --examples`), avec son workflow.

**Ce que montre la page.** `prepare` écrit le modèle de la passe HD de chaque clip et de chaque exemple dans `data.json`. La légende d'un résultat le nomme après le modèle du rendu, chacun lié à sa ligne de la page Open Stack : « Pre-generated with Montagio · Wan 2.2 Fun Camera (Apache-2.0) · in HD by SeedVR2 3B (1080p upscale) (Apache-2.0) · AI-generated ». Un film le nomme quand tous ses plans ont eu la même passe. Quand tous les clips sont en HD, l'ardoise sous le moniteur dit « 1080p » au lieu de « 480p ». Les 9 dossiers du 24/10 ont été intégrés ainsi, avec `--renders` sur les 6 dossiers `refonte-*` et sur celui du pilote.

**Trois effets écartés.** Cake-ify, Explode et Squish sur la passante (`portrait-a`) sont techniquement réussis, mais montrent un couteau qui tranche une personne, une personne dans une explosion et des mains qui écrasent une personne. Ils ont quitté la vitrine (fichiers et workflows supprimés) et sont listés sous `withheld`, avec leur raison : `ingest`, `ingest --examples` et `ingest --hd` les écartent, et le manifeste refuse qu'un rendu écarté soit aussi listé. Les mêmes effets sur la voiture restent.

**Le poids.** En sortie de SeedVR2, les 43 clips pèsent 346 Mo. L'encodage de la vitrine (`SHOWCASE_X264`) est passé de CRF 18 `veryfast` à **CRF 23 `slow`**, le réglage retenu : environ 5 Mo par clip 1080p au lieu de 10, avec un PSNR de 42 à 43 dB par rapport à la sortie de SeedVR2 (45 à 46 dB pour l'ancien réglage), sans différence visible. Les 43 fichiers font 214 Mo dans le dépôt, et la vitrine construite environ 290 Mo. Le dépôt d'un Space Hugging Face est limité à environ 1 Go, historique compris : chaque envoi de clips modifiés s'y ajoute. Avant un nouvel envoi complet (après une passe de fluidification, par exemple), vérifier la place prise dans les réglages du Space, et au besoin écraser son historique (`HfApi().super_squash_history("<compte>/montagio", repo_type="space")`).

**Fluidification.** Une passe HD avec RIFE (`--smooth`, 32 i/s) n'est pas encore prise en charge par la vitrine : `ingest --hd` et `verify` attendent la cadence du preset (16 i/s). Il faudra l'ajouter avec la branche de fluidification, puis refaire la passe HD des clips depuis leur 480p.

## 8. Ce que la vitrine collecte : rien

- Pas de compte, pas de cookie, pas de statistiques, pas de traceur.
- Les polices sont servies par la vitrine elle-même (`next/font`). ffmpeg.wasm aussi.
- Le navigateur garde une seule chose, le choix de langue (`localStorage`).
- Aucune photo n'est envoyée : la vitrine refuse les dépôts de fichier et l'explique.
- Les films sont montés dans le navigateur et n'en sortent que si le juré les télécharge.
- L'e2e de la vitrine échoue si la page fait une seule requête hors de son origine.

Ce que la vitrine ne contrôle pas : **l'hébergeur** (Hugging Face, ou GitHub en secours) voit, comme tout serveur web, les requêtes HTTP (adresse IP, fichiers demandés). Le pied de page dit donc « Montagio ne collecte rien », et non « rien ne quitte votre navigateur ».

## 9. Plus tard : une vraie génération sur GPU loué (non construite)

La décision viendra après la S2 (21–22/10). Le point d'extension est prévu :
- **Côté page** : pour ce qu'un serveur GPU ajouterait, l'interface lit les capacités du routeur (`/api/showcase`) plutôt que le nom du mode (`studioCapabilities`, dans `apps/web/src/lib/showcase-ui.ts`) :
  - `uploads` : choisir ou déposer sa propre photo, à côté des photos d'exemple ;
  - `remixRender` : le bouton qui lance le rendu d'un remix (sans lui, la page explique pourquoi).

  Tant que le routeur n'a pas répondu, les deux restent coupées. Le reste dépend du mode de build (`IS_SHOWCASE`) : les photos d'exemple, les textes propres à la vitrine, les champs de prompt désactivés (les clips sont pré-générés), le préchargement de ffmpeg.wasm, le modèle unique et le pied de page.

  Une génération réelle ajouterait une variable de build, par exemple `NEXT_PUBLIC_MONTAGIO_LIVE_API`. Le routeur enverrait alors les dépôts de photo, les remix et les couples absents du manifeste à un serveur Montagio distant, et passerait ces capacités à `true`. Il faudrait aussi rouvrir les champs de prompt, qui ne lisent encore aucune capacité.
- **Côté serveur** : un serveur Montagio en mode `local` ou `hosted`, sur un GPU loué, qui porterait :
  - un plafond de dépense, avec les secondes GPU comptées et un arrêt au plafond ;
  - un CORS limité à l'origine de la vitrine ;
  - un interrupteur d'arrêt.

Rien de cela n'est écrit aujourd'hui. La vitrine reste gratuite et statique.
