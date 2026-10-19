# La vitrine de Montagio : construire, déployer, mettre à jour

La vitrine est le lien de démo du concours : le jury l'ouvre sans rien installer. Elle montre le vrai Studio :
- le juré choisit une photo d'exemple et un preset, et voit le clip pré-généré correspondant ;
- en mode Séquence, il monte un film de 2 ou 3 plans dans son navigateur ;
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

La vitrine est donc un **dossier statique**, `apps/web/out`. Il ne fait tourner aucun serveur et ne se met jamais en veille. Le Studio y fonctionne grâce à un « routeur » qui répond dans la page aux mêmes appels `/api/...` que le serveur, à partir de `showcase/data.json`. Le film de la Séquence est monté dans le navigateur du juré par FFmpeg compilé en WebAssembly : ffmpeg.wasm, 31 Mo, chargé une seule fois, au premier film.

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

   Un fichier dont les entrées n'ont pas changé n'est pas refait. Le premier passage prend environ 80 s, les suivants environ 3 s.
3. **La copie de ffmpeg.wasm** dans `apps/web/public/ffmpeg/`, avec ses licences (`LICENSES.txt`). La page charge ces fichiers depuis sa propre origine, jamais depuis un CDN.
4. **`next build`** en mode export (`MONTAGIO_SHOWCASE_EXPORT=1`, `NEXT_PUBLIC_MONTAGIO_MODE=showcase`), suivi de deux petits correctifs de l'export de Next 16.4.2 (`scripts/export-fixes.mjs`).

   Ce build passe par `apps/web/.next`, comme un build normal. En mode export, Next 16.4.2 ne se sert de `distDir` que pour renommer `out/` (`node_modules/next/dist/export/utils.js`). Un `distDir` séparé ne protège donc rien. Deux garde-fous existent à la place :
   - `next build` garde `.next/dev` et `.next/cache` : le cache de `next dev` et des e2e n'est pas touché ;
   - le script refuse de démarrer si `.next` contient un build de production (`next build` normal, servi par `next start`, comme celui de l'installeur local). Il faut alors construire la vitrine depuis un autre checkout, ou supprimer `apps/web/.next` puis refaire `next build` avant `next start`.
5. **La fiche du Space** (`apps/web/showcase-space/README.md`) est copiée dans `out/README.md`.

Résultat : `apps/web/out/`, environ 160 Mo. Les clips pèsent environ 1,7 Mo chacun, leurs variantes 9:16 environ 1,9 Mo, et ffmpeg.wasm 31 Mo.

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

**C'est vous qui créez le compte et qui publiez** : rien n'est publié automatiquement.

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
- [ ] `/open-stack/`, ouvert directement (rechargement compris), liste les trois modèles en Apache-2.0.
- [ ] Une photo, un preset, puis « Show clip » : le clip joue, et sa légende dit s'il est provisoire ou pré-généré.
- [ ] « Open in ComfyUI » télécharge `montagio-<preset>.json`.
- [ ] En Séquence, une photo et trois presets, puis « Assemble film » : le film joue en quelques secondes après le chargement de FFmpeg. « Download film » et « Download 9:16 » fonctionnent.
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

Avant la S3, chaque clip est **provisoire** : FFmpeg déplace une fenêtre sur la photo pour imiter le mouvement du preset. La page le dit, et le fichier porte l'étiquette `Montagio showcase placeholder`, jamais `AI-generated`. La S3 remplace les photos, puis les 36 clips (12 presets × 3 photos, modèle Wan 2.2 Fun Camera).

1. **Les photos** :
   - Générer trois images avec Z-Image-Turbo (Apache-2.0) : deux en 16:9 et une en 9:16. Pas de visage réel, contenu SFW.
   - Les enregistrer à la place de `demo-assets/showcase/samples/landscape-a.jpg`, `landscape-b.jpg` et `portrait-a.jpg` (garder les identifiants, ou les changer partout dans le manifeste).
   - Dans `demo-assets/showcase/manifest.yaml`, compléter pour chaque photo :
     - `title` en anglais et en français ;
     - `credit` : modèle, seed, prompt ;
     - `status: final`.
   - Une taille d'environ 1664×960 (ou 960×1664) suffit.
2. **Les clips**, sur le pod, une photo à la fois et un dossier `--out` par appel :

   ```bash
   npm run smoke -w @montagio/infra-runpod -- --preset all --image demo-assets/showcase/samples/landscape-a.jpg --out s3-results/landscape-a
   ```

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
   - garde les rendus réussis, faits sur le bon modèle, à partir de la bonne photo, avec la caméra du preset, et à sa taille et sa durée pour ce format. Un rendu `--resolution 720p` est donc écarté (ligne `skipped:`), au lieu d'être réduit en silence ;
   - les réencode dans l'encodage commun de la vitrine, avec la mention « AI-generated » ;
   - écrit leurs entrées dans le manifeste : seed, sha256, empreintes de la photo et du workflow, date.

   S'il y a plusieurs runs pour un preset, choisir avec `--pick crash-push=2` (une option `--pick` par preset).
5. **Le contrôle** :

   ```bash
   npm run showcase -- verify --strict
   ```

   La commande doit finir sur « 0 errors ». Elle vérifie :
   - les sha256 ;
   - les dimensions, la durée et le codec ;
   - la mention « AI-generated » ;
   - que chaque workflow n'a pas changé depuis son rendu ;
   - que chaque clip vient de la photo actuelle (`image_sha256`) ;
   - qu'on peut concaténer sans réencoder les clips d'une même photo, et qu'ils partagent les mêmes en-têtes H.264.
6. **Versionner** `demo-assets/showcase/` (manifeste, photos, clips : environ 40 à 70 Mo), jamais `s3-results/`. Puis reconstruire en `--release` (partie 2) et déposer de nouveau (partie 3).

À savoir :
- **Aperçus de la galerie** : chaque tuile joue son preset sur la première photo. La S3 peut donc se passer des aperçus séparés de `presets/previews/`.
- **Retouche d'un preset après la S3** : corriger un nom ou une description ne change pas le workflow, donc ne casse rien. Toucher à la caméra, au prompt ou à la durée est détecté par `verify --strict` : il faut alors refaire le rendu de ce preset, ou garder l'ancienne version.
- **Photo refaite après un rendu** : `verify` le voit (`image_sha256`) et refuse les clips faits à partir de l'ancienne photo.
- **S3 incomplète** : les couples manquants restent provisoires et signalés comme tels (légende sous le clip, badge sur la tuile, phrase dans la note). `verify --strict` refuse alors la publication. C'est à vous de décider de publier quand même (sans `--release`) ou non.

## 7. Ce que la vitrine collecte : rien

- Pas de compte, pas de cookie, pas de statistiques, pas de traceur.
- Les polices sont servies par la vitrine elle-même (`next/font`). ffmpeg.wasm aussi.
- Le navigateur garde une seule chose, le choix de langue (`localStorage`).
- Aucune photo n'est envoyée : la vitrine refuse les dépôts de fichier et l'explique.
- Les films sont montés dans le navigateur et n'en sortent que si le juré les télécharge.
- L'e2e de la vitrine échoue si la page fait une seule requête hors de son origine.

Ce que la vitrine ne contrôle pas : **l'hébergeur** (Hugging Face, ou GitHub en secours) voit, comme tout serveur web, les requêtes HTTP (adresse IP, fichiers demandés). Le pied de page dit donc « Montagio ne collecte rien », et non « rien ne quitte votre navigateur ».

## 8. Plus tard : une vraie génération sur GPU loué (non construite)

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
