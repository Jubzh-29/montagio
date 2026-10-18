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

1. **Détection.** `comfy/model_detection.py` (l. 762 à 773) lit `in_dim` dans `patch_embedding.weight`. Le 5B Control-Camera a un `control_adapter` et pas de `img_emb` : il devient donc `model_type = "camera_2.2"` avec `in_dim = 100`. Or la seule classe pour `camera_2.2`, `WAN22_Camera` (`comfy/supported_models.py`, l. 1435 à 1440), exige `in_dim: 36`. Et `matches` (`comfy/supported_models_base.py`, l. 57 à 65) demande l'égalité de chaque clé. Aucune classe ne correspond : **`UNETLoader` refuse le fichier** (modèle non reconnu). Le format VideoX-Fun n'est pas en cause : le Fun-Camera 14B bf16 de Comfy-Org est le fichier d'alibaba-pai, octet pour octet, et il se charge.
2. **Adaptateur caméra.** Même si la détection passait, `WanCamAdapter` (`comfy/ldm/wan/model.py`, l. 321 et 325) fixe le pixel-unshuffle à 8. Il attend donc 24 × 64 = 1536 canaux, alors que le 5B en a 6144 = 24 × 256 (un unshuffle de 16, aligné sur le VAE ×16). Les poids ne se chargeraient pas.
3. **Latent.** `WanCameraImageToVideo` (`comfy_extras/nodes_wan.py`, l. 430 et 431) fabrique un latent Wan 2.1 à **16 canaux en /8**, et `WAN22_Camera` hérite de `latent_format = Wan21`. Le 5B travaille avec le VAE Wan 2.2 : **48 canaux en /16** (`Wan22ImageToVideoLatent`, l. 1439). Le `in_dim` de 100 vaut 48 (bruit) + 4 (masque) + 48 (image) : c'est la version Wan 2.2 de l'entrée à 36 canaux du 14B.

**Décision :** pas de caméra paramétrique en 5B avec le cœur de ComfyUI v0.41.0. Le mode « Rapide » garde la caméra pilotée par le texte, que le compilateur gère déjà (`cameraMode: 'prompt'`). Il faudrait sinon une classe de modèle, un adaptateur et un node de latent nouveaux dans le cœur, ce qui sort du périmètre du concours. La S2 n'a **rien à tester** sur ce point. Il faudra rouvrir la question si une version de ComfyUI ajoute une classe `camera_2.2` à `in_dim` 100.
