# Session GPU S1 : pas-à-pas

Date prévue : dimanche 18/10/2026. Durée visée : 3 à 5 h de RTX 4090. Budget : environ 0,34 $/h en Community Cloud, soit 1 à 2 $ pour la session (spec §10).

Objet (spec §10 et §14) : installer ComfyUI et comfy-api-proxy sur un pod, valider Wan 2.2 Fun-Camera, le 5B et Z-Image-Turbo, tester l'accélération, mesurer temps et VRAM, et trancher les six questions de la partie 6.

Les outils sont dans [`infra/runpod/`](../infra/runpod/README.md) :

| Fichier | Rôle |
|---|---|
| `bootstrap.sh` | Installe ComfyUI v0.41.0 (commit vérifié), PyTorch, comfy-api-proxy 0.1.6 et Node 22, puis lance ComfyUI avec `--disable-partner-nodes` et le proxy sur `127.0.0.1:8189`. Le script s'arrête si un seul node partenaire est chargé. |
| `fetch-weights.ts` | Lit `registry/models.lock.yaml`, trouve l'URL exacte de chaque fichier (`resolve/main/…`), télécharge, calcule le sha256, le compare à celui que publie Hugging Face et produit `models.lock.patch` à relire. |
| `smoke.ts` | Compile un preset avec `@montagio/presets`, l'envoie par `@comfyorg/sdk` au proxy local, télécharge le clip et note temps et VRAM dans `s1-results/smoke.jsonl`. |
| `versions.env` | Toutes les versions épinglées. |

Tout ce qui sort de la session va dans `s1-results/` (ignoré par git), puis dans une archive à télécharger avant d'éteindre le pod.

## Déroulé en un coup d'œil

| Étape | Durée | GPU facturé |
|---|---|---|
| 0. Préparer sur le PC (la veille) | 15 min | non |
| 1. Créer le pod | 10 min | à partir du démarrage |
| 2. Copier le dépôt | 5 min | oui |
| 3. Installer et lancer | 15 à 25 min | oui |
| 4. Télécharger les poids (lire les licences pendant ce temps) | 10 à 25 min | oui |
| 5. Image de départ, puis tests de fumée | 30 min | oui |
| 6. Les six questions | 1 h 30 à 3 h | oui |
| 7. Rassembler, télécharger, éteindre | 15 min | jusqu'à l'arrêt |

## 0. La veille, sur votre PC (sans GPU)

1. Mettez à jour le dépôt et vérifiez la branche :
   ```bash
   git -C montagio log -1 --oneline
   ```
2. Empaquetez le dépôt en un seul fichier (le dépôt n'est pas sur GitHub, et rien ne vous oblige à l'y mettre) :
   ```bash
   git -C montagio bundle create ../montagio.bundle --all
   ```
