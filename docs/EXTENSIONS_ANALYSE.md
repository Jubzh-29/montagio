# Analyse des 4 extensions, sans GPU (19/10/2026)

Le 19/10, l'utilisateur a choisi d'ajouter à Montagio quatre extensions, dans cet ordre de priorité :
1. **Musique des films** : une bande-son instrumentale pour les Séquences (Wan 2.2 est muet), mixée sous le film 16:9 et sa coupe 9:16.
2. **Upscale HD** : un clip terminé passe de 720p à 1080p.
3. **Édition d'image** : la photo de départ est modifiée par une instruction (« fais-en une scène de nuit »).
4. **Avatar parlant** : une photo et un texte donnent une personne qui parle.

Cette analyse suit la méthode de [S1_ANALYSE.md](S1_ANALYSE.md). Aucun poids n'a été téléchargé et rien n'a été rendu. Les seuls accès réseau sont les pages et l'API de Hugging Face, GitHub (sources, templates, licences) et PyPI. Les recherches détaillées, avec chaque source datée, sont dans le dossier de travail de la session ; les faits qui portent une décision sont repris ici.

Règle de coupe décidée le 19/10 : le 25/10 au soir, toute extension non validée sur GPU est masquée de la démo. Le drapeau qui l'applique est décrit en partie 5.

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

### Miroirs Comfy-Org

Les fichiers téléchargés viennent de miroirs Comfy-Org, sauf la voix (dépôt source). Tous déclarent apache-2.0 sans fichier LICENSE : `ace_step_1.5_ComfyUI_files` (`6707deb2`), `SeedVR2` (`df488797`), `Qwen-Image-Edit_ComfyUI` (`f68ace85`), `Qwen-Image_ComfyUI` (`1f12b17b`), `Wan_2.2_ComfyUI_Repackaged` (`ee6f4a40`).

### Points tranchés

- **ACE-Step : MIT, pas Apache-2.0.** Le miroir Comfy-Org déclare apache-2.0, alors que la source est MIT. Le lock suit la source : `license: MIT`. Les deux licences passent la règle.
- **Encodeur de texte de Qwen-Image-Edit : pas le miroir du template.** Le template officiel, la doc et le blueprint de ComfyUI le téléchargent depuis `Comfy-Org/HunyuanVideo_1.5_repackaged` (`1405a2b7`), dont la carte porte la licence « tencent-hunyuan-community ». Celle-ci exclut l'Union européenne, le Royaume-Uni et la Corée du Sud. Le même fichier, au même sha256 (`cb5636d8…`), est dans `Comfy-Org/Qwen-Image_ComfyUI`, sous Apache-2.0 : c'est l'URL du lock. ComfyUI ne lit que le nom du fichier.
- **Avertissement d'usage d'ACE-Step.** Le README GitHub demande d'utiliser le modèle de façon éthique. La phrase n'est ni dans le LICENSE (MIT standard) ni sur les cartes des poids, et n'ajoute aucune clause commerciale, de seuil ou de territoire : informatif.
- **LoRA, deux décisions différentes.** La LoRA Lightning de Qwen-Image-Edit (Apache-2.0) reste hors du lock et hors du workflow jusqu'à la S2, comme LightX2V en S1. Celle de l'avatar entre au lock : sans elle, 15 s de parole demandent plus d'une heure de GPU (partie 4).
- **InfiniteTalk écarté pour l'avatar.** Son encodeur audio, `TencentGameMate/chinese-wav2vec2-base`, n'a qu'une étiquette MIT, sans fichier LICENSE ; son dépôt GitHub n'a aucune licence ; il a été pré-entraîné sur WenetSpeech, distribué pour un usage non commercial. Ses poids passent la règle à la lettre, mais leur provenance est faible. Il ne tient pas non plus en 24 Go (partie 4). L'utilisateur a choisi Wan 2.2 S2V le 19/10.

### Code tiers

