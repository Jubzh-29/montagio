# Analyse S1 sans GPU (18/10/2026)

La session GPU S1 prévue le 18/10 a été remplacée par cette analyse, faite sur le PC sans GPU. La S2 (21–22/10) devient la première session GPU : elle part d'un lock exact, de workflows tirés des templates officiels et de la liste « À vérifier sur GPU » ci-dessous. Le pas-à-pas est dans [S2_CHECKLIST.md](S2_CHECKLIST.md).

Méthode : aucun poids n'a été téléchargé. Les seuls accès réseau sont :
- les pages et l'API de Hugging Face ;
- les sources de ComfyUI v0.41.0 (tag `v0.41.0`, commit `98cc0bf84b7cb1383654c5b402e7612d875d6d22`), sur GitHub ;
- les templates Comfy-Org ;
- des requêtes HTTP Range qui lisent seulement l'en-tête d'un fichier `.safetensors`.

## 1. Licences (Q4)

Règle : un poids n'est accepté que s'il est sous Apache-2.0 ou MIT **sans condition ajoutée**, c'est-à-dire sans usage non commercial, sans seuil de chiffre d'affaires et sans exclusion de territoire. Tout a été lu le 18/10/2026, sur la carte (`README.md`), dans l'API (`cardData.license`) et dans le fichier de licence quand il existe. Les citations sont exactes et abrégées.

### Poids du lock

