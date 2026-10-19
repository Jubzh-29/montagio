# Session GPU S2 : pas-à-pas

Date prévue : 21–22/10/2026. C'est la **première session GPU** : la S1 du 18/10 a été remplacée par une analyse sans GPU ([S1_ANALYSE.md](S1_ANALYSE.md)). Durée visée : 6 h 30 à 8 h 30 de RTX 4090, dont 2 h 30 pour les extensions. Budget : environ 0,34 $/h en Community Cloud, soit 2,20 à 2,90 $ (spec §10).

**Objet :**
- premier rendu réel ;
- mesures de mémoire et de temps ;
- réglage des 12 presets et test de l'enchaînement de plans ;
- les vérifications que l'analyse a laissées au GPU (partie 6) ;
- les extensions du 19/10, dans leur ordre de priorité réorienté : édition d'image, pack de 6 effets, transitions par images clés, avatar parlant, musique, upscale HD (partie 6.8, [EXTENSIONS_ANALYSE.md](EXTENSIONS_ANALYSE.md)). Une extension que la session n'a pas validée sera masquée de la démo le 25/10 au soir ; si la session déborde, l'upscale est le premier à couper.

**Déjà prêt, grâce à l'analyse :**
- lock exact (URL, taille et sha256 de chaque poids) ;
- workflows tirés des templates officiels et validés par un vrai ComfyUI v0.41.0 ;
- node « Montagio Camera Embedding » pour les mouvements combinés ;
- workflows, poids (au lock) et compilateurs des 6 extensions, validés par un vrai ComfyUI v0.41.0 sauf la voix de l'avatar ;
- licences lues à la source.

Les outils sont dans [`infra/runpod/`](../infra/runpod/README.md) :

| Fichier | Rôle |
|---|---|
| `bootstrap.sh` | Installe ComfyUI v0.41.0 (commit vérifié), PyTorch, comfy-api-proxy 0.1.6 et Node 22. Lance ComfyUI avec `--disable-partner-nodes`, et le proxy sur `127.0.0.1:8189`. S'arrête si un seul node partenaire est chargé. |
| `fetch-weights.ts` | Télécharge les fichiers du lock, et vérifie chacun contre le sha256 et la taille du lock **avant** de télécharger, puis après. |
| `smoke.ts` | Compile des presets, les envoie par le Comfy SDK au proxy, télécharge les clips et note temps et VRAM dans `s1-results/smoke.jsonl`. |
| `versions.env` | Toutes les versions épinglées. |

Tout ce qui sort de la session va dans `s1-results/`. Le nom est resté celui de la S1 ; le dossier est ignoré par git. Le tout part dans une archive à télécharger avant d'éteindre le pod.

## Déroulé en un coup d'œil

| Étape | Durée | GPU facturé |
|---|---|---|
| 0. Préparer sur le PC (la veille) | 20 min | non |
| 1. Créer le pod | 10 min | à partir du démarrage |
| 2. Copier le dépôt | 5 min | oui |
| 3. Installer et lancer, pack Montagio compris | 20 à 30 min | oui |
| 4. Télécharger les poids | 20 à 50 min | oui |
| 5. Premiers rendus et mesures | 45 min | oui |
| 6. Vérifications et réglage des presets | 2 à 3 h | oui |
| 6.8 Les extensions | ≈ 2 h 30 | oui |
| 7. Rassembler, télécharger, éteindre | 15 min | jusqu'à l'arrêt |

## 0. La veille, sur votre PC (sans GPU)

1. Vérifiez que la branche de l'analyse est fusionnée, puis empaquetez le dépôt :
   ```bash
   git -C montagio log -1 --oneline
   git -C montagio bundle create ../montagio.bundle --all
   ```