| Code | Licence | Note |
|---|---|---|
| [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) au commit `59a3b48b` | MIT (déjà dans [workflows/LICENSE.workflow_templates](../workflows/LICENSE.workflow_templates)) | les 5 nouveaux workflows en sont convertis |
| [wildminder/ComfyUI-Chatterbox](https://github.com/wildminder/ComfyUI-Chatterbox) au commit `4597af8f` (node de la voix) | Apache-2.0 (API GitHub) | sa ligne de copyright est recopiée d'un autre projet, et le pack n'a pas de NOTICE. Le code chatterbox qu'il contient est MIT (Resemble AI), sans son texte de licence. Informatif : à citer dans les notices. Choix du node : partie 2 |

## 2. Nodes et templates

Les quatre workflows partent des templates officiels de [Comfy-Org/workflow_templates](https://github.com/Comfy-Org/workflow_templates) au commit `59a3b48b` (MIT), le même que les workflows des presets. La conversion suit les règles de [workflows/README.md](../workflows/README.md), qui note aussi chaque écart au template. Chaque workflow est accepté par le contrôle hors ligne (`infra/runpod/test/workflows.test.ts`), sur une fixture tirée du vrai `/object_info` de ComfyUI v0.41.0.

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

| Voix | `chatterbox-t3-mtl-v3` | `t3_mtl23ls_v3.safetensors` | 2 143 989 928 | `5abca832…` |
| Voix | `chatterbox-s3gen` | `s3gen.safetensors` | 1 056 484 620 | `2b78103c…` |
| Voix | `chatterbox-ve` | `ve.safetensors` | 5 695 784 | `f0921cab…` |
| Voix | `chatterbox-conds` | `conds.pt` (voix intégrée) | 107 374 | `6552d705…` |
| Voix | `chatterbox-grapheme-mtl` | `grapheme_mtl_merged_expanded_v1.json` (tokenizer, hors LFS) | 69 989 | `69632f47…`, SHA-1 git `d27fb3f2…` |

Musique : 10,0 Go. Upscale : 3,96 Go. Édition : 30,2 Go (le bf16, 40,9 Go, n'est pas retenu). Voix : 3,2 Go, dans le dossier `models/tts/chatterbox/resembleai-mtl-v3` que le lock nomme (`folder:`).

Le tokenizer de la voix est un petit fichier que Hugging Face garde hors LFS : l'API ne publie que son identifiant git (SHA-1). Son sha256 a été calculé sur le fichier (70 Ko, pas un poids). Le lock porte les deux ; `fetch-weights` compare l'identifiant git avant le téléchargement, puis le sha256 après.

## 4. VRAM et temps sur une RTX 4090 (24 Go)

Ce sont des **estimations**, tirées de la taille des poids et des formules de mémoire du code de ComfyUI v0.41.0. La S2 les mesure.

- **Musique.** DiT 4,8 Go, encodeurs 4,9 Go, VAE 0,3 Go ; le décodage d'un morceau de 60 s demande ≈ 5,7 Gio (`comfy/sd.py:729`). Tout résident, le pic est ≈ 16 Go : **tient**. Le LM tourne sans vLLM : ≈ 3 à 10 s à chaud pour 60 s de musique, plus le chargement. Après un rendu Wan 14B, ComfyUI ne décharge que ce qu'il faut (`comfy/model_management.py:893-1039`) ; le rendu Wan suivant recharge ses poids.
- **Upscale.** Poids 3,2 Gio en int8. Par morceau de 9 latents en 1080p, la loi mesurée par ComfyUI (`comfy/ldm/seedvr/constants.py:3-11`, sur une RTX 5090) donne ≈ 10,3 Gio d'activations, soit un pic de ≈ 18–19 Gio : **tient**. Sans découpage, non (≈ 35 Gio). Le 7B int8 serait à la limite, le 7B fp16 ne tient pas. Temps : ≈ 2 à 4 min pour un clip de 81 images, ≈ 3 à 6 min pour 121. L'int8 est plus rapide avec torch cu130 (le pod) ; sur le repli cu128, le noyau CUDA de comfy-kitchen est coupé (`comfy/quant_ops.py:23-29`).
- **Édition.** Le modèle fp8mixed fait 19,1 Gio, l'encodeur de texte 8,7 Gio. ComfyUI encode le texte, puis décharge l'encodeur quand le DiT a besoin de place (chargement partiel, `comfy/model_management.py:939`). Avec 1 à 3 Gio d'activations à ≈ 1 Mpx, cela **tient de justesse** : le même DiT en fp8, en texte vers image, occupe 86 % d'une RTX 4090D d'après la doc de ComfyUI. Le bf16 (38 Gio) ne tient pas. Temps : ≈ 100 à 130 s par image en 40 étapes, ≈ 55 à 75 s en 20 étapes, ≈ 15 à 25 s avec la LoRA 4 étapes (hors lock). Prévoir 32 Go de RAM au moins, 64 Go de préférence.

## 5. Contrat backend et drapeau de coupe

*Complétée par la documentation finale.*

## 6. Risques et verdicts

*Complétée par la documentation finale.*

## 7. À vérifier en S2

*Complétée par la documentation finale.*

## 8. Mini-plan d'intégration dans l'interface

*Complétée par la documentation finale.*