| Entrée du lock | Fichier téléchargé (`url`) | Source (`source`) | Ce que dit la source | Fichier LICENSE | Verdict |
|---|---|---|---|---|---|
| `wan22-fun-camera-high`, `-low` | Comfy-Org/Wan_2.2_ComfyUI_Repackaged, `…fun_camera_{high,low}_noise_14B_fp8_scaled` | [alibaba-pai/Wan2.2-Fun-A14B-Control-Camera](https://huggingface.co/alibaba-pai/Wan2.2-Fun-A14B-Control-Camera) | carte : « licensed under the Apache License (Version 2.0) » ; API : apache-2.0 | absent (404) | **accepté**, LICENSE absent |
| `wan22-ti2v-5b`, `wan22-vae` | Comfy-Org/Wan_2.2_ComfyUI_Repackaged | [Wan-AI/Wan2.2-TI2V-5B](https://huggingface.co/Wan-AI/Wan2.2-TI2V-5B) | « The models in this repository are licensed under the Apache 2.0 License » | absent (la carte renvoie à un `LICENSE.txt` qui n'existe pas) | **accepté**, LICENSE absent |
| `umt5-xxl-fp8` | Comfy-Org/Wan_2.1_ComfyUI_repackaged | [google/umt5-xxl](https://huggingface.co/google/umt5-xxl) | API : apache-2.0 ; aucune autre mention | absent | **accepté**, LICENSE absent |
| `wan21-vae` | Comfy-Org/Wan_2.1_ComfyUI_repackaged | [Wan-AI/Wan2.1-I2V-14B-480P](https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P) | même paragraphe que Wan 2.2 | `LICENSE.txt` : Apache-2.0 standard, identique au texte SPDX | **accepté** |
| `z-image-turbo` | Comfy-Org/z_image_turbo | [Tongyi-MAI/Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) | API : apache-2.0 ; aucune autre mention | absent | **accepté**, LICENSE absent |
| `qwen3-4b` | Comfy-Org/z_image_turbo | [Qwen/Qwen3-4B](https://huggingface.co/Qwen/Qwen3-4B) | API : apache-2.0, `license_link` vers le LICENSE du dépôt | `LICENSE` : Apache-2.0 standard, « Copyright 2024 Alibaba Cloud » | **accepté** |
| `flux-ae` | Comfy-Org/z_image_turbo (sans accès restreint) | [black-forest-labs/FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell) | README GitHub de BFL : « The weights of the autoencoder are also released under apache-2.0 » ; carte : « can be used for personal, scientific, and commercial purposes » | absent sur HF ; `model_licenses/LICENSE-FLUX1-schnell` sur GitHub : Apache-2.0 | **accepté**, avec une réserve (voir plus bas) |

Miroirs Comfy-Org : `Wan_2.2_ComfyUI_Repackaged`, `Wan_2.1_ComfyUI_repackaged` et `z_image_turbo` déclarent apache-2.0 et n'ont pas de fichier LICENSE. Un miroir ne change pas la licence : celle qui compte est celle de la source.

Les deux fichiers Fun-Camera fp8 n'existent que chez Comfy-Org : c'est une conversion des poids alibaba-pai. Les versions bf16 de Comfy-Org ont, elles, le même sha256 que les fichiers d'alibaba-pai. Les VAE et `umt5`/`qwen_3_4b` sont aussi des conversions (le format `.pth`, plusieurs shards et le fp8 deviennent un seul `.safetensors`), et la licence Apache-2.0 suit les œuvres dérivées.

### Points tranchés

- **Paragraphe « fully accountable » des cartes Wan et Lightning.** Il demande de ne pas diffuser de contenu illégal ou nuisible, et renvoie pour la liste complète des restrictions au texte Apache-2.0 lui-même. Il n'ajoute ni clause non commerciale, ni seuil, ni restriction de territoire : **accepté**. Si l'on refusait ce paragraphe, il faudrait aussi refuser tout Wan, donc le cœur du projet.
- **`ae.safetensors` (autoencodeur FLUX).** BFL déclare l'autoencodeur sous Apache-2.0. La liste « Out-of-Scope Use » de la carte vise des usages illégaux ou nuisibles (mineurs, désinformation, harcèlement…), pas un usage commercial, un seuil ou un territoire : **accepté**. Le fichier est pris chez Comfy-Org, sans accès restreint. Sa taille, 335 304 388 octets, est celle de l'autoencodeur FLUX. **Reste à vérifier, par vous :** le dépôt BFL masque son sha256 sans compte. Avec votre compte Hugging Face, après avoir accepté le partage de contact demandé par BFL, comparez le sha256 de `ae.safetensors` sur FLUX.1-schnell à `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38`.

### Accélération LightX2V / Lightning

| Dépôt | Ce qu'il dit | Fichier LICENSE | Verdict |
|---|---|---|---|
| [lightx2v/Wan2.2-Lightning](https://huggingface.co/lightx2v/Wan2.2-Lightning) | « The models in this repository are licensed under the Apache 2.0 License », même paragraphe que Wan. La mention CC BY-NC concerne les prompts d'évaluation de Movie Gen Bench, pas les poids. | absent (la carte renvoie à un `LICENSE.txt` absent) | **accepté**, LICENSE absent |
| [lightx2v/Wan2.2-Distill-Loras](https://huggingface.co/lightx2v/Wan2.2-Distill-Loras) | API : apache-2.0, badge Apache-2.0 | absent | **accepté**, LICENSE absent |
| [lightx2v/Wan2.2-Distill-Models](https://huggingface.co/lightx2v/Wan2.2-Distill-Models) | API : apache-2.0, badge Apache-2.0 | absent | **accepté**, LICENSE absent |
| GitHub [ModelTC/LightX2V](https://github.com/ModelTC/LightX2V) (code) | Apache-2.0 standard, sans phrase sur les poids | `LICENSE` | code accepté ; ne couvre pas les poids |
| GitHub [ModelTC/LightX2V-Wan2.2-Lightning](https://github.com/ModelTC/LightX2V-Wan2.2-Lightning) (ex-`Wan2.2-Lightning`) | même phrase « models … licensed under the Apache 2.0 License » | `LICENSE.txt` : Apache-2.0 standard | **accepté** |

Origine des LoRA du template officiel : `wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise.safetensors` de Comfy-Org sont identiques octet pour octet (même taille, 1 226 977 424 octets, et même sha256) à `Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1/{high,low}_noise_model.safetensors` de **lightx2v/Wan2.2-Lightning**. L'historique Comfy-Org du 11/08/2025 le dit aussi (« … from lightx2v/Wan2.2-Lightning »). La carte Comfy-Org cite `Wan2.2-Distill-Loras`, à tort pour ces fichiers.

| LoRA | sha256 |
|---|---|
| high noise | `d176c808d6fc461999b68e321efcb7501b20b8c3797523ed0df14f7d1deff11e` |
| low noise | `024f21de095bc8fad9809ded3e9e49a2e170dcf27075da8145ba7d60d8aab7f9` |

**Décision :** la licence permet d'évaluer l'accélération en S2. Les LoRA **n'entrent ni dans le lock ni dans les workflows** tant que la S2 n'a pas vérifié que le mouvement de caméra est conservé. Le template officiel prévient lui-même que ces LoRA font perdre de la dynamique, et elles ont été entraînées sur Wan 2.2 I2V, pas sur Fun-Camera. Si la S2 les adopte : deux entrées au lock (`source` = lightx2v/Wan2.2-Lightning), `LoraLoaderModelOnly` dans `allowed-nodes.yaml`, un workflow 4 étapes (cfg 1, 2 + 2 étapes) à côté de celui en 20 étapes.

### Templates de workflows

- GitHub [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) : MIT, « Copyright (c) 2023-present Comfy Org », texte standard. **Accepté.** Fichiers lus au commit `59a3b48bf369c5a15f29a1308bae3e279fa15505` (18/10/2026).
- Paquet pip `comfyui-workflow-templates` 0.11.89 : licence déclarée MIT, comme ses sous-paquets.

## 2. Lock exact

`registry/models.lock.yaml` donne pour chaque fichier l'URL exacte (`resolve/main/…`), la taille et le sha256. Ces valeurs viennent de l'API Hugging Face (`paths-info` / `tree`) : le sha256 est le champ `lfs.oid` de l'objet LFS, c'est-à-dire le sha256 du fichier. La commande est `npm run weights -w @montagio/infra-runpod -- --lock-from-hf`. Deux fichiers (`ae.safetensors` et `qwen_3_4b.safetensors`) ont été recoupés à la main par `paths-info`.

| Entrée | Taille (octets) | sha256 |
|---|---|---|
| `wan22-fun-camera-high` | 15 301 408 048 | `89a99cb5ab29e388f2e24fddac48eab4d88ca339d236c7a8d96aabacd0f525ae` |
| `wan22-fun-camera-low` | 15 301 408 048 | `a2b7b361e3fad907958aa6ad662a3673bad5ffdce14706cffde4baabb98f9020` |
| `wan22-ti2v-5b` | 9 999 658 848 | `456f901338bd9eadbded3828b819109a9b68e8a525ca5cf8d0049a69fcfeca1e` |
| `umt5-xxl-fp8` | 6 735 906 897 | `c3355d30191f1f066b26d93fba017ae9809dce6c627dda5f6a66eaa651204f68` |
| `wan21-vae` | 253 815 318 | `2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b` |
| `wan22-vae` | 1 409 400 960 | `e40321bd36b9709991dae2530eb4ac303dd168276980d3e9bc4b6e2b75fed156` |
| `z-image-turbo` | 12 309 866 400 | `2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6` |
| `qwen3-4b` | 8 044 982 048 | `6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a` |
| `flux-ae` | 335 304 388 | `afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38` |

Total : 69,7 Go (64,9 Gio). Au téléchargement en S2, `fetch-weights` vérifie chaque fichier contre ce sha256. Il refuse, avant de télécharger, un fichier dont Hugging Face annonce un autre sha256 ou une autre taille.

## 3. Contrôle caméra pour Wan 2.2 5B (Q3)

En-têtes lus par deux requêtes Range chacun, sans télécharger les poids : `npm run weights -w @montagio/infra-runpod -- --inspect <url>`. Résultats :

| Fichier | `patch_embedding.weight` (`in_dim` = dim. 1) | `head.head.weight` (`out_dim` = dim. 0 ÷ 4) | `control_adapter.conv.weight` | `img_emb.*` |
|---|---|---|---|---|
| `alibaba-pai/Wan2.2-Fun-5B-Control-Camera/diffusion_pytorch_model.safetensors` (831 tenseurs, 5,25 G paramètres, BF16) | [3072, **100**, 1, 2, 2] | [192, 3072] → 48 | [3072, **6144**, 2, 2] | absent |
| `wan2.2_ti2v_5B_fp16.safetensors` (lock) | [3072, 48, 1, 2, 2] | [192, 3072] → 48 | absent | absent |
| `wan2.2_fun_camera_high_noise_14B_fp8_scaled.safetensors` (lock) | [5120, **36**, 1, 2, 2] | [64, 5120] → 16 | [5120, **1536**, 2, 2] | absent |

Lecture du code de ComfyUI v0.41.0 :

1. **Détection.** `comfy/model_detection.py` (l. 762 à 773) lit `in_dim` dans `patch_embedding.weight`. Le 5B Control-Camera a un `control_adapter` et pas de `img_emb` : il devient donc `model_type = "camera_2.2"` avec `in_dim = 100`. Or la seule classe pour `camera_2.2`, `WAN22_Camera` (`comfy/supported_models.py`, l. 1435 à 1440), exige `in_dim: 36`. Et `matches` (`comfy/supported_models_base.py`, l. 57 à 65) demande l'égalité de chaque clé. Aucune classe ne correspond : **`UNETLoader` refuse le fichier** (modèle non reconnu). Le format VideoX-Fun n'est pas en cause : le Fun-Camera 14B bf16 de Comfy-Org est le fichier d'alibaba-pai, octet pour octet, et le 14B fp8 du lock a l'`in_dim` de 36 qu'attend `WAN22_Camera`. Son chargement n'a pas encore été observé : c'est le premier rendu de la S2.
2. **Adaptateur caméra.** Même si la détection passait, `WanCamAdapter` (`comfy/ldm/wan/model.py`, l. 321 et 325) fixe le pixel-unshuffle à 8. Il attend donc 24 × 64 = 1536 canaux, alors que le 5B en a 6144 = 24 × 256 (un unshuffle de 16, aligné sur le VAE ×16). Les poids ne se chargeraient pas.
3. **Latent.** `WanCameraImageToVideo` (`comfy_extras/nodes_wan.py`, l. 430 et 431) fabrique un latent Wan 2.1 à **16 canaux en /8**, et `WAN22_Camera` hérite de `latent_format = Wan21`. Le 5B travaille avec le VAE Wan 2.2 : **48 canaux en /16** (`Wan22ImageToVideoLatent`, l. 1439). Le `in_dim` de 100 vaut 48 (bruit) + 4 (masque) + 48 (image) : c'est la version Wan 2.2 de l'entrée à 36 canaux du 14B.

**Piste écartée : Fun Control 5B.** Le template officiel `video_wan2_2_5B_fun_control` existe, contrairement à un template « 5B Fun Camera ». Il charge `wan2.2_fun_control_5B_bf16.safetensors` avec `Wan22FunControlToVideo`. Son en-tête, lu de la même façon, ne contient pas de `control_adapter`, et son `patch_embedding` a 148 canaux d'entrée (48 de bruit, 48 de contrôle, 48 d'image, 4 de masque). Le cœur le charge donc comme un Wan 2.2 ordinaire, et `Wan22FunControlToVideo` (`comfy_extras/nodes_wan.py`, l. 151 à 163) gère bien le latent à 48 canaux. Mais ce modèle suit une **vidéo de contrôle** (canny, profondeur, pose), pas une trajectoire de caméra. Il faudrait fabriquer une vidéo de contrôle du mouvement voulu, ce qui relève d'un projet de recherche et non du concours.

**Décision :** pas de caméra paramétrique en 5B avec le cœur de ComfyUI v0.41.0. Le mode « Rapide » garde la caméra pilotée par le texte, que le compilateur gère déjà (`cameraMode: 'prompt'`). Il faudrait sinon une classe de modèle, un adaptateur et un node de latent nouveaux dans le cœur, ce qui sort du périmètre du concours. La S2 n'a **rien à tester** sur ce point. Il faudra rouvrir la question si une version de ComfyUI ajoute une classe `camera_2.2` à `in_dim` 100.

## 4. Vrais workflows (Q6)

Les trois `workflows/*.api.json` sont convertis depuis les templates officiels de [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) (MIT, commit `59a3b48b`), d'après les définitions des nodes de ComfyUI v0.41.0. La provenance, les règles de conversion et chaque écart au template sont dans [workflows/README.md](../workflows/README.md). Points clés :

- **Fun Camera 14B** (`video_wan2_2_14B_fun_camera.json`) : on garde le groupe 20 étapes. Il passe par deux `KSamplerAdvanced` (10 étapes sur le modèle « high noise », puis 10 sur le « low noise »), en cfg 3,5, euler/simple, avec **`ModelSamplingSD3` shift 8** sur les deux modèles. Ce node manquait au workflow provisoire. Le second groupe du template (4 étapes, LoRA LightX2V) est laissé de côté jusqu'à la S2.
- **5B** (`video_wan2_2_5B_ti2v.json`) : shift 8, 20 étapes, cfg 5, uni_pc. Le template livre `LoadImage` désactivé (texte vers vidéo) ; il est réactivé ici (image vers vidéo).
- **Z-Image-Turbo** (`image_z_image_turbo.json`) : le sous-graphe est aplati. `ModelSamplingAuraFlow` shift 3, 8 étapes, cfg 1, res_multistep. Le négatif est un `ConditioningZeroOut`, donc il n'y a pas de prompt négatif. Le registre n'exige plus de binding `negative` pour `t2i`.
- **`SaveVideo`** écrit un MP4 H.264 (`format` `mp4`, `format.codec` `h264`). Ces valeurs ont été vérifiées par un rendu sans modèle : une image de 64 × 48, encodée en vidéo d'une image.
- **Bindings** : les identifiants de nodes sont ceux du template. Ils sont dans `registry/models/*.yaml` et dans la table du README des workflows.
- **`allowed-nodes.yaml`** gagne quatre classes : `ModelSamplingSD3` et `ModelSamplingAuraFlow` (`comfy_extras/nodes_model_advanced.py`), `ConditioningZeroOut` (`nodes.py`), toutes trois du cœur d'après le `python_module` de `/object_info`, et `MontagioCameraEmbedding` (notre pack, GPL-3.0).

## 5. Combinaisons de mouvements (Q1)

- Le vrai ComfyUI v0.41.0 refuse `"Zoom In + Pan Left"` (`value_not_in_list`). Le défaut de l'ancien `compile.ts` est donc confirmé.
- **Nouveau node `Montagio Camera Embedding`** (`comfy-nodes/`, GPL-3.0). Il reprend les entrées et les sorties de `WanCameraEmbedding` et ajoute `camera_pose_2` et `combine` :
  - `together` additionne les vecteurs des deux poses ;
  - `then` déroule la première pose sur la première moitié du clip, puis la seconde à partir de là.

  Le node construit la trajectoire en numpy et réutilise `process_pose_params` du cœur pour le calcul de Plücker.
- **Vérification.** Sur le ComfyUI v0.41.0 en CPU, pour les 9 poses seules, notre node rend exactement le tenseur du `WanCameraEmbedding` du cœur (`torch.equal`, en 64 × 48 sur 9 images). Les deux modes combinés donnent un tenseur de même forme, `[1, 24, 3, 48, 64]`, aux valeurs finies. Les tests légers comparent la trajectoire à une réécriture de la formule du cœur, image par image.
- **Presets.**
  - Le schéma gagne `camera.combine` (`together` par défaut, ou `then`). `static` n'entre dans une paire qu'avec `then`.
  - Pour deux poses, `compile.ts` remplace le node caméra par `MontagioCameraEmbedding`. Un preset à une pose garde le node du cœur et tourne donc sur un ComfyUI sans notre pack.
  - Rise & Push, Drift Left Push et Pull Back & Tilt Up utilisent `together`.
  - À votre demande, Push & Settle devient `[zoom_in, static]` en `then` (avancée puis arrêt), et Breathing `[zoom_in, zoom_out]` en `then`.
  - Les 12 presets compilés passent le contrôle hors ligne. 10 compilations ont aussi passé la validation du vrai ComfyUI.
- **À voir en S2 :** la qualité réelle des deux modes, et la vitesse maximale exploitable. Fun-Camera n'a jamais vu ces trajectoires sommées. Le pack Montagio doit être installé sur le pod pour les presets combinés.

## 6. Rotations ACW/CW (Q2)

À votre demande, deux poses rejoignent le schéma, **sans nouveau preset** : `roll_ccw` (« Anti Clockwise (ACW) ») et `roll_cw` (« ClockWise (CW) »). Toutes les valeurs de `camera_pose` du node du cœur sont donc accessibles depuis un preset, et le remix les accepte. `base_angle` vaut π/3, si bien qu'à la vitesse 1 la caméra tourne de 60° sur le clip : un « Dutch angle » se situerait autour de 0,3. La S2 décidera d'un preset après avoir vu un rendu. Dans la galerie, le glyphe affiche une rotation comme une caméra fixe ; aucun preset n'en utilise.

## 7. Validation sur un ComfyUI en mode CPU

ComfyUI v0.41.0 a été installé dans `../comfyui-cpu-v0.41.0`, hors du dépôt :
- commit `98cc0bf8` vérifié ;
- torch 2.14.1+cpu ;
- 2,1 Go sur le disque ;
- `pydantic` ajouté (classé « non essentiel », mais importé au démarrage).

Il a été lancé avec `--cpu --disable-partner-nodes` et le pack Montagio. Résultat : 650 classes, **0 node partenaire**, et les 19 classes utiles toutes présentes.

Les fichiers de modèle étaient **vides**, avec les noms du lock. Chaque `POST /prompt` a été suivi aussitôt d'un `/interrupt` et d'un vidage de la file, et **rien n'a été généré**. Ont passé la validation, sans erreur de node : les 3 workflows, puis 10 presets compilés (Crash Push, Rise & Push, Push & Settle et Breathing sur Fun Camera, en 480p et 720p ; Crash Push sur le 5B en 480p et 720p).

Le `/object_info` de cette installation sert de fixture (`infra/runpod/test/fixtures/object_info-v0.41.0.json`) au contrôle hors ligne `infra/runpod/test/workflows.test.ts`. Vous pouvez supprimer le dossier `comfyui-cpu-v0.41.0` ; le garder permet de rejouer le test lourd du node (`MONTAGIO_COMFYUI_DIR=<dossier> npm run test:nodes`).

## 8. À vérifier sur GPU en S2

Ce que ni le code ni les métadonnées ne peuvent dire :

1. **Premier rendu réel** de Fun Camera en 480p avec le workflow officiel. Temps à froid et à chaud, pic de VRAM sur 24 Go (deux 14B en fp8 qui se relaient).
2. **720p** sur Fun Camera : temps et VRAM, ou dépassement de mémoire.
3. **5B** en 480p et en 720p. Le widget de `Wan22ImageToVideoLatent` demande des multiples de 32, or 720 n'en est pas un, et le template officiel utilise 1280 × 704. Si la qualité ou le rendu en pâtissent, la S2 doit donner au 5B ses propres dimensions en 720p.
4. **Z-Image-Turbo** : temps et VRAM d'une image en 16:9, pour l'image de départ de « Try with a sample photo ».
5. **Qualité des mouvements** : une note de 1 à 5 par pose et par vitesse, la vitesse maximale exploitable, et les combinés `together` et `then` (Rise & Push, Push & Settle, Breathing).
6. **« Pan » contre « Tilt »** : les poses Pan Up et Pan Down déplacent la caméra (grue), elles ne la font pas pivoter. Faut-il renommer Tilt Up et Tilt Down (par exemple « Crane Up ») ?
7. **Négatif par défaut de Wan** (node 99 du template) : faut-il l'ajouter au négatif des presets ? Comparer un rendu avec et sans.
8. **LightX2V 4 étapes** : la licence est acceptée. Le mouvement de caméra est-il conservé ? Comparer sur un preset le groupe 4 étapes du template (désactivé par défaut) et le workflow en 20 étapes.
9. **Rotations** : rendu de `roll_cw` à la vitesse 0,3, et un éventuel preset « Dutch ».

## 9. Ce qui vous revient

- **Q5, Comfy Cloud.**
  - *Templates : observé.* Dans `templates/index.json` de Comfy-Org/workflow_templates (branche `main`, 18/10), aucun des trois templates n'a de champ `includeOnDistributions`. Le `docs/SPEC.md` du même dépôt présente ce champ comme facultatif, avec les valeurs `cloud`, `local`, `desktop`, `mac` et `windows`. On en déduit que ces templates sont proposés partout, Comfy Cloud compris.
  - *Fichiers de poids sur Cloud : non vérifiable sans compte.* Aucune liste publique ne dit lesquels sont préinstallés. La session principale indique que des poids manquants s'importent depuis Hugging Face avec un abonnement Creator ou supérieur ; ce point n'a pas été vérifié ici.
  - *À faire avec votre compte* (sur votre PC, sans rien lancer de payant) : ouvrez les trois templates sur cloud.comfy.org, vérifiez qu'aucun modèle n'est signalé manquant, et notez la version de ComfyUI (Settings → About).
  - Les presets à une pose n'utilisent que des nodes du cœur. Les presets combinés ont besoin du pack Montagio, absent de Comfy Cloud tant qu'il n'est pas publié sur le Registry.
- **sha256 de `ae.safetensors`** chez BFL (partie 1) : à comparer avec votre compte Hugging Face.
