# Analyse des extensions, sans GPU (19/10/2026)

Le 19/10, l'utilisateur a choisi d'ajouter à Montagio quatre extensions (musique, upscale HD, édition d'image, avatar parlant). Le même jour, il les a réorientées vers les « hooks » viraux d'une photo, d'après le rapport du 19/10 sur les fonctions virales du concurrent (dossier `reports/`, à côté du dépôt) : ce qui manque à Montagio, ce sont des effets d'une photo, de trois secondes, nommés et rejouables. Ordre de priorité retenu :
1. **Édition d'image** (Qwen-Image-Edit-2511) : la photo modifiée par une instruction, en 4 étapes avec la LoRA Lightning, avec trois « looks » (gonflé, figurine, angle de vue) et une seconde image. Elle fait aussi l'image finale des transitions.
2. **Pack de 6 effets** : Squish, Cake-ify, Explode, Crash Zoom, Bullet Time et 360 Orbit, des LoRA de Remade-AI sur Wan 2.1 I2V 480p.
3. **Transitions par images clés** : l'édition fait l'image finale, Wan 2.2 FLF2V anime le passage. Hooks : Eyes In et Outfit Morph en S2, Figurine et Ignite (embrasement) en S3.
4. **Avatar parlant** : Wan 2.2 S2V et sa voix Chatterbox, gardés à la validation du plan révisé.
5. **Musique des films** (ACE-Step 1.5), mixée sous le film 16:9 et sa coupe 9:16.
6. **Upscale HD** (SeedVR2) : sans lien avec la viralité, plusieurs minutes par clip, c'est le premier candidat à la coupe.

Hors périmètre : le transfert de mouvement (Wan-Animate, SCAIL-2), reporté après le concours ; le selfie avec une célébrité, exclu ; les LoRA publiées seulement sur Civitai et la série Redmond (CC0-1.0, hors de la règle Apache ou MIT), exclues.

Cette analyse suit la méthode de [S1_ANALYSE.md](S1_ANALYSE.md). Aucun poids n'a été téléchargé et rien n'a été rendu. Les seuls accès réseau sont les pages et l'API de Hugging Face, GitHub (sources, templates, licences) et PyPI. Les recherches détaillées, avec chaque source datée, sont dans le dossier de travail de la session ; les faits qui portent une décision sont repris ici.

Règle de coupe décidée le 19/10 : le 25/10 au soir, toute extension non validée sur GPU est masquée de la démo, et aussi celle dont une extension requise est masquée (les transitions exigent l'édition). Le drapeau qui l'applique est décrit en partie 5.

## 1. Licences, lues à la source

Règle : un poids n'est accepté que sous Apache-2.0 ou MIT, **sans condition ajoutée** (usage non commercial, seuil de chiffre d'affaires, territoire). La licence qui compte est celle du dépôt **source** ; un miroir ne la change pas. Tout a été relu le 19/10/2026 : `cardData.license` de l'API, les lignes du README qui parlent de licence, et la présence d'un fichier LICENSE. Le commit lu de chaque dépôt est noté.

### Poids

| Extension | Dépôt source (commit) | Ce que dit la source | Fichier LICENSE | Verdict |
|---|---|---|---|---|
| Musique | [ACE-Step/Ace-Step1.5](https://huggingface.co/ACE-Step/Ace-Step1.5) (`19671f40`) : DiT turbo, LM 1,7B, VAE | API : mit ; carte : « License: [MIT] » | absent | **accepté**, LICENSE absent |
| Musique | [Qwen/Qwen3-Embedding-0.6B](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B) (`97b0c614`) : encodeur de texte | API : apache-2.0 | absent | **accepté**, LICENSE absent |
| Musique | [Qwen/Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B) (`70d244cc`) : base du LM | API : apache-2.0, `license_link` vers son LICENSE | Apache-2.0 standard, « Copyright 2024 Alibaba Cloud » | **accepté** |
| Upscale | [ByteDance-Seed/SeedVR2-3B](https://huggingface.co/ByteDance-Seed/SeedVR2-3B) (`37255ff8`) | carte : « SeedVR and SeedVR2 are licensed under the Apache 2.0. » | absent ; GitHub [ByteDance-Seed/SeedVR](https://github.com/ByteDance-Seed/SeedVR) : Apache-2.0 standard | **accepté** |
| Édition | [Qwen/Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) (`6f3ccc0b`) | carte : « Qwen-Image is licensed under Apache 2.0. » | absent | **accepté**, LICENSE absent |
| Édition | [Qwen/Qwen2.5-VL-7B-Instruct](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct) (`cc594898`) : encodeur de texte | API : apache-2.0 (les tailles 3B et 72B ont d'autres licences ; le fichier chargé est bien un 7B) | absent | **accepté**, LICENSE absent |
| Édition | [Qwen/Qwen-Image](https://huggingface.co/Qwen/Qwen-Image) (`75e0b4be`) : VAE | même phrase que 2511 | Apache-2.0 standard, « Copyright 2024 Alibaba Cloud » | **accepté** |
| Avatar | [Wan-AI/Wan2.2-S2V-14B](https://huggingface.co/Wan-AI/Wan2.2-S2V-14B) (`dab4e9c5`) | « The models in this repository are licensed under the Apache 2.0 License », plus le paragraphe « fully accountable » de Wan | absent ; GitHub [Wan-Video/Wan2.2](https://github.com/Wan-Video/Wan2.2) : Apache-2.0 | **accepté** (paragraphe déjà accepté en S1) |
| Avatar | [jonatasgrosman/wav2vec2-large-xlsr-53-english](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-english) (`569a6236`) : encodeur audio | API : apache-2.0 ; les mêmes fichiers sont dans le dépôt Apache-2.0 de Wan2.2-S2V | absent | **accepté** |
| Avatar | [facebook/wav2vec2-large-xlsr-53](https://huggingface.co/facebook/wav2vec2-large-xlsr-53) (`c3f9d884`) : base de l'encodeur | API : apache-2.0 ; la publication d'origine (fairseq) est MIT | absent | **accepté** |
| Avatar | [lightx2v/Wan2.2-Lightning](https://huggingface.co/lightx2v/Wan2.2-Lightning) (`18bccf88`) : LoRA 4 étapes | même phrase que Wan ; la mention CC BY-NC vise des prompts d'évaluation, pas les poids | absent ; GitHub ModelTC : Apache-2.0 | **accepté** (déjà lu en S1) |
| Voix | [ResembleAI/chatterbox](https://huggingface.co/ResembleAI/chatterbox) (`5bb1f6ee`) | API : mit | absent ; GitHub [resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox) : MIT | **accepté**, LICENSE absent |
| Édition | [lightx2v/Qwen-Image-Edit-2511-Lightning](https://huggingface.co/lightx2v/Qwen-Image-Edit-2511-Lightning) (`107d238d`) : LoRA 4 étapes | API : apache-2.0 ; GitHub ModelTC/Qwen-Image-Lightning : Apache-2.0 | absent | **accepté**, LICENSE absent |
| Édition | [systms/SYSTMS-INFL8-LoRA-Qwen-Image-Edit-2511](https://huggingface.co/systms/SYSTMS-INFL8-LoRA-Qwen-Image-Edit-2511) (`d12b29cd`) : look « gonflé » | API : apache-2.0 ; données d'entraînement non décrites | absent | **accepté**, LICENSE absent |
| Édition | [systms/SYSTMS-ACTION-LoRA-Qwen-Image-Edit-2511](https://huggingface.co/systms/SYSTMS-ACTION-LoRA-Qwen-Image-Edit-2511) (`fb1f50ac`) : look « figurine » | API : apache-2.0 ; « a variety of photos and illustrations » | absent | **accepté**, LICENSE absent |
| Édition | [fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA](https://huggingface.co/fal/Qwen-Image-Edit-2511-Multiple-Angles-LoRA) (`e3066224`) : look « angle de vue » | API : apache-2.0 ; entraînée sur des rendus synthétiques (Gaussian splats) faits par fal | absent | **accepté**, LICENSE absent |
| Effets | [Wan-AI/Wan2.1-I2V-14B-480P](https://huggingface.co/Wan-AI/Wan2.1-I2V-14B-480P) (`6b73f84e`) | API : apache-2.0, plus le paragraphe d'usage de Wan | LICENSE.txt, Apache-2.0 | **accepté** |
| Effets | [laion/CLIP-ViT-H-14-laion2B-s32B-b79K](https://huggingface.co/laion/CLIP-ViT-H-14-laion2B-s32B-b79K) (`1c2b8495`) : `clip_vision_h` | API : mit ; source déduite de la config `image_encoder` de Wan, Comfy-Org ne la nomme pas | absent | **accepté** |
| Effets | [lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v](https://huggingface.co/lightx2v/Wan2.1-I2V-14B-480P-StepDistill-CfgDistill-Lightx2v) (`9bedb7ce`) : LoRA 4 étapes | API : apache-2.0 | LICENSE.txt, Apache-2.0 | **accepté** |
| Effets | [Remade-AI](https://huggingface.co/Remade-AI) : Squish (`1e081085`), Cakeify (`01167db8`), Explode (`bf9da953`), Crash-zoom-in (`96f8f59b`), matrix-shot (`f27f77c2`), 360-Orbit (`f22f9e46`) | API : apache-2.0, et aucune autre ligne de licence dans le README ; aucun titulaire de droits nommé, clips d'entraînement non décrits | absent | **accepté, preuve faible** (voir plus bas) |
| Transitions | [Wan-AI/Wan2.2-I2V-A14B](https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B) (`206a9ee1`) | API : apache-2.0, plus le paragraphe d'usage de Wan ; le README cite un LICENSE.txt que le dépôt n'a pas | absent ; GitHub [Wan-Video/Wan2.2](https://github.com/Wan-Video/Wan2.2) : Apache-2.0 | **accepté** (paragraphe déjà accepté en S1) |
| Transitions | [lightx2v/Wan2.2-Lightning](https://huggingface.co/lightx2v/Wan2.2-Lightning) (`18bccf88`) : LoRA I2V 4 étapes, haute et basse | déjà lu pour l'avatar | absent | **accepté** |

### Miroirs Comfy-Org

Les fichiers téléchargés viennent de miroirs Comfy-Org, sauf la voix et les LoRA de l'édition et des effets (dépôts source). Tous déclarent apache-2.0 sans fichier LICENSE : `ace_step_1.5_ComfyUI_files` (`6707deb2`), `SeedVR2` (`df488797`), `Qwen-Image-Edit_ComfyUI` (`f68ace85`), `Qwen-Image_ComfyUI` (`1f12b17b`), `Wan_2.2_ComfyUI_Repackaged` (`ee6f4a40`), `Wan_2.1_ComfyUI_repackaged` (`123acf1c`).

### Points tranchés

- **ACE-Step : MIT, pas Apache-2.0.** Le miroir Comfy-Org déclare apache-2.0, alors que la source est MIT. Le lock suit la source : `license: MIT`. Les deux licences passent la règle.
- **Encodeur de texte de Qwen-Image-Edit : pas le miroir du template.** Le template officiel, la doc et le blueprint de ComfyUI le téléchargent depuis `Comfy-Org/HunyuanVideo_1.5_repackaged` (`1405a2b7`), dont la carte porte la licence « tencent-hunyuan-community ». Celle-ci exclut l'Union européenne, le Royaume-Uni et la Corée du Sud. Le même fichier, au même sha256 (`cb5636d8…`), est dans `Comfy-Org/Qwen-Image_ComfyUI`, sous Apache-2.0 : c'est l'URL du lock. ComfyUI ne lit que le nom du fichier.
- **Les deux pièges de licence des templates officiels, et la règle qui les arrête.**
  - Les templates de Qwen-Image-Edit téléchargent l'encodeur Qwen2.5-VL chez `Comfy-Org/HunyuanVideo_1.5_repackaged` (point précédent) : le lock le prenait déjà chez `Qwen-Image_ComfyUI`.
  - Le template InfiniteTalk télécharge sa LoRA lightx2v et sa VAE chez `Kijai/WanVideo_comfy`, un dépôt sans licence déclarée qui contient un dossier sous CC BY-NC-SA 4.0. Montagio n'utilise pas InfiniteTalk ; la LoRA 4 étapes des effets vient du dépôt original de lightx2v, avec son LICENSE.txt.
  - Pour que ces pièges ne puissent plus entrer, `check-open-stack` vérifie le **dépôt** de chaque fichier, plus seulement son nom (règle `weight-source`). `tools/check-open-stack/allowed-sources.yaml` liste les dépôts autorisés, miroirs ou sources, avec la révision lue et la présence d'un LICENSE ; il refuse ces deux dépôts, la série Redmond (CC0-1.0) et deux LoRA d'angle écartées. Une entrée du lock échoue si son URL vient d'un dépôt refusé ou inconnu, si sa source n'est pas listée comme source, ou si sa licence n'est pas celle de sa source.
- **LoRA de Remade-AI : une preuve de licence faible, assumée et écrite.** Apache-2.0 n'est que dans les métadonnées de la carte, sans fichier LICENSE ni titulaire de droits, et l'origine des clips d'entraînement n'est pas dite. C'est noté dans `allowed-sources.yaml` (`license_file: false`) et sur chaque entrée du lock. Ce sont aussi les LoRA d'effets les plus adoptées. Si cette preuve est jugée insuffisante, le drapeau coupe les effets sans toucher au reste.
- **Inflate ou Cakeify : Cakeify**, parce que le look INFL8 de l'édition fait déjà le gonflement. **Orbite : celle de Remade**, sur la même base que les cinq autres effets ; l'orbite native Wan 2.2 d'ostris (Apache-2.0, carte seulement) reste une alternative sur les poids des transitions.
- **Multiple-Angles : la LoRA de fal.** Celle de dx8152 vise Qwen-Image-Edit-2509 et sa carte demande un paiement pour un usage commercial ; celle de berkerdooo est entraînée sur des données CC-BY d'Objaverse ; une vingtaine d'autres dépôts sont des copies du fichier de fal (même sha256).
- **LoRA 4 étapes de Wan 2.1 : l'original de lightx2v**, pas l'extraction de Kijai que copient les templates (aussi dans `Comfy-Org/Wan-Animate-2`, octets différents). Son format de clés n'a pas pu être vérifié sans lire l'en-tête du fichier : la S2 vérifie l'absence d'avertissement `lora key not loaded`, sinon elle prend la copie de Wan-Animate-2 avec `fetch-weights --extra`.
- **Avertissement d'usage d'ACE-Step.** Le README GitHub demande d'utiliser le modèle de façon éthique. La phrase n'est ni dans le LICENSE (MIT standard) ni sur les cartes des poids, et n'ajoute aucune clause commerciale, de seuil ou de territoire : informatif.
- **LoRA, deux décisions différentes.** La LoRA Lightning de Qwen-Image-Edit (Apache-2.0) reste hors du lock et hors du workflow jusqu'à la S2, comme LightX2V en S1. Celle de l'avatar entre au lock : sans elle, 15 s de parole demandent plus d'une heure de GPU (partie 4).
- **InfiniteTalk écarté pour l'avatar.** Son encodeur audio, `TencentGameMate/chinese-wav2vec2-base`, n'a qu'une étiquette MIT, sans fichier LICENSE ; son dépôt GitHub n'a aucune licence ; il a été pré-entraîné sur WenetSpeech, distribué pour un usage non commercial. Ses poids passent la règle à la lettre, mais leur provenance est faible. Il ne tient pas non plus en 24 Go (partie 4). Il partagerait la base des effets (Wan 2.1 I2V 480p), ce qui économiserait du disque, pas de la VRAM. L'utilisateur a choisi Wan 2.2 S2V le 19/10, et l'a gardé à la validation du plan révisé.

### Code tiers

| Code | Licence | Note |
|---|---|---|
| [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) au commit `59a3b48b` | MIT (déjà dans [workflows/LICENSE.workflow_templates](../workflows/LICENSE.workflow_templates)) | les 5 nouveaux workflows en sont convertis |
| [wildminder/ComfyUI-Chatterbox](https://github.com/wildminder/ComfyUI-Chatterbox) au commit `4597af8f` (node de la voix) | Apache-2.0 (API GitHub) | sa ligne de copyright est recopiée d'un autre projet, et le pack n'a pas de NOTICE. Le code chatterbox qu'il contient est MIT (Resemble AI), sans son texte de licence. Informatif : à citer dans les notices. Choix du node : partie 2 |

## 2. Nodes et templates

Les workflows partent des templates officiels de [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) au commit `59a3b48b` (MIT), le même que les workflows des presets. La conversion suit les règles de [workflows/README.md](../workflows/README.md), qui note aussi chaque écart au template. Chaque workflow est accepté par le contrôle hors ligne (`infra/runpod/test/workflows.test.ts`), sur une fixture tirée du vrai `/object_info` de ComfyUI v0.41.0.

### Musique : ACE-Step 1.5, nodes du cœur

- Template `templates/audio_ace_step_1_5_split.json` (DiT turbo 2B, encodeur 0,6B, LM 1,7B). C'est le seul template ACE-Step 1.5 sans node partenaire ni restriction de distribution qui reste léger : `split_llm` passe par `GeminiNodeV2` (API Google, exclu), et `xl_base` n'est proposé qu'en local.
- Nodes : `UNETLoader`, `ModelSamplingAuraFlow` (shift 3), `DualCLIPLoader` (type `ace`, les deux fichiers sont nécessaires : un `CLIPLoader` seul prend l'encodeur 0,6B pour un autre modèle, `comfy/sd.py:2009`), `TextEncodeAceStepAudio1.5` (`comfy_extras/nodes_ace.py:31`), `EmptyAceStep1.5LatentAudio` (`nodes_ace.py:87`), `ConditioningZeroOut`, `KSampler` (8 étapes, cfg 1), `VAEDecodeAudio`, `SaveAudioAdvanced` (`comfy_extras/nodes_audio.py:290`). ComfyUI v0.41.0 reconnaît le DiT (`comfy/model_detection.py:1054`, classe `ACEStep15`, `comfy/supported_models.py:2299`).
- La durée sert deux fois : longueur du latent (25 images par seconde) et nombre de codes que le LM produit (`ceil(durée) × 5`). La seed sert au LM et au KSampler. Le compilateur écrit donc chaque valeur dans deux entrées.
- Morceau sans voix : `lyrics` = `[Instrumental]`, comme le dit la documentation d'ACE-Step ; le compilateur termine aussi la description par « instrumental ». Que la musique reste vraiment sans voix est un point de la S2.
- La sortie est un FLAC 48 kHz stéréo. comfy-api-proxy 0.1.6 la rapporte avec le type `audio`, et son `content_type` peut valoir `application/octet-stream` (Python n'a pas de type MIME pour `.flac`) : l'adaptateur choisit la sortie par son type (tâche 1).

### Upscale HD : SeedVR2 3B, nodes du cœur

- Template `templates/utility_seedvr2_3b_int8_upscale_video.json`, le seul template vidéo SeedVR2 fait de nodes du cœur (les autres demandent le custom node `numz/ComfyUI-SeedVR2_VideoUpscaler`, ou passent par une API).
- Nodes : `LoadVideo` et `GetVideoComponents` (`comfy_extras/nodes_video.py`), `ResizeImageMaskNode` (`comfy_extras/nodes_post_processing.py:417`), `SeedVR2Preprocess`, `SeedVR2TemporalChunk`, `SeedVR2Conditioning`, `SeedVR2TemporalMerge`, `SeedVR2PostProcessing` (`comfy_extras/nodes_seedvr.py`), `VAEEncodeTiled`, `VAEDecodeTiled`, `KSampler` (une étape, cfg 1), `CreateVideo`, `SaveVideo`. ComfyUI v0.41.0 reconnaît le 3B et le 7B (`comfy/model_detection.py:708-745`) ; la classe `SeedVR2` exige les conditionnements de texte intégrés, que seuls les fichiers Comfy-Org portent (`comfy/supported_models.py:1844`).
- SeedVR2 n'a pas d'entrée de taille : le redimensionnement qui le précède fixe la sortie, 1920×1080, 1080×1920 ou 1080×1080 selon l'aspect du clip, sans étirement. Le prétraitement complète à des multiples de 16 (1080 devient 1088), le post-traitement recadre.
- Découpage temporel câblé en mode `manual` : morceaux de 33 images, recouvrement de 3. Sans lui, 81 images en 1080p demandent ≈ 35 Gio ; le mode `auto` dépend de la VRAM libre, donc des coutures qui bougent d'un rendu à l'autre.
- Contrôle hors ligne : `checkWorkflow` ne connaissait pas le type « MatchType » de l'API V3 que déclare `ResizeImageMaskNode` ; il l'accepte désormais, comme ComfyUI (`comfy_execution/validation.py:220-223`).

### Édition d'image : Qwen-Image-Edit-2511, nodes du cœur

- Template `templates/image_qwen_image_edit_2511.json`, sans node partenaire. Le groupe « Lightning » (LoRA 4 étapes), livré éteint, est retiré.
- Nodes : `LoadImage`, `FluxKontextImageScale` (`comfy_extras/nodes_flux.py:127`), `UNETLoader`, `ModelSamplingAuraFlow` (shift 3,1), `CFGNorm` (`comfy_extras/nodes_cfg.py:51`), `CLIPLoader` (type `qwen_image`), `VAELoader`, deux `TextEncodeQwenImageEditPlus` (`comfy_extras/nodes_qwen.py:54`), deux `FluxKontextMultiReferenceLatentMethod`, `VAEEncode`, `KSampler` (40 étapes, cfg 4), `VAEDecode`, `SaveImage`. ComfyUI v0.41.0 reconnaît 2511 comme un Qwen-Image et passe en mode de référence `index_timestep_zero` (`comfy/model_detection.py:1002-1008`).
- L'encodeur « Plus » est celui du template et du pipeline de référence (multi-images). Le node de méthode de référence n'a pas de valeur par défaut : sans valeur écrite, il prend `offset`, faux pour 2511. Le workflow l'écrit sur les deux encodeurs, et un test le garde.
- Taille de sortie : `FluxKontextImageScale` recadre au centre sur l'une de 17 tailles d'≈ 1 Mpx (16:9 → 1392×752, 4 % de la hauteur coupés). Le PNG édité a cette taille ; il garde l'aspect 16:9, 9:16 ou 1:1 que lit `pickAspect`. `ImageScaleToTotalPixels` (sans recadrage) est un essai de la S2.

### Édition : Lightning, looks et seconde image

- Le workflow porte la LoRA Lightning 4 étapes (171), un look (170) et une seconde image (42), reliée à `image2` des deux encodeurs. `compileEdit` retire et recâble ce qu'un job n'utilise pas : une LoRA inutilisée n'est jamais chargée à force 0.
- Par défaut, Lightning : 4 étapes à cfg 1, comme le template quand on active son groupe « 4 Steps Lightning LoRA ». Avec `fast: false`, le chemin d'origine : 40 étapes à cfg 4.
- Looks : INFL8 (« inflate the … ») et ACTION (« action the … ») ont chacun un template officiel en nodes du cœur (`image-qwen_image_edit_2511_lora_inflation`, `template_qwen_image_edit_2511_systms_action`) ; les workflows de leurs auteurs utilisent des nodes tiers, dont seuls les réglages sont repris. Le look « angles » de fal commence l'instruction par `<sks>`, que le template officiel `template_qwen_multiangle` oublie, à la force 0,9 que conseille sa carte.

### Pack d'effets : Wan 2.1 I2V 480p et LoRA de Remade-AI, nodes du cœur

- Template `templates/image_to_video_wan.json` (100 % cœur) : `UNETLoader`, `CLIPLoader` (type `wan`), `VAELoader`, `CLIPVisionLoader`, `CLIPVisionEncode` (crop `none`), `LoadImage`, deux `CLIPTextEncode`, `WanImageToVideo` (`comfy_extras/nodes_wan.py:18`), `ModelSamplingSD3`, `KSampler`, `VAEDecode`, `CreateVideo`, `SaveVideo`. Ajouts : la LoRA de l'effet (200), puis celle de lightx2v (201), deux `LoraLoaderModelOnly` entre le modèle et `ModelSamplingSD3`.
- Réglages des cartes de Remade : force 1, cfg 6, flow shift 5, 20 étapes, 81 images à 16 fps, 832×480. Par défaut, la LoRA 4 étapes : 4 étapes à cfg 1 (euler). `fast: false` retire la LoRA et revient aux 20 étapes à cfg 6.
- Les effets sont des presets `montagio/preset@0.1` d'un nouveau type, `capability: i2v-effect`, rangés dans `presets/effects/` : la LoRA (une entrée du lock), son déclencheur en leetspeak (`sq41sh squish effect`, `c4k3 cakeify it`…) et un gabarit de prompt où `{subject}` reçoit ce que montre la photo. Le schéma refuse un gabarit sans déclencheur ou sans `{subject}`. Ni le Studio, ni le pack de nodes, ni `compileJob` ne les voient.

### Transitions par images clés : Wan 2.2 FLF2V, nodes du cœur

- Template `templates/video_wan2_2_14B_flf2v.json` (cœur), chemin 4 étapes : les deux experts (haut et bas bruit) avec leur LoRA lightx2v, deux `KSamplerAdvanced` coupés à l'étape 2, shift 5. Le chemin 20 étapes du template (cfg 4, coupure à l'étape 10, shift 8) est celui de `fast: false`. Dans le groupe 4 étapes du template, les images de début et de fin sont inversées : corrigé.
- `WanFirstLastFrameToVideo` (`comfy_extras/nodes_wan.py:188`) : une longueur de 4n+1 images ; les deux images sont recadrées au centre à la taille demandée ; Wan 2.2 n'a pas besoin de CLIP vision.
- Les hooks sont des presets `capability: i2v-transition`, rangés dans `presets/transitions/` : l'instruction d'édition qui fait l'image finale, un look éventuel, une seconde image pour Outfit Morph, et le mouvement entre les deux images. Un hook fait deux jobs : l'édition, puis la transition de la photo vers la sortie de l'édition.
- Earth Zoom Out n'est pas dans cette branche. Le template `templates-6-key-frames` enchaîne cinq FLF2V par sous-graphes et les assemble avec `BatchImagesNode` (cœur), sans retirer les images de jonction, et l'enregistre à 24 fps alors que Wan 2.2 14B est à 16 fps.

### Voix de l'avatar : Chatterbox Multilingual V3, un node tiers épinglé et patché

- **Pas de node de cœur.** ComfyUI v0.41.0 n'a pas de synthèse vocale locale ; ses seuls nodes TTS sont des nodes partenaires (ElevenLabs, FishAudio, HeyGen), exclus.
- **Qwen3-TTS écarté, faute de node sûr.** Le modèle est Apache-2.0 et parle français, mais :
  - `flybirdxx/ComfyUI-Qwen-TTS` n'a pas de fichier LICENSE et modifie `transformers` pour tout le processus ;
  - le paquet officiel `qwen-tts` épingle `transformers==4.57.3`, alors que ComfyUI v0.41.0 tourne avec la 5.20.1 ;
  - `1038lab/ComfyUI-QwenTTS` (GPL-3.0) est ancien et probablement cassé sous transformers 5 ; les autres n'ont pas de LICENSE ou tirent trop de dépendances.
- **Retenu : [wildminder/ComfyUI-Chatterbox](https://github.com/wildminder/ComfyUI-Chatterbox) au commit `4597af8f`** (Apache-2.0, code chatterbox MIT), après un audit ligne à ligne : poids en safetensors, `.pt` chargés en `weights_only=True`, ni `eval`, ni sous-processus, ni télémétrie. Trois mesures, appliquées par `infra/runpod/bootstrap.sh` :
  - un patch d'un bloc retire ses 7 routes `/chatterbox/*`, dont `register_model_path` et `validate_directory`, qui acceptent n'importe quel chemin absolu (sonde du disque, authentification SMB sortante sur Windows, substitution de voix) ;
  - ComfyUI tourne avec `HF_HUB_OFFLINE=1` : sinon un fichier manquant fait télécharger tout le dépôt (13,9 Go) ;
  - ses 5 paquets Python sont installés en `--no-deps --require-hashes` (`infra/runpod/requirements-chatterbox.txt`) ; jamais ses extras (`spacy-pkuseg` télécharge depuis GitHub, `pykakasi` est GPL).
- **Choix de la v0.1 :** la voix intégrée (anglaise), sans clonage ; en français, `cfg_weight` 0, comme le conseille la carte du modèle. Pas de voix clonée, donc pas de consentement à recueillir, et pas de voix restée dans le cache du node pour le rendu suivant.
- **Fixture :** la classe `ChatterboxMTLTTS` est écrite d'après `nodes/mtl_node.py` au commit épinglé (aucun ComfyUI local n'a ce node) ; la S2 la régénère depuis le `/object_info` du pod.
- **Installeur local :** il laisse l'avatar de côté, avec un message, tant qu'il n'installe pas ce node.

### Avatar parlant : Wan 2.2 S2V, nodes du cœur

- **Choix de l'utilisateur le 19/10**, au lieu d'InfiniteTalk (partie 1 pour la licence de son encodeur, partie 4 pour sa mémoire).
- Template `templates/video_wan2_2_14B_s2v.json`, chemin actif « 4 étapes ». Nodes : `UNETLoader`, `LoraLoaderModelOnly`, `ModelSamplingSD3` (shift 8), `CLIPLoader`, `CLIPTextEncode`, `VAELoader`, `LoadImage`, `LoadAudio`, `AudioEncoderLoader` et `AudioEncoderEncode` (`comfy_extras/nodes_audio_encoder.py`), `WanSoundImageToVideo` et `WanSoundImageToVideoExtend` (`comfy_extras/nodes_wan.py:956` et `:989`), `KSampler` (4 étapes, cfg 1, uni_pc), `LatentConcat`, `LatentCut`, `VAEDecode`, `ImageFromBatch`, `CreateVideo`, `SaveVideo`. ComfyUI v0.41.0 reconnaît S2V (`comfy/model_detection.py:775`).
- **Morceaux.** Un passage rend 77 images et couvre 5,0 s d'audio (16 fps). Une extension lit le latent **cumulé** : sa longueur fixe le décalage de l'audio (`nodes_wan.py:1018`). Le template officiel est câblé ainsi ; celui d'InfiniteTalk, lui, rejouerait la même fenêtre audio dès le troisième morceau. Le compilateur garde 1, 2 ou 3 morceaux selon la durée de la parole (15 s au plus).
- **Ce que l'avatar n'est pas.** La vidéo est conditionnée par l'identité de la photo, elle ne commence pas sur ses pixels ; `ref_motion` (photo en guise de mouvement passé) est un essai de la S2. Sortie en 16 fps.
- **Chaîne complète.** Job « voix » (texte → FLAC), puis job « avatar » (photo + FLAC → MP4 avec la parole). L'appelant lit la durée du FLAC (`probeAudio`) avant de compiler le second job.

### Validation par un vrai ComfyUI v0.41.0, sans rendu

Sur le ComfyUI CPU de l'analyse S1 (`../comfyui-cpu-v0.41.0`, 679 classes, 0 node partenaire), avec des fichiers de modèle **vides** aux noms du lock, chaque workflow compilé est passé par `POST /prompt`, suivi aussitôt de `/interrupt` et d'un vidage de la file. Premier passage : musique, upscale (16:9), édition et avatar en 1, 2 et 3 morceaux sont **acceptés**. Second passage, après la réorientation : 20 workflows compilés par le smoke (édition rapide et qualité, les 6 effets en 4 étapes et un en 20, les 4 hooks et leurs transitions en 4 et en 20 étapes, avatar, musique, upscale) sont **acceptés**, sans aucune `node_errors`. Rien n'a été rendu : les loaders s'arrêtent sur les fichiers vides (« header too small »).

Deux constats en chemin :
- le venv CPU n'avait pas `kornia`, une dépendance de ComfyUI v0.41.0 : sans lui, `LatentConcat`, `LatentCut` et `ResizeImageMaskNode` ne se chargent pas. Il a été ajouté à ce venv ; le pod installe le `requirements.txt` de ComfyUI en entier ;
- `checkWorkflow` refusait le type « MatchType » de l'API V3 ; il l'accepte désormais, comme ComfyUI.

La voix n'est **pas** validée ici : son node n'est pas installé sur ce ComfyUI. Sa fixture est écrite d'après la source, et la S2 la valide sur le pod.

## 3. Poids

Tailles et sha256 lus dans l'API Hugging Face (`paths-info`, sha256 = `lfs.oid`), recoupés par `fetch-weights --lock-from-hf`, dont le patch est vide. Chaque entrée du lock porte `extension:` : l'installeur local ne la télécharge que pour son extension.

| Extension | Entrée du lock | Fichier | Taille | sha256 |
|---|---|---|---|---|
| Musique | `ace-step15-turbo` | `acestep_v1.5_turbo.safetensors` (identique à l'original d'ACE-Step) | 4 787 825 604 | `3f6e0797…` |
| Musique | `qwen3-embedding-06b-ace15` | `qwen_0.6b_ace15.safetensors` | 1 191 588 248 | `fd4590c8…` |
| Musique | `ace-step15-lm-17b` | `qwen_1.7b_ace15.safetensors` | 3 708 523 360 | `ed63e924…` |
| Musique | `ace-step15-vae` | `ace_1.5_vae.safetensors` | 337 431 732 | `6de92e3a…` |
| Upscale | `seedvr2-3b-int8` | `seedvr2_3b_int8_convrot.safetensors` (conversion Comfy-Org des `.pth` fp32 de ByteDance) | 3 458 259 704 | `c3dec8bc…` |
| Upscale | `seedvr2-vae` | `seedvr2_ema_vae_fp16.safetensors` | 501 324 814 | `20678548…` |
| Édition | `qwen-image-edit-2511-fp8mixed` | `qwen_image_edit_2511_fp8mixed.safetensors` (quantification Comfy-Org) | 20 533 762 817 | `c9fdc158…` |
| Édition | `qwen25-vl-7b-fp8` | `qwen_2.5_vl_7b_fp8_scaled.safetensors`, chez `Comfy-Org/Qwen-Image_ComfyUI` | 9 384 670 680 | `cb5636d8…` |
| Édition | `qwen-image-vae` | `qwen_image_vae.safetensors` | 253 806 246 | `a70580f0…` |
| Édition | `qwen-edit-2511-lightning-4step` | `Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors` | 849 608 296 | `22226e8d…` |
| Édition | `systms-infl8-qwen-edit-2511` | `SYSTMS_INFL8_LoRA_Qwen_Image_Edit_2511.safetensors` | 295 146 200 | `48cff149…` |
| Édition | `systms-action-qwen-edit-2511` | `QWEN_EDIT_ACTION_V1.safetensors` | 295 146 192 | `52287ccc…` |
| Édition | `fal-multiple-angles-qwen-edit-2511` | `qwen-image-edit-2511-multiple-angles-lora.safetensors` | 295 140 688 | `42426ded…` |
| Voix | `chatterbox-t3-mtl-v3` | `t3_mtl23ls_v3.safetensors` | 2 143 989 928 | `5abca832…` |
| Voix | `chatterbox-s3gen` | `s3gen.safetensors` | 1 056 484 620 | `2b78103c…` |
| Voix | `chatterbox-ve` | `ve.safetensors` | 5 695 784 | `f0921cab…` |
| Voix | `chatterbox-conds` | `conds.pt` (voix intégrée) | 107 374 | `6552d705…` |
| Voix | `chatterbox-grapheme-mtl` | `grapheme_mtl_merged_expanded_v1.json` (tokenizer, hors LFS) | 69 989 | `69632f47…`, SHA-1 git `d27fb3f2…` |
| Avatar | `wan22-s2v-14b-fp8` | `wan2.2_s2v_14B_fp8_scaled.safetensors` (quantification Comfy-Org) | 16 394 832 474 | `140e75af…` |
| Avatar | `wav2vec2-large-xlsr53-en` | `wav2vec2_large_english_fp16.safetensors` (conversion fp16 Comfy-Org) | 630 997 322 | `f0017a43…` |
| Avatar | `lightx2v-wan22-t2v-4step-high-v1-1` | `wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors` (identique à lightx2v/Wan2.2-Lightning) | 1 226 977 424 | `698321cb…` |
| Effets | `wan21-i2v-480p-14b-fp8` | `wan2.1_i2v_480p_14B_fp8_scaled.safetensors` (quantification Comfy-Org) | 16 401 356 938 | `b2de21b9…` |
| Effets | `clip-vision-h` | `clip_vision_h.safetensors` | 1 264 219 396 | `64a7ef76…` |
| Effets | `lightx2v-wan21-i2v-480p-4step` | `Wan21_I2V_14B_lightx2v_cfg_step_distill_lora_rank64.safetensors` | 739 472 104 | `8833bd4f…` |
| Effets | `remade-squish`, `-cakeify`, `-explode`, `-crash-zoom-in`, `-matrix-shot`, `-360-orbit` | une LoRA de 359 257 680 octets chacune | 6 × 359 257 680 | `c2195da8…`, `4078cd32…`, `040dfee5…`, `bcc26f0e…`, `9e9b4952…`, `5a99f1fd…` |
| Transitions | `wan22-i2v-high-fp8`, `wan22-i2v-low-fp8` | `wan2.2_i2v_{high,low}_noise_14B_fp8_scaled.safetensors` | 2 × 14 294 742 832 | `6122e79d…`, `5471a457…` |
| Transitions | `lightx2v-wan22-i2v-4step-high`, `-low` | `wan2.2_i2v_lightx2v_4steps_lora_v1_{high,low}_noise.safetensors` (identiques à lightx2v/Wan2.2-Lightning) | 2 × 1 226 977 424 | `d176c808…`, `024f21de…` |

L'avatar, les effets et les transitions réutilisent aussi `umt5-xxl-fp8` et `wan21-vae`, déjà au lock pour les presets (même sha256) et donc sans marque `extension`. Les LoRA posées à la racine de leur dépôt portent `folder: loras` au lock, pour que l'installeur sache où les ranger.

Édition : 31,9 Go (le bf16, 40,9 Go, n'est pas retenu). Effets : 20,6 Go. Transitions : 31,0 Go. Avatar : 18,25 Go, plus la voix, 3,2 Go, dans le dossier `models/tts/chatterbox/resembleai-mtl-v3` que le lock nomme (`folder:`). Musique : 10,0 Go. Upscale : 3,96 Go. Au total, le lock compte 43 fichiers et 188,6 Go (175,7 Gio), dont 69,7 Go pour les presets ; `fetch-weights --lock-from-hf` en redonne un patch vide.

Le tokenizer de la voix est un petit fichier que Hugging Face garde hors LFS : l'API ne publie que son identifiant git (SHA-1). Son sha256 a été calculé sur le fichier (70 Ko, pas un poids). Le lock porte les deux ; `fetch-weights` compare l'identifiant git avant le téléchargement, puis le sha256 après.

## 4. VRAM et temps sur une RTX 4090 (24 Go)

Ce sont des **estimations**, tirées de la taille des poids et des formules de mémoire du code de ComfyUI v0.41.0. La S2 les mesure.

- **Musique.** DiT 4,8 Go, encodeurs 4,9 Go, VAE 0,3 Go ; le décodage d'un morceau de 60 s demande ≈ 5,7 Gio (`comfy/sd.py:729`). Tout résident, le pic est ≈ 16 Go : **tient**. Le LM tourne sans vLLM : ≈ 3 à 10 s à chaud pour 60 s de musique, plus le chargement. Après un rendu Wan 14B, ComfyUI ne décharge que ce qu'il faut (`comfy/model_management.py:893-1039`) ; le rendu Wan suivant recharge ses poids.
- **Upscale.** Poids 3,2 Gio en int8. Par morceau de 9 latents en 1080p, la loi mesurée par ComfyUI (`comfy/ldm/seedvr/constants.py:3-11`, sur une RTX 5090) donne ≈ 10,3 Gio d'activations, soit un pic de ≈ 18–19 Gio : **tient**. Sans découpage, non (≈ 35 Gio). Le 7B int8 serait à la limite, le 7B fp16 ne tient pas. Temps : ≈ 2 à 4 min pour un clip de 81 images, ≈ 3 à 6 min pour 121. L'int8 est plus rapide avec torch cu130 (le pod) ; sur le repli cu128, le noyau CUDA de comfy-kitchen est coupé (`comfy/quant_ops.py:23-29`).
- **Édition.** Le modèle fp8mixed fait 19,1 Gio, l'encodeur de texte 8,7 Gio. ComfyUI encode le texte, puis décharge l'encodeur quand le DiT a besoin de place (chargement partiel, `comfy/model_management.py:939`). Avec 1 à 3 Gio d'activations à ≈ 1 Mpx, cela **tient de justesse** : le même DiT en fp8, en texte vers image, occupe 86 % d'une RTX 4090D d'après la doc de ComfyUI. Le bf16 (38 Gio) ne tient pas. Les LoRA ajoutent 0,8 Gio (Lightning) et 0,3 Gio (un look). Temps : ≈ 15 à 25 s par image en 4 étapes (6,1 s mesurées par un tiers sur une RTX 5090), ≈ 100 à 130 s en 40 étapes. Prévoir 32 Go de RAM au moins, 64 Go de préférence.
- **Voix.** Chatterbox V3 : ≈ 2,5 à 3,5 Go, ≈ 7 à 12 s à chaud pour 15 s de parole, plus 10 à 30 s de chargement. Le node passe par la gestion mémoire de ComfyUI : le job vidéo qui suit peut l'évincer de la VRAM.
- **Avatar.** Wan 2.2 S2V en fp8 : 16,4 Go de poids résidents (l'injecteur audio est dans ce fichier), plus ≈ 2,5 Go d'activations à 832×480 et cfg 1 : **tient** (≈ 20,5 Go). À cfg 6 (20 étapes, sans LoRA), ≈ 23 Go : à la limite. Temps avec la LoRA 4 étapes : ≈ 3 à 6 min pour 5 s, ≈ 7 à 11 min pour 15 s, chargement compris ; sans elle, ≈ 50 à 80 min pour 15 s. InfiniteTalk, écarté, aurait demandé 21,5 Go résidents (UNet fp8 et patch de 5,1 Go) avant les activations : il ne tenait pas sans déchargement partiel, et il fallait 6 morceaux pour 15 s (13 à 24 min estimées).
- **Effets.** Wan 2.1 I2V 14B en fp8 : 15,3 Gio, plus `clip_vision_h` (1,2 Gio) et les deux LoRA (0,3 et 0,7 Gio) ; l'encodeur umt5 (6,3 Gio) est déchargé après l'encodage. Avec ≈ 2,5 Gio d'activations à 832×480 et 81 images, le pic est ≈ 20 Gio : **tient**. Temps : ≈ 1 à 2 min par effet en 4 étapes, ≈ 8 min en 20.
- **Transitions.** Deux experts de 13,3 Gio chacun, chargés l'un après l'autre comme ceux de Fun Camera : **tient**. La doc de ComfyUI mesure 71 s à chaud et 108 s à froid pour ce modèle en 4 étapes à 640×640 sur une RTX 4090D ; ≈ 9 min en 20 étapes. Un hook enchaîne l'édition et la transition, deux familles de modèles : chaque changement recharge des poids (≈ 37 s d'écart entre froid et chaud). En S2, il faut grouper les jobs par modèle.

## 5. Contrat backend et drapeau de coupe

Rien n'est branché dans l'interface (`apps/web` n'a pas changé). Ce qui existe côté serveur et outils :

**Registre.**
- `registry/extensions/*.yaml` (schéma `montagio/extension-model@0.1`, `packages/registry/src/extensions.ts`) : la tâche (`i2i-edit`, `i2v-effect`, `flf2v`, `tts`, `ia2v-talk`, `t2a`, `v2v-upscale`), les poids, le workflow, des bindings qui peuvent viser plusieurs entrées, le node de sortie et son type (`audio`, `video` ou `image`), les limites et une estimation du temps de GPU. Ces modèles sont **à part** de `registry/models/` : le Studio, la vitrine et `compileJob` ne les voient pas.
- `registry/extensions.yaml` : les 6 extensions, leur priorité, ce qu'elles exigent (`requires: [edit]` pour les transitions) et la date de leur validation sur GPU (`gpu_validated`, `null` pour l'instant).
- Le lock : `extension:` sur les poids d'une seule extension ; `folder:` quand l'URL ne donne pas le dossier (la voix, les LoRA à la racine de leur dépôt) ; `git_sha1:` pour un petit fichier hors LFS.
- La bibliothèque (`loadLibrary`) charge `extensionModels`, `extensionTemplates` et `extensions`, et refuse une marque `extension:` qui ne correspond pas à qui charge le poids.
- Les presets d'un nouveau type : `presets/effects/*.yaml` (`capability: i2v-effect`) et `presets/transitions/*.yaml` (`capability: i2v-transition`), chargés dans `effects` et `hooks`, à part de `presets` : le type `Preset` des presets caméra ne change pas. La bibliothèque vérifie qu'un effet nomme une LoRA de son modèle, et qu'un hook vise un modèle `flf2v` et a un modèle d'édition pour son image finale.
- `check-open-stack` vérifie le dépôt d'origine de chaque poids (`allowed-sources.yaml`, partie 1).

**Compilateurs** (`packages/presets/src/{extensions,effects,transitions}.ts`) :

| Fonction | Entrées | Sortie |
|---|---|---|
| `compileMusic` | description, durée du film, seed, tempo (90 par défaut) | FLAC, node 107 |
| `compileUpscale` | clip, aspect, seed, nombre d'images (121 au plus) | MP4 1080p, node 76 |
| `compileEdit` | photo, instruction (500 caractères au plus), seed, `fast` (Lightning, par défaut), look, seconde image ; le lock (fichier du look) | PNG ≈ 1 Mpx, node 9 |
| `compileEffect` | preset d'effet, photo, sujet (120 caractères au plus), aspect, seed, `fast` ; le lock | MP4 480p 16 fps, 5 s, node 56 |
| `compileTransition` | image de début, image de fin, mouvement (300 caractères au plus), aspect, durée (2 à 5 s), seed, `fast` | MP4 480p 16 fps, node 61 |
| `compileHookEdit`, `compileHookTransition` | un hook : son édition (avec la seconde image s'il en exige une), puis sa transition vers la sortie de l'édition | PNG, puis MP4 |
| `compileSpeech` | texte (300 caractères au plus), langue `en` ou `fr`, seed | FLAC, node 3 |
| `compileAvatar` | photo, parole et sa durée (1 à 15 s), aspect, seed, prompt facultatif | MP4 480p 16 fps avec la parole, node 113 |

Chacune rend `{ workflow, output: { kind, node }, params }` et lève `CompileError` avant tout envoi au GPU.

**Adaptateur** (`@montagio/comfy-adapter`, aussi sur la branche `feat/adapter-outputs`) : `SubmitJob.output` (`video` par défaut, `audio`, `image`) et `outputNode` ; `get(id, want?)` pour un job soumis avant un redémarrage de l'app. La sortie est choisie par le type que donne le proxy pour l'audio et l'image, et par son type MIME pour la vidéo : comfy-api-proxy 0.1.6 range le MP4 de `SaveVideo` sous le type `image`, comme ComfyUI.

**Montage** (`@montagio/sequence`) : `mixMusic(film, musique, sortie)` garde chaque image et la durée exacte du film ; `exportVertical` garde la musique dans la coupe 9:16 ; `probeAudio` lit la durée d'une parole.

**Installation.**
- `fetch-weights --extensions` prend tout par défaut (sessions GPU).
- L'installeur local lit `--extensions`, puis `MONTAGIO_EXTENSIONS`, puis `validated`. Il laisse l'avatar de côté, dont il n'installe pas encore la voix.
- `infra/runpod/bootstrap.sh` installe le node de la voix, épinglé et patché.
- `smoke.ts --extension …` fait tourner chaque extension en S2 : `effect` (tous les effets, ou `--effect squish,explode`), `hook` (l'édition puis la transition, `--hook`, `--input2`), `--quality` pour les repasses sans distillation.

**Drapeau de coupe.** `enabledExtensions(config, MONTAGIO_EXTENSIONS)` (registre) et son double sans dépendance dans l'installeur (test de parité) :
- non défini ou `validated` : seules les extensions datées dans `registry/extensions.yaml` ;
- `all` ou `none` ;
- une liste comme `edit,transitions`, qui doit nommer ce que chaque extension exige (`transitions` seule est refusée, avec le message qui dit d'ajouter `edit`) ; en mode `validated`, une extension dont une exigence n'est pas datée reste masquée.

Pour la règle du 25/10 au soir, il suffit de dater `gpu_validated` des extensions validées en S2 ou en S3 : les autres restent masquées par défaut, dans l'app (lors du branchement) comme dans l'installeur. `MONTAGIO_EXTENSIONS=all` les montre toutes, en développement.

## 6. Risques et verdicts

| Extension | Verdict avant la S2 | Ce qui peut la faire couper |
|---|---|---|
| 1. Édition | **prête** | la VRAM juste (19,1 Gio de poids en fp8, encodeur déchargé) ; la Lightning qui abîme une instruction fine ; les looks sur des photos réelles ; 32 Go à télécharger ; le recadrage de 4 % |
| 2. Effets | **prêts sur le papier** | des LoRA entraînées sur Wan 2.1 480p, à vérifier sur le fp8 ; les 4 étapes qui écrasent les grands mouvements (explosion, crash zoom, que la carte de Lightning signale) ; le format de clés de la LoRA lightx2v ; la preuve de licence faible des LoRA de Remade |
| 3. Transitions | **risquées** | aucune preuve publique qu'Eyes In ou Outfit Morph par images clés vaut une LoRA dédiée ; deux familles de modèles par hook, donc des rechargements ; 31 Go de plus |
| 4. Avatar | **risquée** | la LoRA 4 étapes, faite pour le texte vers vidéo et pas pour S2V (perte de dynamique, pas de guidage audio à cfg 1), sans laquelle il faut une heure pour 15 s ; la vidéo ne part pas de la photo ; le français, non documenté ; la voix, un node tiers patché, `torchaudio` 2.11 sur torch 2.14.1, une voix intégrée anglaise ; 16 fps |
| 5. Musique | **prête** | des voix malgré `[Instrumental]` ; la qualité d'un morceau de 10 s coupé à 5 ; un LM lent sans vLLM ; un VAE fp16 qui sature |
| 6. Upscale HD | **prête, premier candidat à la coupe** | aucun lien avec la viralité ; ≈ 6 à 9 min pour 10 s ; une sur-netteté sur des clips IA, que le README de SeedVR2 signale (à comparer à un simple lanczos) ; des coutures entre morceaux ; l'int8 lent sur le repli cu128 ; 10 à 18 Go de RAM hôte |

Aucune extension n'est « à couper » sans GPU : licences acceptées (celle des effets avec une preuve faible, écrite), nodes du cœur (sauf la voix), workflows validés par un vrai ComfyUI (sauf la voix), et chacune tient en 24 Go sur le papier. La règle du 25/10 tranchera sur les mesures de la S2 et de la S3 ; si la S2 déborde, l'upscale sort en premier.

## 7. À vérifier en S2

Dans l'ordre de priorité. Les commandes sont dans [S2_CHECKLIST.md](S2_CHECKLIST.md), partie 6.8.

1. **Édition** : « loaded completely » ou « partially » dans le journal ; temps en 4 étapes (Lightning) et en 40 ; une instruction en français ; les looks INFL8 et ACTION sur une photo ; recadrage contre `ImageScaleToTotalPixels`.
2. **Effets** : les 6 effets sur 3 photos (une personne, un animal, un objet), en 4 étapes ; sujet reconnaissable et effet lisible dès la première seconde ; aucun avertissement `lora key not loaded` (LoRA lightx2v) ; pic de VRAM ; les effets à grand mouvement qui cassent en 4 étapes repassent en 20 en S3.
3. **Transitions** : Eyes In et Outfit Morph de bout en bout (édition, puis transition) ; la continuité entre la photo et l'image finale ; 4 contre 20 étapes ; le temps d'un hook, rechargements compris.
4. **Voix** : `import torchaudio, s3tokenizer` sur torch 2.14.1 ; une génération en anglais et en français (`cfg_weight` 0) ; un texte court sans « hmm » ; aucune connexion sortante avec `HF_HUB_OFFLINE` ; régénérer la fixture `ChatterboxMTLTTS` depuis le `/object_info` du pod.
5. **Avatar** : LoRA 4 étapes contre 20 étapes (synchronisation des lèvres, temps) ; `ImageFromBatch.batch_index` 1, 3 ou 4 ; anglais et français ; `ref_motion` = la photo ; coutures à 5 et 10 s ; pic de VRAM.
6. **Musique**, en fond : temps et VRAM pour 10 et 60 s, juste après un rendu Wan 14B ; aucune voix ; un film de 5 s mixé.
7. **Upscale**, s'il reste du temps : pic de VRAM et temps pour 81 images ; coutures ; comparaison avec un simple lanczos.

En S3 (24-25/10) : les repasses sans distillation, les hooks Figurine et Ignite, Earth Zoom Out en cinq images clés si le temps le permet, puis les clips de la galerie et de la démo.

Puis dater `gpu_validated` dans `registry/extensions.yaml` pour chaque extension validée.

## 8. Mini-plan d'intégration dans l'interface

À faire **après** la fusion de `feat/design-polish` et de `feat/t2i-history` (sessions « finition du design » et « texte → image et historique »), dans l'ordre des priorités : édition, effets, hooks, avatar, musique, upscale. Rien n'est écrit ici.

**Serveur** (`apps/web/src/server/extensions.ts`, nouveau). Un job d'extension suit le modèle de `generations.ts` :
- idempotence (même fenêtre de 10 min) ;
- enregistrement dans `data/` ;
- `SubmitJob` avec `output` et `outputNode` ;
- `get(id, want)` après un redémarrage ;
- sortie copiée avec la mention « AI-generated » (MP4 : `tagClip`).

La lecture du drapeau passe par `enabledExtensions(lib.extensions, process.env.MONTAGIO_EXTENSIONS)`. Une extension masquée répond 404 `extension-disabled`.

En mode local, le drapeau ne suffit pas : l'installeur laisse l'avatar de côté (il n'installe pas le node de la voix), et le pod peut avoir sauté ce node (`install_voice_node` avertit sans arrêter). Le serveur masque donc aussi une extension dont un node manque au `/object_info` du ComfyUI (pour l'avatar, `ChatterboxMTLTTS`), lu au démarrage et à chaque reconnexion. Sinon, une fois l'avatar daté en S2, une installation locale par défaut montrerait l'onglet « Avatar » et chaque clic finirait en `workflow-rejected`.

**Routes API** :

| Route | Rôle |
|---|---|
| `GET /api/extensions` | les extensions montrées, avec leurs limites et estimations |
| `POST /api/sequences/[id]/music` (`prompt`, `bpm`) | musique du film : job `t2a`, puis `mixMusic` et `exportVertical` ; le film et sa coupe 9:16 gagnent la musique |
| `POST /api/generations/[id]/upscale` | clip terminé → 1080p |
| `POST /api/edits` (`imageRef`, `instruction`) | photo éditée, enregistrée comme un nouvel envoi (`imageRef`) et utilisable comme photo de départ |
| `POST /api/effects` (`imageRef`, `effectId`, `subject`) | un effet du pack sur la photo ; `GET /api/effects` les liste, avec leur aperçu |
| `POST /api/hooks` (`imageRef`, `hookId`, `image2Ref` pour Outfit Morph) | job d'édition, puis job de transition sur sa sortie ; `GET /api/hooks` les liste |
| `POST /api/avatars` (`imageRef`, `text`, `language`) | job voix, puis job avatar sur la durée lue par `probeAudio` |
| `GET /api/extensions/jobs/[id]`, `POST …/cancel` | état et annulation |

Codes d'erreur stables, comme l'existant : `extension-disabled`, `invalid-input` (le message de `CompileError` reste dans le journal), `backend-unavailable`, `workflow-rejected`, `ffmpeg-missing`.

**Écrans.**
- Séquence terminée : « Ajouter une musique » (description, tempo), puis le film et la coupe 9:16 avec la musique, et un lecteur.
- Clip terminé : « HD 1080p ».
- Photo de départ : « Modifier la photo » (instruction), avec aperçu avant/après et « Utiliser cette photo ».
- Galerie « Effets » : 6 cartes avec leur aperçu ; un champ « Ce que montre la photo » (le sujet), prérempli.
- Galerie « Hooks » : Eyes In et Outfit Morph (avec « Ajouter la tenue », une seconde photo), puis Figurine et Ignite après la S3 ; l'image finale s'affiche avant la vidéo.
- Onglet « Avatar » : photo, texte (300 caractères, avec un compteur), langue EN/FR, et la durée estimée.
- Chaque bouton disparaît quand son extension est masquée.

**Textes EN et FR.** Un seul bloc de clés i18n, à regrouper avec la session « texte → image » pour limiter les conflits : `ext.edit.*`, `ext.effects.*`, `ext.hooks.*`, `ext.avatar.*`, `ext.music.*`, `ext.upscale.*`, `ext.errors.*`. Chaque libellé dit ce qui sort (« Vidéo générée par IA »). Les noms d'effets restent ceux des presets (Squish, Cake-ify…), les déclencheurs en leetspeak n'apparaissent jamais.

**Garde-fous retenus par l'utilisateur le 19/10** (proposés, pas imposés : le filtre SFW a été retiré de la v0.1) :
- une case de consentement, « Je suis la personne sur la photo ou j'ai son accord », avant l'avatar, et avant une édition, un effet ou un hook sur une photo de personne ; sans elle, le serveur répond 400 `consent-required` ;
- une liste de blocage de noms de célébrités, appliquée aux instructions d'édition, aux sujets des effets et aux textes de l'avatar, côté serveur (`blocked-name`) ;
- des métadonnées C2PA (`c2pa-python`, Apache-2.0) sur chaque sortie, en plus de la mention visible « AI-generated » déjà en place (article 50 de l'AI Act, en vigueur depuis le 2 août 2026).

**Démo et vitrine.**
- Le `DemoBackend` rend des sorties pré-générées par type (un FLAC, un PNG, un MP4), sur le modèle du cas image prévu par la session « texte → image ».
- La vitrine statique masque les extensions, ou montre des exemples rendus en S3.

**e2e.**
- Un parcours par extension en mode démo.
- Le mode local contre le faux proxy, qui rend déjà une sortie audio pour `SaveAudio*` et image pour `SaveImage*` (tâche 1).
- Un test du drapeau : avec `MONTAGIO_EXTENSIONS=none`, aucun bouton d'extension.
- Un seul run complet, à la fin (PC limité).
