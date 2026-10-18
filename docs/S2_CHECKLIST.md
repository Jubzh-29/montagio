# Session GPU S2 : pas-à-pas

Date prévue : 21–22/10/2026. C'est la **première session GPU** : la S1 du 18/10 a été remplacée par une analyse sans GPU ([S1_ANALYSE.md](S1_ANALYSE.md)). Durée visée : 4 à 6 h de RTX 4090. Budget : environ 0,34 $/h en Community Cloud, soit 1,5 à 2 $ (spec §10).

**Objet :**
- premier rendu réel ;
- mesures de mémoire et de temps ;
- réglage des 12 presets et test de l'enchaînement de plans ;
- les vérifications que l'analyse a laissées au GPU (partie 6).

**Déjà prêt, grâce à l'analyse :**
- lock exact (URL, taille et sha256 de chaque poids) ;
- workflows tirés des templates officiels et validés par un vrai ComfyUI v0.41.0 ;
- node « Montagio Camera Embedding » pour les mouvements combinés ;
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
| 3. Installer, lancer, ajouter le pack Montagio | 20 à 30 min | oui |
| 4. Télécharger les poids | 10 à 25 min | oui |
| 5. Premiers rendus et mesures | 45 min | oui |
| 6. Vérifications et réglage des presets | 2 à 3 h | oui |
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
   - Volume Disk : **150 Go**, monté sur `/workspace` (70 Go de poids, plus la marge) ;
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

## 3. Installer, lancer, ajouter le pack Montagio (≈ 20 à 30 min)

```bash
bash infra/runpod/bootstrap.sh --expose-ui
source /workspace/montagio.env
```

À noter :
- la ligne `GPU: NVIDIA GeForce RTX 4090, …` ;
- `torch 2.14.1+cu130 …` ;
- **`<n> node classes loaded, 0 partner node(s)`**, la preuve « aucun Partner Node » ;
- `proxy: {"status": "healthy", …}`.

**Pack Montagio, obligatoire.** Les presets combinés (Rise & Push, Drift Left Push, Pull Back & Tilt Up, Push & Settle et Breathing) passent par son node `MontagioCameraEmbedding` :
```bash
ln -sfn /workspace/montagio/comfy-nodes /workspace/ComfyUI/custom_nodes/montagio
bash infra/runpod/bootstrap.sh stop
bash infra/runpod/bootstrap.sh start --expose-ui
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

## 4. Télécharger les poids (≈ 10 à 25 min)

```bash
npm run weights -w @montagio/infra-runpod -- --dry-run
npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models
```

- Le `--dry-run` affiche les 9 fichiers, soit 69,7 Go (64,9 Gio), avec leur dossier ComfyUI et leur URL exacte. Une ligne `the file changed upstream` signifie que Hugging Face sert un autre fichier que celui du lock : **arrêtez-vous** et notez-la.
- Chaque ligne du vrai lancement doit finir par `(matches Hugging Face)`. Le sha256 est aussi comparé à celui du lock.
- À noter : le débit (Mo/s) et la durée totale.
- Le lock est déjà exact : `s1-results/models.lock.patch` doit être vide.

LoRA LightX2V, pour la vérification 6.6 seulement. La licence est acceptée, mais les LoRA restent hors du lock :
```bash
npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models \
  --extra loras=https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors \
  --extra loras=https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors
```
Les sha256 attendus sont dans [S1_ANALYSE.md](S1_ANALYSE.md), partie 1 (`d176c808…` et `024f21de…`).

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
4. Runpod → Pods → **Terminate** (et pas seulement Stop : un pod arrêté continue de facturer son disque).
5. Billing : plus aucun pod actif. Notez l'heure d'arrêt et le coût total.

## 8. La fiche à remplir

```text
Pod : GPU ______  driver ______  CUDA ______  prix ____ $/h  début __:__  fin __:__  coût total ____ $
Install : durée ____ min  torch ______  ligne « partner node(s) » : ______________________
Pack Montagio : smoke « 33 » oui / non   test lourd du node : oui / non
Poids : ____ Go en ____ min (____ Mo/s)  tous « matches Hugging Face » : oui / non   dérive signalée : ______

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
Presets réglés : ______________________________________________
```

## 9. De retour sur le PC

1. Décompressez l'archive dans `montagio/` (le dossier `s1-results/` y est ignoré par git).
2. Reportez les réglages retenus dans `presets/*.yaml`. Lancez `python comfy-nodes/scripts/sync_presets.py`, puis `npm run montagio -- preset validate presets`, `npm test`, `npm run test:nodes` et `npm run check:open-stack`.
3. Gardez la fiche remplie et les exports avec `s1-results/` : ce sont les entrées du plan suivant (galerie, aperçus, S3).

## Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `torch sees no CUDA device` | pod sans GPU visible, ou pilote | redéployer un pod |
| avertissement de repli cu128, puis erreur au démarrage | pilote limité à CUDA 12.8 | redéployer avec le filtre CUDA 13.0 |
| `ComfyUI exited during startup` | erreur Python | lire `/workspace/logs/comfyui.log` |
| `partner nodes are loaded` | ComfyUI lancé sans `--disable-partner-nodes` | `bootstrap.sh stop`, puis `bootstrap.sh start --expose-ui` |
| `class MontagioCameraEmbedding is not installed` | pack Montagio absent | partie 3, puis redémarrer ComfyUI |
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