3. Runpod (c'est à vous de le faire) : créez le compte et mettez seulement le crédit que vous acceptez de dépenser, par exemple 10 $, **sans recharge automatique**. Le solde sert alors de plafond.
4. Préparez une photo de départ dont vous avez les droits : sans personne reconnaissable, SFW, en 16:9, avec de la profondeur (premier plan et fond) pour que le mouvement de caméra se voie. L'image d'exemple du dépôt est une mire FFmpeg : elle suffit à vérifier la chaîne, pas à juger un mouvement. Vous pouvez aussi en générer une avec Z-Image-Turbo à l'étape 5.
5. Aucun jeton Hugging Face n'est nécessaire : tous les fichiers du lock sont disponibles sans authentification sur des miroirs Comfy-Org (vérifié le 17/10 avec `--dry-run`).
6. Gardez sous la main la fiche de la partie 8 (copiez-la dans un bloc-notes).

## 1. Créer le pod (≈ 10 min)

1. Runpod → **Pods** → **Deploy**.
2. GPU : **RTX 4090** (24 Go). Community Cloud coûte moins cher que Secure Cloud ; vérifiez le prix horaire affiché et notez-le.
3. Si le filtre **CUDA version** est proposé, choisissez **13.0**. ComfyUI v0.41.0 demande une build PyTorch CUDA 13.0 sur les cartes RTX 20 et plus récentes. Sur un hôte limité à CUDA 12.8, le script se rabat sur torch 2.11 (cu128) et vous prévient.
4. Template : **Runpod PyTorch** (le plus récent). Il fournit Python, git, JupyterLab et le terminal web.
5. **Edit Template** :
   - Container Disk : 40 Go ;
   - Volume Disk : **150 Go**, monté sur `/workspace` (66 Go de poids, plus PyTorch, ComfyUI et la marge pour les tests) ;
   - Expose HTTP Ports : `8888` (JupyterLab, déjà présent) et **`8188`** (interface ComfyUI) ;
   - aucune variable d'environnement contenant une clé.
6. Choisissez **On-Demand**, pas Spot : une coupure en pleine session coûterait plus cher que l'écart de prix.
7. Notez l'heure de démarrage.

## 2. Copier le dépôt sur le pod (≈ 5 min)

1. Pod → **Connect** → **JupyterLab** (port 8888).
2. Glissez `montagio.bundle` dans le panneau de fichiers, dans `/workspace`.
3. Ouvrez un terminal (File → New → Terminal) :
   ```bash
   cd /workspace
   git clone montagio.bundle montagio
   cd montagio
   git checkout feat/s1-gpu-setup   # ou main si la branche est fusionnée
   git log -1 --oneline
   ```

## 3. Installer et lancer (≈ 15 à 25 min, sans intervention)

```bash
bash infra/runpod/bootstrap.sh --expose-ui
source /workspace/montagio.env
```

Ce qu'il faut voir passer, et noter :
- la ligne `GPU: NVIDIA GeForce RTX 4090, 24564 MiB, <driver>` et `driver supports CUDA 13.x` ;
- `torch 2.14.1+cu130 (CUDA 13.0) on NVIDIA GeForce RTX 4090`, ou l'avertissement de repli cu128 ;
- **`<n> node classes loaded, 0 partner node(s)`** : c'est la preuve « aucun Partner Node » pour le README et la vidéo ;
- `ComfyUI 0.41.0 answering on http://127.0.0.1:8188` et `proxy: {"status": "healthy", …}`.

Interface ComfyUI : pod → **Connect** → **HTTP Service 8188**, ou `https://<POD_ID>-8188.proxy.runpod.net`.

> Cette URL est publique tant que le pod tourne, et ComfyUI n'a pas d'authentification. Ne la partagez pas et éteignez le pod à la fin. Si vous préférez un tunnel SSH, voir « Dépannage ». Le proxy, lui, n'écoute que sur `127.0.0.1`.

Commandes utiles : `bash infra/runpod/bootstrap.sh status`, puis `stop` et `start --expose-ui` pour redémarrer. Les journaux sont dans `/workspace/logs/`.

- [ ] Nodes Montagio (≈ 2 min) : installer `comfy-nodes` dans `custom_nodes/montagio`, redémarrer ComfyUI, puis lancer `comfy-nodes/scripts/smoke_comfyui.py` sur le ComfyUI du pod. Le script enchaîne les sorties de `MontagioPresetFromYAML` dans `WanCameraEmbedding` (sans GPU ni poids) et doit se terminer par `node 5 shows text: 33` et le code de sortie 0 :
  ```bash
  ln -sfn /workspace/montagio/comfy-nodes /workspace/ComfyUI/custom_nodes/montagio
  bash infra/runpod/bootstrap.sh stop
  bash infra/runpod/bootstrap.sh start --expose-ui
  python3 comfy-nodes/scripts/smoke_comfyui.py http://127.0.0.1:8188; echo "code $?"
  ```

## 4. Télécharger les poids (≈ 10 à 25 min)

```bash
npm run weights -w @montagio/infra-runpod -- --dry-run
npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models
```

- Le `--dry-run` affiche les 9 fichiers (64,9 Go), leur dossier ComfyUI et l'URL exacte choisie, sans rien télécharger.
- Le vrai lancement télécharge deux fichiers à la fois, reprend un téléchargement interrompu et vérifie chaque sha256 contre celui de Hugging Face. Chaque ligne doit finir par `(matches Hugging Face)`.
- À noter : le débit affiché (Mo/s) et la durée totale.
- Résultats : `s1-results/weights-report.json` et `s1-results/models.lock.patch`. Le patch ne change que `url` et ajoute `sha256` ; **les licences ne sont jamais modifiées**.

**Pendant le téléchargement**, sans GPU : lisez les licences de la question 4 (partie 6) et faites la vérification Comfy Cloud de la question 5 sur votre PC.

URL retenues par le `--dry-run` du 17/10 (à confirmer par le rapport) :

| Entrée du lock | Fichier exact |
|---|---|
| `wan22-fun-camera-high` / `-low` | `Comfy-Org/Wan_2.2_ComfyUI_Repackaged`, `split_files/diffusion_models/wan2.2_fun_camera_{high,low}_noise_14B_fp8_scaled.safetensors` (14,25 Go chacun) |
| `wan22-ti2v-5b`, `wan22-vae` | même dépôt, `split_files/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`, `split_files/vae/wan2.2_vae.safetensors` |
| `umt5-xxl-fp8`, `wan21-vae` | `Comfy-Org/Wan_2.1_ComfyUI_repackaged`, `split_files/text_encoders/…`, `split_files/vae/…` |
| `z-image-turbo`, `qwen3-4b`, `flux-ae` | `Comfy-Org/z_image_turbo`, `split_files/{diffusion_models,text_encoders,vae}/…` |

Deux URL du lock actuel ne contenaient pas le fichier : `Qwen/Qwen3-4B` (poids découpés en plusieurs fichiers) et `alibaba-pai/Wan2.2-Fun-A14B-Control-Camera` (format diffusers). Le dépôt `black-forest-labs/FLUX.1-schnell` exige une acceptation : `ae.safetensors` vient donc de la copie Comfy-Org. Le champ `source`, qui renvoie au dépôt d'origine où relire la licence, ne change pas.

## 5. Image de départ, puis tests de fumée (≈ 30 min)

1. **Z-Image-Turbo** (dans l'interface) : Workflow → Browse Templates → cherchez « Z-Image ». Générez 2 ou 3 images de départ SFW en 16:9, sans personne réelle, avec de la profondeur. Notez le temps par image et la VRAM (`bash infra/runpod/bootstrap.sh status`). Téléchargez la meilleure ; elle remplacera la mire de « Try with a sample photo ». Déposez-la dans `/workspace/start.png` (glisser-déposer dans JupyterLab).
2. **Fun-Camera, à froid puis à chaud** :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --runs 2
   ```
   - La première ligne affiche les valeurs acceptées par `camera_pose` (question 2).
   - Le run 1 inclut le chargement des modèles, le run 2 non : notez les deux `wall s`, `exec s` et `peak VRAM MiB`.
   - Ouvrez le clip dans `s1-results/clips/` (double-clic dans JupyterLab).
   - Le workflow du dépôt est écrit à la main : par exemple, il n'a pas de node `ModelSamplingSD3` (shift). Une qualité médiocre ici ne condamne pas le modèle ; c'est justement pourquoi on exporte le vrai workflow à la question 6.
3. **5B (mode Rapide, caméra par le texte)** :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --model wan22-ti2v-5b --runs 2
   ```
4. **Les trois presets** :
   ```bash
   npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --preset all
   ```

Si un test s'arrête sur `✗ node … is not one of: …`, c'est la vérification préalable contre `/object_info` : elle a trouvé un fichier absent ou une valeur refusée, et n'a rien envoyé au GPU. Ctrl+C annule aussi le rendu en cours sur le GPU.

> **Facultatif : le Studio en mode local sur le pod.** Ce mode exige la branche `feat/plan-2b` ou sa fusion dans `main` : sur un `main` plus ancien, `MONTAGIO_BACKEND=local` s'arrête sur « arrives in plan 2 ». Une fois le proxy lancé, l'app peut lui envoyer ses rendus :
> ```bash
> MONTAGIO_BACKEND=local COMFY_BASE_URL=http://127.0.0.1:8189 npm run dev -w @montagio/web -- --hostname 127.0.0.1
> ```
> `--hostname 127.0.0.1` garde l'app hors de portée des autres machines du réseau du pod : seul le tunnel y accède. Ouvrez-la depuis votre PC par un tunnel SSH (`-L 3000:127.0.0.1:3000`, même commande que dans « Dépannage »), puis http://127.0.0.1:3000. Tant que `workflows/*.api.json` sont provisoires, un refus `workflow-rejected` est le résultat attendu : le détail se lit dans la console du serveur. L'app exige FFmpeg avant chaque rendu, et `bootstrap.sh` ne l'installe pas : `apt-get update && apt-get install -y ffmpeg`.

## 6. Les questions à trancher

### Q1. Poses et combinaisons supportées par le node caméra

**Ce que l'on sait déjà** (code de `comfy_extras/nodes_camera_trajectory.py` à v0.41.0) :
- `WanCameraEmbedding` prend **une seule** pose (`motion_list = [camera_pose]`) : aucune combinaison dans le cœur de ComfyUI.
- `speed` va de 0 à 10, par pas de 0,1. Le déplacement croît linéairement sur le clip, jusqu'à `speed × 1,5 ×` le vecteur de la pose.
- Les poses « Pan » et « Zoom » sont des **translations** de la caméra, pas des rotations : « Pan Left » est un travelling latéral, « Pan Up » une montée verticale (grue). Seules ACW et CW tournent la caméra, autour de l'axe de visée. Les noms de presets « Tilt Up/Down » sont donc trompeurs (à revoir en S2).
- Conséquence : `compile.ts` joint deux poses par « + » (`"Zoom In + Pan Left"`), ce que ComfyUI refusera. Les presets combinés de la spec §6 (Rise & Push, Drift Left Push, Pull Back & Tilt Up) ont besoin d'une autre solution.

**À faire** :
```bash
npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --camera-pose all --camera-speed 1
npm run smoke -w @montagio/infra-runpod -- --image /workspace/start.png --camera-pose "Zoom In" --camera-speed 0.5,1.5,3
```
- Notez, pour chaque pose et chaque vitesse, une note de 1 à 5 et les artefacts observés (déformation, scintillement, sujet qui fond).
- Combinaisons, 30 min au plus. Les nodes VideoX-Fun (Apache-2.0) `CameraCombineFromChaoJie` (simultané : somme des vecteurs) et `CameraJoinFromChaoJie` (A puis B) existent, mais ils produisent une trajectoire pour les samplers VideoX-Fun, pas pour `WanCameraImageToVideo`. Vérifiez seulement si un branchement existe. Sinon, la piste pour le plan 2 est un node « Montagio Camera Embedding » dans notre pack GPL-3.0, qui additionne ou enchaîne les trajectoires et réutilise le calcul de Plücker du cœur.
- **Décision à noter** : liste des poses retenues, vitesse maximale exploitable, et la piste choisie pour les combinaisons (node maison, VideoX-Fun, ou combinaisons abandonnées pour la v0.1).

### Q2. Valeurs exactes de `camera_pose`

**Ce que l'on sait déjà** (même fichier) : `Static`, `Pan Up`, `Pan Down`, `Pan Left`, `Pan Right`, `Zoom In`, `Zoom Out`, `Anti Clockwise (ACW)`, `ClockWise (CW)`. Les 7 premières correspondent exactement à `CAMERA_POSE_VALUES` dans `packages/presets/src/compile.ts`. ACW et CW n'existent pas encore dans le schéma de presets.

**À faire** : comparer avec la ligne `WanCameraEmbedding.camera_pose accepts:` du test de fumée ; le détail est dans `s1-results/object_info-wan-camera.json`. **Décision** : ajouter ACW/CW (par exemple un preset « Dutch Roll ») ou non.

### Q3. Contrôle caméra pour Wan 2.2 5B

**Ce que l'on sait déjà** :
- `alibaba-pai/Wan2.2-Fun-5B-Control-Camera` existe (carte : Apache-2.0), au format VideoX-Fun : `diffusion_pytorch_model.safetensors` de 10,5 Go et `Wan2.2_VAE.pth`. Le 17/10, aucun reconditionnement Comfy-Org en un seul fichier n'existait.
- Dans le cœur, `WanCameraImageToVideo` fabrique un latent Wan 2.1 à 16 canaux, alors que le 5B utilise le VAE Wan 2.2 à 48 canaux : le node du cœur ne convient probablement pas au 5B tel quel.

**À faire** (30 min au plus) :
1. Dans Browse Templates, cherchez « camera » et « 5B » : un workflow officiel existe-t-il ?
2. Sinon, testez le fichier alibaba-pai (téléchargement d'évaluation, hors lock) :
   ```bash
   npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models \
     --extra diffusion_models=https://huggingface.co/alibaba-pai/Wan2.2-Fun-5B-Control-Camera/resolve/main/diffusion_pytorch_model.safetensors
   ```
   Chargez-le dans `UNETLoader` avec `wan2.2_vae` et `WanCameraImageToVideo`, et notez l'erreur ou le résultat.
3. En dernier recours : les nodes VideoX-Fun (Apache-2.0), dont le README couvre le 5B Control-Camera. L'installation dans `custom_nodes` est plus lourde ; ne la tentez que s'il reste du temps.

**Décision à noter** : caméra paramétrique en 5B oui ou non, et comment. Si c'est non, le mode « Rapide » garde la caméra pilotée par le texte (déjà géré par le compilateur).

### Q4. Licences des poids LightX2V / Lightning

**Ce que l'on sait déjà** (métadonnées Hugging Face du 17/10) : `lightx2v/Wan2.2-Lightning`, `lightx2v/Wan2.2-Distill-Loras` et `lightx2v/Wan2.2-Distill-Models` déclarent `license: apache-2.0` dans la carte, **sans fichier LICENSE** à la racine. Les LoRA 4 étapes reconditionnées par Comfy-Org (`split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise.safetensors`, 1,14 Go chacune) portent la carte apache-2.0 de Comfy-Org, qui n'est pas la source.

**À faire** (sans GPU, pendant les téléchargements) :
- Lisez en entier la carte de chaque dépôt lightx2v : licence, conditions ajoutées, mention d'un usage non commercial, données d'entraînement. Regardez aussi la licence du dépôt GitHub LightX2V (code) et vérifiez qu'elle ne s'applique pas aux poids.
- Notez pour chacun : URL, date, phrase exacte de la licence, verdict.
- **Seulement si le verdict est Apache-2.0 ou MIT** : téléchargez les deux LoRA en évaluation et comparez Fun-Camera en 4 étapes (LoRA sur les deux UNET, cfg 1, 2 étapes + 2 étapes) à Fun-Camera en 20 étapes : temps, VRAM, qualité, et surtout **le mouvement de caméra est-il conservé ?** Ces LoRA ont été entraînées sur Wan 2.2 I2V A14B, pas sur Fun-Camera.
  ```bash
  npm run weights -w @montagio/infra-runpod -- --models-dir /workspace/ComfyUI/models \
    --extra loras=https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors \
    --extra loras=https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors
  ```
- Si le verdict n'est pas Apache/MIT : accélération exclue, on garde le nombre d'étapes complet (spec §5).
- **Décision à noter** : adoptée ou exclue, avec la source exacte de la licence. Si elle est adoptée, le plan 2 ajoute les LoRA au lock et `LoraLoaderModelOnly` à `allowed-nodes.yaml`.

### Q5. Wan 2.2, Fun-Camera et les nodes nécessaires sur Comfy Cloud

**Ce que l'on sait déjà** : Comfy Cloud annonce Wan 2.2 parmi « 900+ » modèles préinstallés, ainsi que les custom nodes les plus populaires. `WanCameraEmbedding` et `WanCameraImageToVideo` font partie du cœur de ComfyUI, donc ils sont présents si la version Cloud est récente. On ignore si les poids Fun-Camera fp8 sont dans la bibliothèque Cloud.

**À faire** (sur votre PC, avec votre compte Comfy, pas besoin du pod) : connectez-vous à cloud.comfy.org, ouvrez Templates → « Wan 2.2 Fun Camera », et vérifiez qu'aucun modèle n'est signalé manquant. Faites de même pour le 5B et Z-Image-Turbo. Notez la version de ComfyUI affichée (Settings → About). Ne lancez rien de payant à ce stade.

**Décision à noter** : disponible oui ou non pour chacun, avec une capture. Cela décide du mode `hosted` : Comfy Cloud, ou un déploiement Comfy API en `--min 0`.

### Q6. Exporter les vrais workflows au format API

Les fichiers `workflows/*.api.json` sont écrits à la main (manque de shift, réglages des samplers supposés). Il faut les remplacer par des exports d'un ComfyUI qui tourne.

**À faire** dans l'interface, pour Wan 2.2 Fun Camera (14B), Wan 2.2 5B (I2V) et Z-Image-Turbo :
1. Browse Templates → chargez le template officiel et sélectionnez nos fichiers dans les loaders.
2. Lancez une fois avec votre image et ajustez si besoin (étapes, cfg, shift). Notez les réglages retenus.
3. **Workflow → Export (API)** : le fichier se télécharge sur votre PC. Nommez-les `wan22-fun-camera.api.json`, `wan22-ti2v-5b.api.json` et `z-image-turbo.api.json`.
4. Faites aussi **Save** (format interface), pour pouvoir le rouvrir plus tard.
5. Notez l'identifiant des nodes qui portent : image, prompt, négatif, seed, largeur, hauteur, nombre d'images, fps, `camera_pose` et `speed`. Ce sont les `bindings` de `registry/models/*.yaml`.
6. Notez toute classe de node absente de `tools/check-open-stack/allowed-nodes.yaml` (par exemple `ModelSamplingSD3`). Le plan 2 les ajoutera après vérification de leur origine.

Rejouez ensuite les tests de fumée avec ces workflows **dans le plan 2**, pas pendant la session : il faut d'abord mettre à jour les bindings.

## 7. Avant d'éteindre (≈ 15 min)

1. Rassemblez tout :
   ```bash
   bash infra/runpod/bootstrap.sh collect
   ```
   L'archive `/workspace/s1-results-<date>.tgz` contient `s1-results/` (clips, `smoke.jsonl`, rapport et patch des poids, workflows compilés), les journaux, `nvidia-smi`, les `pip freeze`, `system_stats`, `object_info`, les workflows enregistrés dans l'interface et ses rendus.
2. Téléchargez-la : JupyterLab → clic droit sur le fichier → **Download**. Vérifiez qu'elle s'ouvre sur votre PC.
3. Vérifiez que les trois exports API de la question 6 sont bien dans vos téléchargements.
4. Runpod → Pods → **Terminate** (et pas seulement Stop). Un pod arrêté continue de facturer son disque de volume : à titre indicatif, de l'ordre de 0,20 $/Go/mois, soit environ 1 $ par jour pour 150 Go, contre moins de 0,20 $ pour tout réinstaller et retélécharger à la session S2. Vérifiez le tarif affiché par Runpod.
5. Contrôlez la page Billing : plus aucun pod actif. Notez l'heure d'arrêt et le coût total.

## 8. La fiche à remplir

```text
Pod : GPU ______  driver ______  CUDA ______  prix ____ $/h  début __:__  fin __:__  coût total ____ $
Install : durée ____ min  torch ______  ligne « partner node(s) » : ______________________
Poids : ____ Go en ____ min (____ Mo/s)  tous « matches Hugging Face » : oui / non

Mesures (smoke.jsonl les contient ; noter ici la qualité) :
| modèle | preset / pose | vitesse | résolution | images | wall s (froid / chaud) | VRAM max | qualité 1-5 | artefacts |

Z-Image-Turbo : ____ s par image, VRAM ____ Mo

Q1 poses retenues : __________  vitesse max : ____  combinaisons : node maison / VideoX-Fun / abandon
Q2 valeurs camera_pose confirmées : oui / non  ACW-CW : ajout / non
Q3 caméra 5B : oui (comment : ______) / non → mode texte
Q4 LightX2V : licence lue à ______ le ______ : « ______ »  verdict : adoptée / exclue  gain ____ ×
Q5 Comfy Cloud : Wan 2.2 __  Fun-Camera __  5B __  Z-Image __  version ComfyUI ______
Q6 exports API : fun-camera __  5b __  z-image __  nodes hors liste : ______________
```

## 9. De retour sur le PC

1. Décompressez l'archive dans `montagio/` : le dossier `s1-results/` y est ignoré par git.
2. Relisez puis appliquez le patch du lock, depuis `montagio/` :
   ```bash
   git apply --check s1-results/models.lock.patch
   git apply s1-results/models.lock.patch
   ```
   Vérifiez qu'il ne touche que `url` et `sha256`, relisez chaque licence à son `source`, et mettez à jour vous-même le commentaire d'en-tête « Provisional lock ». Puis :
   ```bash
   npm test
   npm run check:open-stack
   ```
3. Gardez les exports API et la fiche remplie avec `s1-results/` : ce sont les entrées du plan 2.

## Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| `torch sees no CUDA device` | pod sans GPU visible, ou pilote | redéployer un pod |
| avertissement de repli cu128, puis erreur au démarrage de ComfyUI | pilote limité à CUDA 12.8 | redéployer avec le filtre CUDA 13.0 |
| `ComfyUI exited during startup` | erreur Python : les 40 dernières lignes du journal s'affichent | lire `/workspace/logs/comfyui.log` |
| `partner nodes are loaded` | ComfyUI lancé sans `--disable-partner-nodes` | `bootstrap.sh stop`, puis `bootstrap.sh start --expose-ui` |
| `✗ … unet_name = "…" is not one of` | poids absent ou mal rangé | relancer `npm run weights …` |
| `✗ … camera_pose = "Zoom In + Pan Left" is not one of` | attendu : pas de combinaison dans le node du cœur | voir Q1 |
| `CUDA out of memory` | 720p ou clip trop long sur le 14B fp8 | noter, revenir en 480p |
| disque plein | volume trop petit | redéployer avec 150 Go |
| téléchargement coupé | réseau | relancer la même commande : la reprise est automatique |

**Tunnel SSH au lieu de l'URL publique** : il faut « SSH over exposed TCP » sur le pod et votre clé publique dans les réglages Runpod (à vous de la créer et de l'ajouter). Lancez le bootstrap **sans** `--expose-ui`, puis sur votre PC :
```bash
ssh -N -L 8188:127.0.0.1:8188 root@<IP du pod> -p <port TCP> -i ~/.ssh/id_ed25519
```
et ouvrez http://127.0.0.1:8188. En ajoutant `-L 8189:127.0.0.1:8189`, vous pouvez aussi lancer `smoke.ts` depuis votre PC. Passez alors `--vram comfyui` : sinon `nvidia-smi` mesurerait la carte de votre PC au lieu de la 4090.