2. Runpod (c'est à vous de le faire) : mettez seulement le crédit que vous acceptez de dépenser, par exemple 10 $, **sans recharge automatique**.
3. Préparez une photo de départ dont vous avez les droits : sans personne reconnaissable, SFW, en 16:9, avec un premier plan et un fond.
4. **Q5, Comfy Cloud**, avec votre compte et sans rien lancer de payant (voir [S1_ANALYSE.md](S1_ANALYSE.md), partie 9) :
   - ouvrez les templates « Wan 2.2 Fun Camera », « Wan 2.2 5B » et « Z-Image-Turbo » ;
   - vérifiez qu'aucun modèle n'est signalé manquant ;
   - notez la version de ComfyUI.
5. Facultatif : avec votre compte Hugging Face, comparez le sha256 de `ae.safetensors` sur `black-forest-labs/FLUX.1-schnell` à celui du lock (`afc8e282…`).
6. Gardez la fiche de la partie 8 sous la main.

## 1. Créer le pod (≈ 10 min)

1. Runpod → **Pods** → **Deploy**.
2. GPU : **RTX 4090** (24 Go), en Community Cloud. Notez le prix horaire.
3. Filtre **CUDA version** : **13.0**. Sur un hôte limité à CUDA 12.8, le script se rabat sur torch 2.11 (cu128).
4. Template : **Runpod PyTorch**, le plus récent.
5. **Edit Template** :
   - Container Disk : 40 Go ;
   - Volume Disk : **300 Go**, monté sur `/workspace` : 189 Go de poids (70 Go pour les presets, 119 Go pour les extensions), 15 Go de PyTorch et d'outils, les sorties et la marge ; **350 Go** si vous prévoyez aussi l'essai de l'installeur local (encadré de la partie 7), qui télécharge sa propre copie des 70 Go des presets ;
   - Expose HTTP Ports : `8888` et **`8188`** ;
   - aucune variable d'environnement contenant une clé.
6. **On-Demand**, pas Spot. Notez l'heure de démarrage.

## 2. Copier le dépôt sur le pod (≈ 5 min)

Pod → **Connect** → **JupyterLab**. Glissez `montagio.bundle` dans `/workspace`, puis ouvrez un terminal :
```bash
cd /workspace
git clone montagio.bundle montagio
cd montagio
git log -1 --oneline
```

## 3. Installer et lancer, pack Montagio compris (≈ 20 à 30 min)

```bash
bash infra/runpod/bootstrap.sh --expose-ui
source /workspace/montagio.env
```

À noter :
- la ligne `GPU: NVIDIA GeForce RTX 4090, …` ;
- `torch 2.14.1+cu130 …` ;
- `Montagio node pack: /workspace/ComfyUI/custom_nodes/montagio -> /workspace/montagio/comfy-nodes` ;
- **`<n> node classes loaded, 0 partner node(s)`**, la preuve « aucun Partner Node », **sans** ligne `warning: nodes missing` à la suite ;
- `proxy: {"status": "healthy", …}`.

**Node de la voix (extension avatar).** Le bootstrap clone `wildminder/ComfyUI-Chatterbox` au commit de `versions.env`, lui retire ses routes HTTP (patch `infra/runpod/patches/`), installe ses 5 paquets Python par leurs hash (`requirements-chatterbox.txt`) et lance ComfyUI avec `HF_HUB_OFFLINE=1`. Il le fait en dernier : un échec (clone, patch, paquet) affiche `warning: the avatar's voice node is not installed` sans arrêter l'installation. Une ligne `warning: nodes missing: ChatterboxMTLTTS` signifie que le node ne s'est pas chargé ; son erreur est dans `/workspace/logs/comfyui.log` (cause probable : `torchaudio` 2.11.0 sur torch 2.14.1). Ce n'est bloquant que pour l'avatar.

**Pack Montagio, obligatoire.** Les presets combinés (Rise & Push, Drift Left Push, Pull Back & Tilt Up, Push & Settle et Breathing) passent par son node `MontagioCameraEmbedding`. Le bootstrap relie le pack dans `custom_nodes` avant de lancer ComfyUI, puis vérifie que ce node est chargé : rien à faire à la main. Pour le contrôler :
```bash
python3 comfy-nodes/scripts/smoke_comfyui.py http://127.0.0.1:8188; echo "code $?"
curl -s http://127.0.0.1:8188/object_info/MontagioCameraEmbedding | head -c 200; echo
```
Le script de fumée doit afficher `node 5 shows text: 33` (le `WanCameraEmbedding` du cœur), puis `node 8 shows text: 33` (Montagio Camera Embedding, nourri par un preset à deux mouvements en `camera_mode` `combined`), et finir par `code 0`. La commande `curl` doit renvoyer la définition du node, pas `{}`.

Test lourd du node, contre le vrai `WanCameraEmbedding` du pod, en quelques secondes :
```bash
pip install -q pytest PyYAML numpy
MONTAGIO_COMFYUI_DIR=/workspace/ComfyUI MONTAGIO_COMFYUI_PYTHON=/workspace/venvs/comfyui/bin/python \
  python3 -m pytest comfy-nodes/tests/test_camera.py -q
```
Attendu : tous les tests passent, aucun n'est ignoré. Les trois tests lourds comparent le node au `WanCameraEmbedding` du pod.

## 4. Télécharger les poids (≈ 20 à 50 min)

```bash
npm run weights -w @montagio/infra-runpod -- --dry-run
npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models
```

- Le `--dry-run` affiche les 43 fichiers, soit 188,7 Go (175,7 Gio) : les 9 des presets (69,7 Go) et les 34 des extensions (édition 31,9 Go, effets 20,6 Go, transitions 31,0 Go, avatar et sa voix 21,5 Go, musique 10,0 Go, upscale 4,0 Go), avec leur dossier ComfyUI et leur URL exacte. Les fichiers de la voix vont dans `tts/chatterbox/resembleai-mtl-v3/`, les LoRA dans `loras/`. Pour ne prendre que les presets : `--extensions none`. Une ligne `the file changed upstream` signifie que Hugging Face sert un autre fichier que celui du lock : **arrêtez-vous** et notez-la.
- Chaque ligne du vrai lancement doit finir par `(matches Hugging Face)`. Le sha256 est aussi comparé à celui du lock.
- À noter : le débit (Mo/s) et la durée totale.
- Le lock est déjà exact : `s1-results/models.lock.patch` doit être vide.

Les LoRA LightX2V de Wan 2.2 I2V de la vérification 6.6 (`d176c808…` et `024f21de…`) sont désormais au lock, avec l'extension « transitions » : le téléchargement ci-dessus les prend, plus besoin de `--extra`.

## 5. Premiers rendus et mesures (≈ 45 min)

Déposez votre photo dans `/workspace/start.png`, par un glisser-déposer dans JupyterLab.

1. **Fun Camera, à froid puis à chaud.** C'est le premier rendu réel avec le workflow officiel (shift 8, 20 étapes).
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --runs 2
   ```
   Notez les `wall s`, `exec s` et `peak VRAM MiB` des deux runs, puis ouvrez le clip dans `s1-results/clips/`.
2. **720p** :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --resolution 720p
   ```
   Notez le temps et la VRAM. Un `CUDA out of memory` est un résultat : notez-le.
3. **5B** en 480p, puis en 720p :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --model wan22-ti2v-5b --runs 2
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --model wan22-ti2v-5b --resolution 720p
   ```
   En 720p, l'app envoie du 1280 × 720 alors que le template officiel du 5B est en 1280 × 704 (multiples de 32). Regardez le bas de l'image : bord abîmé, décalage ?
4. **Z-Image-Turbo** (dans l'interface : Workflow → Browse Templates → « Z-Image ») : générez 2 ou 3 images de départ, et notez le temps par image et la VRAM.

Si un test s'arrête sur `✗ node … is not one of: …` ou `class MontagioCameraEmbedding is not installed`, c'est le contrôle préalable contre `/object_info` : il n'a rien envoyé au GPU. Dans le second cas, revoyez la partie 3.

## 6. Vérifications et réglage des presets (≈ 2 à 3 h)

Ce sont les points que l'analyse sans GPU n'a pas pu trancher ([S1_ANALYSE.md](S1_ANALYSE.md), partie 8).

### 6.1 Poses et vitesses
```bash
npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --camera-pose all --camera-speed 1
npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --camera-pose "Zoom In" --camera-speed 0.5,1.5,3
```
Les 9 poses du node passent, rotations ACW/CW comprises. Pour chacune, notez une note de 1 à 5 et les artefacts, puis la **vitesse maximale exploitable**.

### 6.2 Les 12 presets
```bash
npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --preset all
```
Notez une note par preset. Pour les combinés, regardez :
- `together` (Rise & Push, Drift Left Push, Pull Back & Tilt Up) : les deux mouvements se voient-ils ?
- `then` (Push & Settle : avancée puis arrêt ; Breathing : zoom avant puis arrière) : la bascule à mi-clip est-elle propre ?

Les réglages (`speed`, prompt, durée) se font dans le Studio, avec « Remix preset » en mode `local` (encadré ci-dessous), ou dans `presets/*.yaml`.

### 6.3 « Pan » contre « Tilt »
Pan Up et Pan Down **déplacent** la caméra (grue), ils ne la font pas pivoter. Décidez si Tilt Up, Tilt Down et Pull Back & Tilt Up gardent leur nom ou deviennent, par exemple, « Crane Up ».

### 6.4 Négatif par défaut de Wan
Le template Fun Camera a un négatif par défaut (node 99, texte chinois), que le compilateur remplace par celui du preset. Dans l'interface, chargez le template, gardez ce négatif, puis comparez un rendu avec et sans sur la même image et la même seed. Décision : l'ajouter, ou non, au négatif des presets.

### 6.5 Enchaînement de plans
Dans le Studio (mode `local`), faites une Séquence de 2 ou 3 plans. Vérifiez la continuité, puis téléchargez le film 16:9 et la coupe 9:16.

### 6.6 Accélération LightX2V (30 min au plus)
Dans l'interface, chargez le template « Wan 2.2 Fun Camera ». Réactivez le groupe 4 étapes, désactivé par défaut (sélection, puis Ctrl+B). Comparez-le au groupe 20 étapes sur une même image et une même pose : temps, VRAM et qualité. Surtout : **le mouvement de caméra est-il conservé ?** Le template prévient que ces LoRA font perdre de la dynamique.

Si c'est adopté, le plan suivant ajoutera :
- les deux LoRA au lock (`source` : lightx2v/Wan2.2-Lightning) ;
- `LoraLoaderModelOnly` à `allowed-nodes.yaml` ;
- un workflow 4 étapes.

### 6.7 Rotations
Faites un rendu de `roll_cw` à 0,3 avec `--camera-pose "ClockWise (CW)" --camera-speed 0.3`. Décidez ensuite d'un preset « Dutch », ou non.

### 6.8 Les extensions (≈ 2 h 30)

Dans l'ordre de priorité réorienté. Le détail de ce qu'il faut regarder est dans [EXTENSIONS_ANALYSE.md](EXTENSIONS_ANALYSE.md), partie 7. Chaque commande note temps, VRAM et sortie dans `s1-results/smoke.jsonl`, et range la sortie dans `s1-results/clips/`. Il faut `ffprobe` pour l'avatar : `apt-get install -y ffmpeg`. Groupez les jobs par modèle : chaque changement de famille recharge des poids. Préparez trois photos dont vous avez les droits : une personne de face (`/workspace/person.png`), un animal (`animal.png`), un objet (`object.png`), plus une tenue sur fond neutre (`outfit.png`).

1. **Édition** (≈ 20 min) :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension edit --input /workspace/person.png --text "make it a rainy night scene"
   npm run smoke -w @montagio/infra-runpod -- --extension edit --input /workspace/person.png --text "ajoute de la neige"
   npm run smoke -w @montagio/infra-runpod -- --extension edit --quality --input /workspace/person.png --text "make it a rainy night scene"
   npm run smoke -w @montagio/infra-runpod -- --extension edit --look infl8 --input /workspace/person.png --text "inflate the person"
   npm run smoke -w @montagio/infra-runpod -- --extension edit --look action --input /workspace/person.png --text "action the person"
   npm run smoke -w @montagio/infra-runpod -- --extension edit --look angles --input /workspace/object.png --text "front-left quarter view eye-level shot medium shot"
   ```
   Les deux premières tournent en 4 étapes (LoRA Lightning), la troisième en 40 : comparez le temps et la fidélité à l'instruction. Les trois dernières valident chaque look : aucune ligne `lora key not loaded` dans `/workspace/logs/comfyui.log`, et l'effet attendu (gonflé, figurine, autre angle de vue). Un look qui échoue se note dans la fiche : l'édition peut être datée sans lui, mais le hook Figurine (look ACTION) ne le sera pas.
   Le journal de ComfyUI dit-il `loaded completely` ou `loaded partially` ? Notez le temps par image et le pic de VRAM. Puis animez l'image éditée : `npm run smoke -w @montagio/infra-runpod -- --image s1-results/clips/<l'image éditée>.png`.
2. **Effets** (≈ 45 min) : les 6 effets sur chaque photo, en 4 étapes ; `--text` donne le sujet que reprend le prompt.
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension effect --input /workspace/person.png --text "woman"
   npm run smoke -w @montagio/infra-runpod -- --extension effect --input /workspace/animal.png --text "dog"
   npm run smoke -w @montagio/infra-runpod -- --extension effect --input /workspace/object.png --text "red toy car"
   ```
   Critères, pour chaque clip : le sujet reste reconnaissable, l'effet se lit dès la première seconde, aucun artefact bloquant. Dans `/workspace/logs/comfyui.log`, aucune ligne `lora key not loaded` : sinon, la LoRA 4 étapes de lightx2v n'est pas lue (partie 1 de l'analyse). Dans ce cas, téléchargez la copie que les templates utilisent (`npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models --extra loras=https://huggingface.co/Comfy-Org/Wan-Animate-2/resolve/main/loras/lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors`) et comparez dans l'interface en changeant le fichier du node 201. Notez les effets qui cassent en 4 étapes, les grands mouvements surtout (explosion, crash zoom) : ils repasseront en 20 étapes en S3 (`--quality --effect explode`).
3. **Hooks par images clés** (≈ 30 min) :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension hook --hook eyes-in --input /workspace/person.png
   npm run smoke -w @montagio/infra-runpod -- --extension hook --hook outfit-morph --input /workspace/person.png --input2 /workspace/outfit.png
   npm run smoke -w @montagio/infra-runpod -- --extension hook --hook eyes-in --quality --input /workspace/person.png
   ```
   L'édition fait d'abord l'image finale (la macro de l'iris, la personne dans la tenue), puis la transition anime le passage depuis la photo. Regardez d'abord l'image finale dans `s1-results/clips/` : si elle est ratée, la transition le sera aussi. Puis la continuité (pas de saut au milieu, l'identité gardée) et le temps total d'un hook, rechargements compris. Figurine et Ignite sont pour la S3.
4. **Voix seule** (≈ 5 min) : `npm run smoke -w @montagio/infra-runpod -- --extension voice --text "Bonjour, ceci est un essai." --language fr`. Le node est-il chargé (fin du bootstrap) ? Combien de temps pour la phrase ?
5. **Avatar et sa voix** (≈ 30 min) : une photo d'une personne dont vous avez les droits, de face.
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension avatar --input /workspace/face.png --text "Hello, this is a test of the Montagio avatar." --language en
   npm run smoke -w @montagio/infra-runpod -- --extension avatar --input /workspace/face.png --text "Bonjour, ceci est un essai de l'avatar de Montagio." --language fr
   ```
   La voix tourne d'abord, puis l'avatar dit sa sortie. Regardez la synchronisation des lèvres (sur les « p » et les « b »), l'identité, les coutures à 5 et 10 s, et l'accent de la voix en français. Si le temps le permet, comparez dans l'interface : le chemin 20 étapes sans LoRA (`steps` 20, `cfg` 6, LoRA retirée), et `ImageFromBatch.batch_index` à 1 et 3 au lieu de 4.
6. **Musique** (≈ 10 min, en fond) :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension music --duration 10 --text "tense cinematic synth pulse"
   npm run smoke -w @montagio/infra-runpod -- --extension music --duration 60 --text "calm piano, slow strings"
   ```
   Écoutez : aucune voix ? Le tempo de 90 est-il suivi ? Notez le temps juste après un rendu Wan (rechargement des modèles). Puis, dans le Studio en mode local, une Séquence de 2 plans : la musique est mixée plus tard, dans la phase d'intégration ; ici, gardez seulement le FLAC.
7. **Upscale HD** (≈ 15 min, s'il reste du temps) : sur un clip de la partie 5.
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --extension upscale --clip s1-results/clips/<un clip 720p>.mp4
   ```
   Comparez au même clip agrandi par FFmpeg (`ffmpeg -i clip.mp4 -vf scale=1920:1080:flags=lanczos lanczos.mp4`) : la netteté est-elle meilleure, ou artificielle ? Regardez les coutures entre morceaux (toutes les 33 images). Pour comparer la correction de couleur, changez `color_correction_method` du node 59 (`lab`, `wavelet`, `none`) dans `s1-results/workflows/ext-upscale__seedvr2-upscale.api.json`, chargé dans l'interface.
8. **Fixture de la voix** : `curl -s http://127.0.0.1:8188/object_info/ChatterboxMTLTTS > s1-results/object_info-chatterbox.json`. De retour sur le PC, elle remplace l'entrée écrite à la main dans `infra/runpod/test/fixtures/object_info-v0.41.0.json`.
9. **Décision** : pour chaque extension qui donne un résultat montrable, notez-la dans la fiche (partie 8). De retour sur le PC, sa date ira dans `gpu_validated` de `registry/extensions.yaml` ; une extension non datée le 25/10 au soir est masquée de la démo. Les repasses sans distillation, les hooks Figurine et Ignite, et Earth Zoom Out en cinq images clés (si le temps le permet) sont pour la S3 (24–25/10).

> **Le Studio en mode local sur le pod.** Une fois le proxy lancé :
> ```bash
> apt-get update && apt-get install -y ffmpeg
> MONTAGIO_BACKEND=local COMFY_BASE_URL=http://127.0.0.1:8189 npm run dev -w @montagio/web -- --hostname 127.0.0.1
> ```
> Ouvrez-le depuis votre PC par un tunnel SSH (`-L 3000:127.0.0.1:3000`, voir « Dépannage »), puis http://127.0.0.1:3000.

## 7. Avant d'éteindre (≈ 15 min)

1. ```bash
   bash infra/runpod/bootstrap.sh collect
   ```
2. Téléchargez `/workspace/s1-results-<date>.tgz` (clic droit → **Download**) et vérifiez qu'il s'ouvre sur votre PC.
3. Si vous avez modifié des workflows dans l'interface : **Workflow → Export (API)**, puis aussi **Save**.
4. Runpod → Pods → **Terminate** (et pas seulement Stop : un pod arrêté continue de facturer son disque). Si vous faites l'essai de l'installeur local (encadré ci-dessous), faites-le avant.
5. Billing : plus aucun pod actif. Notez l'heure d'arrêt et le coût total.

> **Facultatif : essai de l'installeur local sur le pod.** L'installeur (`./montagio.sh install`, guide : [INSTALL.md](INSTALL.md)) est dans `main` depuis le 19/10 (fusion de `feat/installer`, commit `6066021`) : le bundle de la partie 0 le contient. Il n'a pas encore tourné sous Linux sur un vrai GPU de 24 Go, et ce pod en est un.
>
> **1. Contrôles et plan, sans rien changer** (quelques secondes, rien n'est téléchargé), à tout moment après la partie 3 :
> ```bash
> source /workspace/montagio.env
> apt-get update && apt-get install -y ffmpeg
> ./montagio.sh install --dry-run --dir /workspace/montagio-local --comfy-port 8288 --proxy-port 8289 --app-port 3001
> ```
> Les ports changent pour ne pas buter sur ComfyUI et le proxy du bootstrap. Attendu : la RTX 4090 avec 24 Go, `driver …, CUDA 13.x: torch 2.14.1+cu130`, puis la liste des étapes. Notez toute ligne en échec. Avec un volume de 300 Go, la ligne du disque passe de justesse une fois les poids de la session téléchargés (≈ 95 Go libres) ; avec 350 Go, largement. L'installeur ne prend pas les poids des extensions par défaut (`--extensions validated`, aucune n'est encore datée).
>
> **2. Vraie installation**, après le téléchargement de l'archive (étape 2 ci-dessus) et avant Terminate. Comptez 30 à 45 min de pod en plus, soit environ 0,25 $, dont 10 à 25 min de poids. Il faut environ 80 Gio libres sur `/workspace` (65 Gio de poids des presets, 12 Gio de PyTorch) en plus des ≈ 205 Go de la session (poids et outils) : sans assez de place, l'installeur refuse au contrôle du disque, avant de rien changer. D'où les 350 Go conseillés en partie 1 pour cet essai.
> ```bash
> bash infra/runpod/bootstrap.sh stop
> df -h /workspace
> ./montagio.sh install --dir /workspace/montagio-local --no-browser
> ./montagio.sh status --dir /workspace/montagio-local
> ./montagio.sh stop --dir /workspace/montagio-local
> tar -czf /workspace/installeur-local.tgz -C /workspace/montagio-local logs install-state.json
> ```
> L'arrêt du bootstrap libère la VRAM et les ports par défaut. Attendu à la fin de `install` : `<n> node classes loaded, 0 partner node(s)`, sans ligne `the Montagio node pack did not load`, puis `Montagio is ready: http://127.0.0.1:3000`. Téléchargez `/workspace/installeur-local.tgz` comme l'archive de la partie 7.

## 8. La fiche à remplir

```text
Pod : GPU ______  driver ______  CUDA ______  prix ____ $/h  début __:__  fin __:__  coût total ____ $
Install : durée ____ min  torch ______  ligne « partner node(s) » : ______________________
Pack Montagio : smoke « 33 » oui / non   test lourd du node : oui / non
Poids : ____ Gio en ____ min (____ Mio/s)  tous « matches Hugging Face » : oui / non   dérive signalée : ______

Mesures (smoke.jsonl les contient ; noter ici la qualité) :
| modèle | preset / pose | vitesse | résolution | images | wall s (froid / chaud) | VRAM max | qualité 1-5 | artefacts |

Fun Camera 720p : ____ s, VRAM ____ Mo (ou OOM)
5B 720p : bord du bas correct oui / non → dimensions propres au 5B : oui / non
Z-Image-Turbo : ____ s par image, VRAM ____ Mo
Poses : vitesse max ____  rotations ACW/CW : ____  preset Dutch : oui / non
Combinés : together ____ / then ____   (Rise & Push __, Drift Left Push __, Pull Back & Tilt Up __, Push & Settle __, Breathing __)
Tilt → Crane : oui / non     Négatif Wan par défaut : ajouté / non
LightX2V : gain ____ ×   mouvement conservé : oui / non   adoptée / exclue
Séquence : continuité ____   film 16:9 ok   coupe 9:16 ok
Installeur local (facultatif) : dry-run, lignes en échec ______________   vraie install ____ min, « Montagio is ready » oui / non
Presets réglés : ______________________________________________
Extensions (validée oui / non, temps, VRAM max, remarque) :
  Édition 4 étapes ____ s, 40 étapes ____ s, VRAM ____ Mo, loaded completely / partially, français suivi oui / non : __________
    Looks infl8 ___ action ___ angles ___ (« lora key not loaded » oui / non) : __________
  Effets lisibles (personne / animal / objet) : squish ___ cakeify ___ explode ___ crash zoom ___ bullet time ___ orbit ___
    ____ s par effet, VRAM ____ Mo, « lora key not loaded » oui / non, à repasser en 20 étapes : __________
  Hooks eyes-in ____ s, outfit-morph ____ s (édition + transition), image finale réussie oui / non, continuité : __________
  Voix node chargé oui / non, en ____ s, français : __________
  Avatar 5 s ____ s, 10 s ____ s, VRAM ____ Mo, lèvres : __________, LoRA gardée oui / non
  Musique 10 s ____ s, 60 s ____ s, VRAM ____ Mo, voix entendues oui / non : __________
  Upscale 81 images ____ s, VRAM ____ Mo, mieux que lanczos oui / non, coutures : __________
```

## 9. De retour sur le PC

1. Décompressez l'archive dans `montagio/` (le dossier `s1-results/` y est ignoré par git).
2. Reportez les réglages retenus dans `presets/*.yaml`. Lancez `python comfy-nodes/scripts/sync_presets.py`, puis `npm run montagio -- preset validate presets`, `npm test`, `npm run test:nodes` et `npm run check:open-stack`.
3. Gardez la fiche remplie et les exports avec `s1-results/` : ce sont les entrées du plan suivant (galerie, aperçus, S3).
4. Extensions : datez `gpu_validated` dans `registry/extensions.yaml` pour chaque extension validée (format `2026-10-22`) ; remplacez l'entrée `ChatterboxMTLTTS` de `infra/runpod/test/fixtures/object_info-v0.41.0.json` par celle de `s1-results/object_info-chatterbox.json` (sans les tooltips) ; reportez les mesures dans `docs/EXTENSIONS_ANALYSE.md` (parties 4 et 6) et les `estimate_s` dans `registry/extensions/*.yaml`. Relancez ensuite `npm test` et `npm run check:open-stack`.

## Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `torch sees no CUDA device` | pod sans GPU visible, ou pilote | redéployer un pod |
| avertissement de repli cu128, puis erreur au démarrage | pilote limité à CUDA 12.8 | redéployer avec le filtre CUDA 13.0 |
| `found no CUDA version in nvidia-smi's banner` | bannière d'un format que le script ne connaît pas (il lit `CUDA Version:` et le `CUDA UMD Version:` des pilotes R6xx) | noter les 4 premières lignes de `nvidia-smi` ; le repli cu128 marche aussi sur un pilote CUDA 13 |
| `ComfyUI exited during startup` | erreur Python | lire `/workspace/logs/comfyui.log` |
| `partner nodes are loaded` | ComfyUI lancé sans `--disable-partner-nodes` | `bootstrap.sh stop`, puis `bootstrap.sh start --expose-ui` |
| `warning: nodes missing: MontagioCameraEmbedding` ou `class MontagioCameraEmbedding is not installed` | le pack Montagio ne s'est pas chargé | chercher son erreur d'import dans `/workspace/logs/comfyui.log`, puis `bootstrap.sh stop` et `bootstrap.sh start --expose-ui` |
| `custom_nodes/montagio is a folder, not a link` | une copie du pack occupe la place du lien | la déplacer hors de `custom_nodes`, puis relancer |
| `the file changed upstream` | Hugging Face sert un autre fichier que le lock | s'arrêter, noter, ne pas forcer |
| `✗ … unet_name = "…" is not one of` | poids absent ou mal rangé | relancer `npm run weights …` |
| `CUDA out of memory` | 720p ou clip trop long sur le 14B fp8 | noter, revenir en 480p |
| téléchargement coupé | réseau | relancer la même commande : la reprise est automatique |

**Tunnel SSH au lieu de l'URL publique :**
1. Activez « SSH over exposed TCP » sur le pod, et ajoutez votre clé publique dans les réglages Runpod (c'est à vous de le faire).
2. Lancez le bootstrap **sans** `--expose-ui`.
3. Sur votre PC :
   ```bash
   ssh -N -L 8188:127.0.0.1:8188 -L 8189:127.0.0.1:8189 -L 3000:127.0.0.1:3000 root@<IP du pod> -p <port TCP> -i ~/.ssh/id_ed25519
   ```
Si vous lancez `smoke.ts` depuis votre PC, ajoutez `--vram comfyui`.
