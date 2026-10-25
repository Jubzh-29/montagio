# Session GPU S2 : résultats (21/10/2026)

Première session GPU de Montagio : avant elle, rien n'avait jamais été rendu. Elle s'est faite sur **Modal**, pas sur un pod Runpod loué. L'utilisateur ne voulait rien louer, et l'offre Starter de Modal inclut 30 $ de calcul par mois. Le GPU est une **L4 de 24 Go**, la mémoire de la RTX 4090 que l'app vise. L'outillage est dans [`infra/modal/`](../infra/modal/README.md), et le déroulé dans la partie Modal de [S2_CHECKLIST.md](S2_CHECKLIST.md).

**Conversion des temps.** Tous les temps ci-dessous sont mesurés sur la L4. Une RTX 4090 va environ **deux fois plus vite**. Deux templates officiels le montrent :
- Fun Camera : 536 s sur une RTX 4090D en 640×640, contre 1 134 s ici en 832×480 ;
- FLF2V : 71 s, contre 134 à 157 s ici.

Les `estimate_s` du registre, exprimés pour une RTX 4090, sont donc les mesures de la L4 divisées par deux.

## 1. Coût et déroulé

| Étape | Durée | Remarque |
|---|---|---|
| Image Modal (installation de `bootstrap.sh` sur une L4) | 6 min 30 | une seule fois ; ensuite en cache |
| Contrôle de la partie 3 | 72 s | |
| Poids des presets (65 Gio), puis ceux des extensions (128 Gio) | ≈ 45 min | sans GPU ; 4 téléchargements en parallèle pour les extensions |
| Rendus : presets, diagnostic, extensions, 5B et 720p | ≈ 5 h de temps réel | jusqu'à 5 conteneurs L4 à la fois |

- **Dépense relevée dans Usage & Billing :** 8,04 $ vers 14 h 25, et **12,94 $ en fin de session** (estimation de départ : 13 à 15 $).
- **Coût d'un clip de 5 s :** environ 0,35 à 0,40 $ en 480p avec Fun Camera, de l'ordre de 0,05 $ pour un effet ou une édition.
- **Préemption :** Modal a préempté un conteneur au milieu d'un rendu. Il relance alors le travail en entier, ce qui aurait fait recalculer les clips déjà finis. D'où la règle retenue : **un clip par conteneur** pour les rendus longs.

## 2. Installation (partie 3)

- `GPU: NVIDIA L4, 23034 MiB, 610.57.04` ; la bannière annonce `CUDA UMD Version: 13.3`. `bootstrap.sh` choisit donc **torch 2.14.1+cu130**, pas le repli cu128.
- **687 classes de nodes chargées, 0 node partenaire**, et aucune ligne `nodes missing`.
- Pack Montagio : `node 5 shows text: 33`, puis `node 8 shows text: 33`. Le test lourd du node passe : **270 tests verts**, aucun ignoré.
- Le node de la voix (Chatterbox, patché) se charge sur torch 2.14.1 : le risque `torchaudio` 2.11 ne s'est pas réalisé.
- Les **45 entrées du lock** sont téléchargées et vérifiées contre leur sha256, sans un échec. Le patch du lock est vide.

## 3. Le premier rendu, et pourquoi il était raté

Premier clip : Crash Push en 480p, avec le workflow officiel (20 étapes, shift 8). Mesures :
- **1 158 s à froid, 1 133 s à chaud** ; le chargement depuis le volume ne coûte qu'environ 25 s ;
- pic de VRAM de **18,4 à 19,5 Go**.

Verdict de l'utilisateur : « dégueulasse ». On y voit une double exposition : le bateau du premier plan devient translucide quand la caméra le traverse.

Le workflow compilé respecte l'échantillonnage du template officiel. Trois écarts restaient pourtant :
- notre texte ne décrivait pas la scène (« dynamic camera push-in, cinematic… ») ;
- le négatif court, en anglais, remplaçait le négatif Wan ;
- la vitesse était de 1,5.

Diagnostic : **4 clips, une seule variable changée par clip**, même photo, même seed.

| Variable changée | Résultat |
|---|---|
| Vitesse 1 au lieu de 1,5 | propre |
| Négatif Wan officiel | toujours fantôme |
| **Description de la scène** avant le texte du preset (vitesse 1,5 gardée) | **propre**, avec l'énergie du crash push |
| Les trois ensemble | propre, presque identique |

**Cause : sans description de ce que montre la photo, le modèle invente au lieu de la suivre.** La vitesse aggrave le défaut ; le négatif ne joue presque pas. Le Studio avait déjà un champ de description (`userPrompt`), mais il était facultatif : un utilisateur aurait obtenu le clip du premier rendu.

**Décision de l'utilisateur (21/10) : la description devient indispensable.** Dans les onglets Caméra et Film, et dans l'éditeur de remix, le champ s'appelle « Ce que montre la photo ». Il est pré-rempli :
- par le texte d'une photo issue du texte → image ;
- par la description de la photo d'exemple ;
- dans la vitrine, par le `prompt` de chaque photo du manifeste.

Une photo envoyée arrive sans description : Générer reste grisé tant que le champ est vide, avec un message sous le bouton. La vitrine compile ses clips avec le texte de leur photo, et la S3 les rend avec `smoke --prompt` ([VITRINE.md](VITRINE.md), partie 6).

## 4. Les presets (12, puis 11)

Tous ont été rendus avec la description de la photo, à la seed 42 : environ 1 110 à 1 170 s chacun sur la L4, avec un pic de 18 à 21 Go.

| Preset | Verdict |
|---|---|
| Crash Push (×1,5) | ✅ ; encore exploitable à ×3, la vitesse maximale pour une avancée |
| Slow Push, Pull Back Reveal, Pan Left, Pan Right | ✅ propres |
| Rise & Push, Drift Left Push, Pull Back & Tilt Up (`together`) | ✅ les deux mouvements se lisent ; léger flou au bord à la fin de Drift Left Push |
| Push & Settle, Breathing (`then`) | ✅ la bascule à mi-clip est nette |
| Tilt Up (Pan Up ×0,8) | ⚠️ presque immobile ; net à ×2 |
| Tilt Down (Pan Down ×0,8, puis ×2) | ❌ presque immobile, même à ×2 |
| Rotation CW ×0,3 (candidat « Dutch ») | ❌ aucun basculement visible |

**Décisions de l'utilisateur :**
- **Tilt Up devient Crane Up**, à la vitesse 2 (la caméra s'élève, elle ne pivote pas) ;
- **Tilt Down est retiré** ;
- **pas de preset Dutch**.

**Constat général :** Fun Camera rend mal les mouvements verticaux et la rotation, et bien les avancées, les reculs et les travellings latéraux.

## 5. Les modèles

| Modèle | 480p | 720p |
|---|---|---|
| Fun Camera 14B (fp8) | 1 133 à 1 158 s, pic 18,4 à 21 Go | **4 331 s** (72 min), pic 21,5 Go : ça tient en mémoire, propre |
| Wan 2.2 5B (mode « Rapide ») | 190 s à froid (121 images à 24 fps), pic 21,2 Go | 508 s, pic 21 Go |
| Z-Image-Turbo (texte → image) | — | 9,1 à 9,6 s à chaud, 45 s à froid, pic 20,4 à 22,3 Go |

- **Fun Camera en 720p** est presque 4 fois plus lent que le 480p. Pour la HD, le 480p suivi de l'upscale SeedVR2 prend environ 565 + 215 s sur une RTX 4090, contre environ 2 165 s en 720p natif : **à proposer plutôt que le 720p**, décision à prendre.
- **5B en 720p :** l'app envoie 720 pixels, un nombre qui n'est pas un multiple de 32. Le bord de l'image reste pourtant intact : pas besoin de dimensions propres au 5B.
- **Z-Image :** le pic de VRAM reste haut, parce que le modèle en bf16 et son encodeur qwen3-4b restent résidents ensemble.

## 6. Les extensions

Les 7 sont **validées** : `gpu_validated: 2026-10-21` dans `registry/extensions.yaml`. Sont datés aussi les 6 effets et le hook Wardrobe Swap.

| Extension | Mesures sur la L4 | Verdict |
|---|---|---|
| Édition (Qwen-Image-Edit-2511) | 4 étapes : 20 à 25 s à chaud, 71 s à froid ; 40 étapes : 306 s ; pic 21,5 à 22,6 Go | ✅ consigne en français suivie ; looks gonflé et figurine nets. Le look « angles » est peu visible, car la photo était déjà de trois quarts : à refaire avec une vue arrière. 0 ligne `lora key not loaded`. Le 4 étapes reste par défaut |
| Effets (6 LoRA de Remade-AI) | 156 s à chaud par effet ; pic 21 à 22,6 Go | ✅ les 6 effets sur une personne, un chien et une voiture, lisibles dès la 1ʳᵉ seconde. 0 ligne `lora key not loaded`. Explode et Snap Zoom tiennent en 4 étapes. Pour la démo, éviter Cake-ify sur un visage |
| Transitions (FLF2V) | 134 à 157 s (4 étapes), 1 084 s (20 étapes), plus l'édition de l'image finale | ✅ **Wardrobe Swap** : image finale exacte, et un gag de « changement express » ; le t-shirt flotte un instant au-dessus de la tête. ❌ **Iris Dive** : un fondu enchaîné en 4 étapes ; en 20 étapes, l'iris pousse d'abord dans la bouche. Laissé sans date, donc masqué |
| Avatar (S2V et voix Chatterbox) | voix : 14 s à froid, 2,5 à 5 s à chaud, 3,3 Go ; avatar : 127 à 145 s pour 3 à 4 s de parole, pic 21,7 Go | ✅ la bouche suit, l'identité est gardée. Seul défaut, « un détail » selon l'utilisateur : la voix intégrée est masculine, même sur un visage féminin. Une autre voix demande un échantillon de référence consenti |
| Musique (ACE-Step 1.5) | 60 s de musique en 9,5 s à chaud, 10 s en 32 s à froid ; pic 10 à 14,6 Go | ✅ aucune voix entendue ; FLAC 48 kHz stéréo, durées exactes |
| Upscale (SeedVR2 3B) | 81 images vers 1080p en 428 s ; pic 18,4 Go | ✅ nettement plus net qu'un lanczos, sans sur-netteté, aucune couture visible |
| Transfert de mouvement (Animate-2 distillé) | 391 à 415 s ; pic 20,1 à 22,2 Go | ✅ sur un personnage en pied, les poses et même l'avancée de caméra sont reproduites, l'identité gardée. Sur une personne en buste, l'échec annoncé par le template (cadrages discordants). L'interface doit demander une photo cadrée comme la vidéo |

## 7. Ce que la session a construit

- Les photos de test sont **générées par Z-Image-Turbo**, avec la nouvelle option `smoke --t2i NOM[@ASPECT]=TEXTE` : une personne fictive, un chien, une voiture, une tenue, un personnage cartoon, un port. Aucune personne réelle, aucun droit à gérer.
- La vidéo de danse du transfert de mouvement vient du **5B**.
- `smoke --prompt` et `smoke --negative wan` ont servi au diagnostic.
- `infra/modal` gagne les fonctions `batch` (un conteneur par job) et `series` (plusieurs jobs dans un conteneur, les modèles chargés une fois).
- La fixture `ChatterboxMTLTTS` est remplacée par le vrai `/object_info` de la L4. Les entrées écrites à la main étaient exactes ; seules manquaient les métadonnées du node. Il faut la capturer **après** le téléchargement des poids de la voix : sinon le node ne propose qu'un pack par défaut (`resembleai_default_voice`).

## 8. Constats techniques à reprendre

1. **Deux sorties par job** pour l'upscale, la voix et le transfert de mouvement. Le proxy rapporte aussi l'aperçu que renvoie un node de chargement ou le node de la voix. Leur ordre change d'un job à l'autre. L'app choisit la bonne grâce à `outputNode`, mais `smoke.ts` les télécharge toutes, et `smoke.jsonl` ne dit pas laquelle est le résultat.
2. **Le champ de description du Studio** (partie 3) : fait le 21/10, il est indispensable et pré-rempli quand le texte de la photo est connu.
3. **Iris Dive** : pour le sauver, une image clé intermédiaire (visage, puis gros plan sur l'œil, puis iris), en S3 ou plus tard.
4. `check-open-stack` sans `--out` ignore le dossier qu'on lui donne et scanne `.` (petit bogue de `tools/check-open-stack/src/cli.ts`).

## 9. Pour la S3 (24–25/10)

- Le budget restant sur les 30 $ du mois : environ 12 $ avant l'arrêt fixé à 25 $, 17 $ avant 30 $. Pour en tirer le plus : rendre en 480p, avec la description de la photo, puis passer les clips choisis à l'upscale 1080p (voir la partie 10).
- Les aperçus des 11 presets (`previews/*.mp4`) et les clips de la vitrine, avec la description de la photo.
- Hooks Figurine et Ignite ; Iris Dive avec une image clé intermédiaire, si le temps le permet.
- Un rendu à refaire : le look « angles » de l'édition, avec une vue arrière.

## 10. Décisions prises après la session (21/10)

Les décisions qui suivent ont été prises pour donner à Montagio les meilleures chances au concours.

- **La HD passe par l'upscale, pas par le 720p.** Le Studio rend déjà en 480p, la résolution des presets : il ne propose pas de 720p. La HD y est le bouton « HD 1080p » (SeedVR2). Cet enchaînement donne du 1080p environ trois fois plus vite qu'un rendu natif en 720p : environ 565 + 215 s sur une RTX 4090, contre environ 2 165 s. Les clips de la vitrine et de la démo (S3) suivent le même chemin.
- **L'installation locale prend par défaut les presets et le pack d'effets**, environ 91 Go de poids :
  - les effets sont l'extension la plus partageable, et l'une des plus légères ;
  - prendre les sept par défaut (environ 185 Go) ferait échouer bien des installations sur le contrôle du disque ;
  - `--extensions all` les prend toutes, `--extensions none` garde les presets seuls ;
  - le défaut respecte la règle de coupe : il ne prend le pack d'effets que si une session GPU l'a validé.
- **La description de la photo** devient indispensable ou pré-remplie dans le Studio : une session y travaille.

## 11. S3 : premiers résultats (21/10)

Avancée au 21/10 au soir, sur la même L4 et les mêmes réglages : 480p et la description de la photo partout.

**Exemples de la vitrine**
- Les **6 effets**, sur la voiture et sur la personne fictive en ciré jaune : tous lisibles. Cake-ify sur la voiture donne des tranches de gâteau propres. Snap Zoom sur la personne finit sur un gros plan net du visage.
- ✅ **Ignite** : les flammes prennent sur la voiture puis l'engloutissent, le cadre ne bouge pas. Le hook est daté (`gpu_validated: 2026-10-21`) : il apparaît sur le mur.
- ❌ **Figurine** : le look ACTION change à peine la personne, et le clip ressemble à la photo de départ. Le hook reste sans date, donc masqué.

**Les 33 clips de la vitrine** (11 presets sur 3 photos)
- Les 33 sont rendus en trois lots : 18, puis 11, puis 4. Ils sont ingérés dans la vitrine avec 12 exemples d'effets (voiture et personne) et Ignite, et `showcase verify --strict` finit sur 0 erreur.
- **Sur la personne**, les 11 presets gardent l'identité, la marche et la pluie ; Crane Up y ressemble plutôt à une avancée.
- **Piège de `batch`** : c'est le PC qui distribue les jobs (`starmap` dans le `local_entrypoint`), même avec `--detach`. Si le client local tombe, Modal annule tous les jobs en cours, et les rendus presque finis sont perdus. Deux causes ont été vues : le jeton qui expire au bout d'environ 2 h (19:38), puis une coupure réseau (22:19). Pour un lot de plus de 2 h, il faudrait que la distribution des jobs se fasse côté Modal.
- **Sur le port**, Crash Push, Slow Push, Push & Settle et Rise & Push dépassent le bateau au lieu de s'arrêter dessus. Crane Up y fait un bateau fantôme.
- **Sur la voiture**, Slow Push, Pull Back Reveal, Pan Left, Pan Right et Crane Up sont nets. Crash Push, lui, fait sortir la voiture du cadre.

**Validation des nouvelles fonctions (22/10, 07:11)**

Une série de 6 jobs dans un seul conteneur L4, pour environ 0,10 $ :

| Job | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|
| Portrait de personnage (Z-Image, 9:16) | 39 s, à froid | 20,3 Go | ✅ conforme au texte |
| Photodump (édition, la personne au café) | 65 s, à froid | 22,2 Go | ✅ même visage, même ciré, nouvelle scène |
| Relight « nuit néon » (voiture) | 20 s | 22,6 Go | ✅ cadrage gardé, lumière changée |
| Inpaint du ciel (port, masque peint) | 20 s | 22,6 Go | ✅ seul le ciel change, le port reste au pixel près |
| Photo HD (SeedVR2 sur une image, 1440×2560) | 14 s, chargement compris | 19,9 Go | ✅ bien plus net qu'un lanczos, identité gardée |
| Voix clonée (échantillon synthétique plus aigu) | 14 s | 7,2 Go | ✅ F0 de 222 Hz, contre 131 Hz pour la voix intégrée |

L'échantillon de voix est la voix intégrée de la S2, montée d'environ 4 demi-tons : aucune vraie personne. Résultats dans `s3/validation/`, hors dépôt.

**Aperçus de la galerie**

Les fichiers `previews/*.mp4` existent désormais : 11 presets, 6 effets, Wardrobe Swap et Ignite, soit 19 fichiers.
- **Format** : H.264 muet, 832×480 (480×832 pour la personne), environ 6 Mo en tout.
- **Choix du clip** : le meilleur de chaque preset entre le port et la voiture. Pour les effets, le chien en peluche de la S2 (Squish, Frozen Moment), la voiture (Explode, Cake-ify) et la personne (Snap Zoom, Full Circle).

## 12. Composition, pub, dessin et changement de voix (22/10)

Une série de 5 jobs dans un seul conteneur L4, le 22/10 à 15:12 : 8 min 24 s, soit environ 0,17 $. La liste des jobs est dans `s3/validation/s5-jobs.txt`, les résultats dans `s3/validation/20261022-131334-s5-validation/`, hors dépôt.

| Job | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|
| Scène de pub, style Lifestyle (la petite voiture, sans personnage) | 78 s, à froid | 22,2 Go | ✅ produit gardé, scène chaude, espace libre en haut ; un autocollant inventé sur la portière |
| Dessin → photo (voiture rouge sur une route côtière) | 21 s | 22,5 Go | ✅ composition, formes et couleurs du dessin gardées |
| Composition à 3 références (port, personne fictive, petite voiture) | 46 s | 22,4 Go | ✅ même visage, le port, la voiture en main ; le t-shirt passe du gris au bleu clair |
| Snap Zoom sur la photo composée | 182 s | 22,4 Go | ✅ finit sur le visage, comme en S2 ; le fond du port devient des vagues |
| Musique de pub (ACE-Step, 10 s) | 33 s | 22,3 Go | ✅ pop acoustique rythmée, sans voix ; les 2,5 dernières secondes sont silencieuses |
| Changement de voix (Chatterbox VC), 1er passage | 2,6 s | 21,2 Go | ❌ arrêt au chargement : il manque `t3_cfg.safetensors` et `tokenizer.json` |
| Changement de voix, rattrapage à 16:17 | 23,6 s, à froid, chargement compris | 4,3 Go | ✅ 3,92 s gardées, F0 de 246 Hz, contre 199 Hz pour la parole source et 235 Hz pour l'échantillon |

- **Changement de voix** : le node `ChatterboxVC` ouvre le pack par le chargeur « classique », qui construit aussi le TTS anglais à côté du convertisseur. Il lui faut donc le T3 anglais et son tokenizer, deux fichiers du même dépôt Resemble AI (MIT, 2,1 Go). Ils sont ajoutés au lock dans le dossier du pack. La voix multilingue de l'avatar n'est pas touchée : elle choisit son T3 par son nom. Le rattrapage a coûté environ 0,08 $ : `weights --extensions avatar` sans GPU (250 s, les deux fichiers téléchargés et vérifiés), puis le seul job sur la L4 (219 s de conteneur). La parole source est la voix intégrée de la S2 ; l'échantillon, cette même voix montée d'environ 4 demi-tons : aucune vraie personne.
- **Définition du node** : la série garde maintenant les `/object_info` des nodes qu'elle emploie (`object_info-extensions.json`). Celle de `ChatterboxVC` est identique, infobulles mises à part, à la fixture écrite d'après le code source épinglé.
- Les photos d'entrée sont fictives : le port et la personne viennent de Z-Image, la petite voiture aussi. Le dessin a été fait pour ce test.

## 13. Mouvement fluide de la passe HD (24/10)

Un job sur une L4 du nouveau compte Modal, le 24/10 à 17:01 : la passe HD avec l'option `--smooth`, sur le Crash Push du port rendu par le pilote du jour (`new--crash-push--landscape-a.mp4` : 832×480, 16 i/s, 81 images, avec description). Environ 9 min de conteneur, soit environ 0,15 $ (estimation ; le chiffre du tableau de bord n'est pas lu). Résultats dans `s3/validation/20261024-150122-smooth-validation/`, hors dépôt.

| Job | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|
| HD 1080p puis RIFE 4.26 ×2 (SeedVR2 3B, puis `FrameInterpolate`) | 410 s, à froid, chargement compris ; RIFE seul : 4,8 s pour les 80 paires | 8,6 Go | ✅ 1920×1080, **32 i/s, 161 images, 5,03 s** (ffprobe) ; images intercalées nettes, sans fantôme sur les mâts ni les façades |

- **Ce qui est ajouté** : deux nodes du cœur de ComfyUI v0.41.0 (`FrameInterpolationModelLoader`, `FrameInterpolate`) et `ComfyMathExpression`, qui double la cadence lue sur le clip. Aucun pack de nodes à épingler, 0 node partenaire sur les 687 chargés.
- **Le poids** : `rife_v4.26.safetensors` de `Comfy-Org/Frame-Interpolation` (22,7 Mo). Ses 158 tenseurs sont ceux du `flownet.pkl` de `RIFEv4.26_0921.zip`, publié par l'auteur sur `hzwer/RIFE`, octet pour octet (sans les têtes d'entraînement `teacher` et `caltime`). Le README de `hzwer/Practical-RIFE` dit que les modèles entraînés sont sous la même licence MIT que le code.
- **Le coût de RIFE est négligeable** : 410 s pour l'ensemble, contre 428 s pour la seule passe HD en S2. Le clip n'est encodé qu'une fois, après RIFE.
- **Définitions des nodes** : celles du GPU (`object_info-extensions.json`) sont identiques, infobulles mises à part, à la fixture capturée sur le ComfyUI CPU.
- La durée passe de 5,06 s à 5,03 s : 161 images à 32 i/s, contre 81 à 16. La dernière image source dure 1/32 s au lieu de 1/16.

## 13. Fonctions finales : espèces, moodboard, palettes, traduction (24/10)

Une série de 5 jobs dans un seul conteneur L4, le 24/10 à 21:40 : 692 s, plus 347 s sans GPU pour télécharger Gemma 4 E4B (8,1 Go, sha256 conforme), soit environ 0,25 $ en tout. La liste des jobs est dans `s3/validation/s6-jobs.txt`, les résultats dans `s3/validation/20261024-194016-s6-validation/`, hors dépôt.

| Job | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|
| 12 portraits d'espèces (Z-Image, 9:16) | 49 s pour le 1er (chargement compris), puis 9 s chacun | 21,1 à 22,3 Go | ✅ 11 sur 12 : chaque espèce reconnaissable, habillée, en pied. La personne montrait de la peau sous une veste ouverte : la vignette reprend le portrait du 22/10, et le prompt demande désormais une tenue sage |
| Moodboard (restyle d'après une planche de 2 images) | 85 s, à froid | 22,4 Go | ❌ composition gardée, mais l'image devient une illustration à rayures sans les tons de la planche |
| Palette prête « bleu-vert et orange » (le port) | 21 s | 22,6 Go | ✅ cadre et bateau intacts, couleurs cinéma |
| Palette d'après une photo (le port, avec une photo néon) | 33 s | 22,6 Go | ❌ l'édition recopie le contenu de la 2e image au lieu de ses seules couleurs |
| Traduction en espagnol (Gemma 4, puis Chatterbox) | 49 s, à froid | 20,2 Go | ❌ le texte dit est la transcription française, pas sa traduction |
| Avatar sur la parole produite (S2V) | 284 s, à froid | 22,2 Go | ✅ l'avatar parle et les lèvres suivent la parole donnée |
| Traduction en espagnol, deux passes (rattrapage du 25/10, 00:22) | 43 s, à froid | 11,0 Go | ✅ Whisper relit de l'espagnol (« Hola, aquí hay una prueba de… »), 4,7 s, F0 de 174 Hz contre 199 Hz pour la source |

- **Traduction** : un Whisper local (faster-whisper, modèle tiny) relit la parole produite comme les mots français de la source prononcés à l'espagnole. Gemma, à qui l'on demandait de transcrire puis de traduire d'un coup, n'a rendu que la transcription. Le workflow procède maintenant en deux passes : transcription seule (node 3), puis traduction de ce texte (node 7), avec la consigne placée devant par le `StringConcatenate` du cœur (node 6). Validé sur ComfyUI CPU (`node_errors` vide), puis sur le GPU le 25/10 (168 s de conteneur, environ 0,06 $ ; il resterait environ 0,46 $).
- **Moodboard et palette d'après une photo** : Qwen-Image-Edit-2511 ne fait pas un transfert de style fiable depuis une image de référence. Les deux fonctions restent derrière `MONTAGIO_EXPERIMENTAL` (absentes de l'atelier et refusées par l'API sans lui). Une piste pour plus tard : faire décrire le style de la planche en mots par Gemma 4 (qui voit les images), puis donner ces mots à Z-Image ou à l'édition. Cela demande de partager les poids de Gemma entre deux extensions, ce que le registre refuse aujourd'hui.
- Toutes les entrées sont fictives : portraits Z-Image, port et voiture de la S3, voix intégrée de Chatterbox.

## 14. Mode Turbo (25/10)

Un conteneur L4 du compte Modal « montagio-2 » (`series`, 13 jobs), le 25/10 entre 2 h 53 et 3 h 24 (heure de Paris), avec l'accord de l'utilisateur. Le workflow `wan22-fun-camera-turbo.api.json` est le second groupe du template officiel : les deux LoRA 4 étapes de lightx2v (déjà au lock pour les transitions), 4 étapes à cfg 1, coupure à l'étape 2, shift 8. Pour comparer à l'identique, chaque job reprend la photo, la description, le négatif et la seed de la prise 20 étapes gardée pour la démo (S3, ou la refonte du 24/10). Résultats, planches et mesures : `s3/validation/perf/`, hors dépôt.

**Temps** : 156 s à froid, puis 136 à 138 s par clip, contre 1 113 à 1 183 s en 20 étapes : **8,3 fois plus rapide**. Sur une RTX 4090, environ 70 s (`estimate_s` 75). Le pic de VRAM ne change pas : la VRAM dynamique de ComfyUI occupe la carte (22,4 Go).

**Mouvement** : rapport entre le Turbo et la prise 20 étapes de l'écart moyen à la première image (niveaux de gris en 208 × 120, 8 i/s). C'est un indicateur d'amplitude, pas de qualité ; le verdict vient des planches.

| Preset | Photo | Mouvement | Verdict |
|---|---|---|---|
| Crash Push | voiture | 1,19 | ✅ pousse un peu plus loin ; la dernière image déforme le pare-brise |
| Crash Push | passante | 0,78 | ✅ avance un peu moins ; le visage est gardé |
| Slow Push | voiture | 1,11 | ✅ |
| Pull Back Reveal | voiture | 0,72 | ✅ recule un peu moins ; le sol se brouille en fin de plan |
| Crane Up | voiture | 1,03 | ✅ presque la même prise |
| Pull Back & Tilt Up | voiture | 0,64 | ✅ même trajectoire, un peu plus courte |
| Push & Settle | voiture | 1,09 | ✅ la bascule à mi-clip est nette |
| Breathing | voiture | 0,91 | ✅ |
| Pan Left | voiture | 1,02 | ✅ |
| Pan Left | passante | 0,82 | ❌ la personne se dédouble en fantôme sur les dernières images |
| Pan Right | voiture | 0,64 | ✅ travelling propre (la prise 20 étapes changeait aussi la voiture) |
| Drift Left Push | voiture | 0,96 | ✅ |
| Rise & Push | voiture | 1,11 | ❌ la caméra monte et avance jusqu'à perdre la voiture |

Contrairement à l'avertissement du template, le mouvement de caméra n'est pas perdu : c'est l'encodage de la trajectoire (Plücker) qui le pilote, et la LoRA ne fait que distiller le débruitage. Le Turbo perd un peu de détail fin (rochers, herbe) et déforme parfois la dernière image.

**Décisions**
- **Turbo par défaut** sur les 7 presets qui avancent, reculent ou montent : Crash Push, Slow Push, Pull Back Reveal, Crane Up, Pull Back & Tilt Up, Push & Settle, Breathing (`models.preferred` passe au modèle Turbo).
- **Qualité par défaut, Turbo en option** sur Rise & Push (le sujet sort du cadre) et sur les trois mouvements latéraux : Pan Left (fantôme sur une personne), Pan Right et Drift Left Push (même composante latérale, non essayée sur une personne).
- Le Studio montre trois pastilles : Qualité (~9 min), Turbo (~1 min, « les mêmes mouvements en 4 étapes : un peu moins de détail ») et Rapide (5B, ~2 min). Chaque preset part de son modèle par défaut, jusqu'à ce que le visiteur en choisisse un. La vitrine garde ses clips rendus en 20 étapes.

## 15. Profil 12 Go (25/10)

Un conteneur L4 du compte « montagio-2 » (fonction `lowvram`, 4 jobs), le 25/10 entre 2 h 51 et 3 h 02 (heure de Paris), en même temps que le lot Turbo, avec l'accord de l'utilisateur.

**Méthode.** `infra/modal/vram_cap.py` prend la mémoire de la L4 avant le démarrage de ComfyUI : 10 622 Mio tenus, 11 776 Mio (11,5 Gio) laissés libres, soit une carte de 12 Go dont le bureau garde environ un demi-gigaoctet. La RAM du conteneur est plafonnée à 32 Gio, une limite stricte. ComfyUI v0.41.0 mesure la pression mémoire sur tout le GPU (NVML) : il traite la mémoire tenue comme celle d'une autre application, et une allocation au-delà échouerait comme sur la vraie carte.

**Aucun nouveau poids.** Ce sont les fp8 du lock : ComfyUI annonce « DynamicVRAM support detected and enabled » et prépare chaque modèle « for dynamic VRAM loading » (Fun Camera : 14,6 Go mis en attente pour 11,5 Gio libres). La part d'un modèle qui ne tient pas passe entre deux étapes ; le calcul, lui, ne change pas.

| Job | 12 Go, à froid | 24 Go, à froid | Pic de ComfyUI | Verdict |
|---|---|---|---|---|
| Turbo, Crash Push (voiture, seed 7) | 153,5 s | 156,2 s (partie 14, même job) | 11,46 Gio | ✅ même mouvement que la prise 20 étapes |
| Effet Squish (voiture) | 174 s | 175 à 184 s (S2) | 11,29 Gio | ✅ |
| Rapide (5B), Crash Push | 192,9 s | 190 s (S2) | 11,26 Gio | ✅ suit le texte, comme à 24 Go |
| Z-Image, 1280 × 720 | 48 s | 45 s (S2) | 11,27 Gio | ✅ |

Le pic de ComfyUI est le pic de `nvidia-smi` moins les 10 817 Mio que tenait `vram_cap.py`. Le conteneur est resté sous sa limite de 32 Gio de RAM (aucun arrêt). Le `VmRSS` de ComfyUI, 45 Gio, compte les fichiers de poids projetés en mémoire (un cache que le noyau peut libérer) : ce n'est pas un besoin. Moins de 32 Gio n'a pas été essayé.

Une L4 calcule à peu près comme une RTX 4070 de 12 Go : les temps du profil sont gardés tels quels dans le registre (`low_vram`). Une RTX 3060 sera plus lente.

**Décisions**
- Le profil `12gb` (`MONTAGIO_VRAM_PROFILE=12gb`, posé par l'installeur) propose le Turbo, le 5B, le texte vers image et les effets (`low_vram_validated: 2026-10-25`), avec leurs temps mesurés ici.
- Qualité (20 étapes) et les autres extensions restent masquées dans ce profil tant qu'aucun rendu à 12 Go ne les a validées (règle de coupe). Les mouvements latéraux et Rise & Push y partent donc en Turbo, avec ses défauts de la partie 14.
- L'installeur propose ce profil sur une carte de 12 à 20 Go, au lieu de « l'app seule » ; `--low-vram` le demande directement.
- **Pas de GGUF.** Les fp8 tiennent déjà dans 12 Go avec la VRAM dynamique, sans nouveau poids ni nouveau pack de nodes. Licences relues le 25/10 pour mémoire, si un jour il fallait réduire la RAM ou le disque : `QuantStack/Wan2.2-Fun-A14B-Control-Camera-GGUF` (apache-2.0, `base_model` alibaba-pai/Wan2.2-Fun-A14B-Control-Camera, révision `7d2c3e06`), `city96/Wan2.1-I2V-14B-480P-gguf` (apache-2.0, base Wan-AI/Wan2.1-I2V-14B-480P, révision `b4b6b3b3`), le loader `city96/ComfyUI-GGUF` (Apache-2.0 selon GitHub). Rien n'entre au lock, ni dans `allowed-sources.yaml` ou `allowed-nodes.yaml`.

**Coût des parties 14 et 15** : environ 31 min de L4 pour le Turbo, 12 min pour le profil 12 Go et 10 min de CPU pour les poids manquants (les deux LoRA, une LoRA d'effet, le 5B et sa VAE), soit environ 0,90 $ (estimation ; le chiffre du tableau de bord n'est pas lu).

## 16. Restyle : spike VACE 14B (24/10)

Avec l'accord de l'utilisateur (≈ 1,20 $ annoncés, plafond 1,50 $), sur le compte Modal montagio-2 : les poids téléchargés par un conteneur sans GPU (≈ 0,05 $), puis deux conteneurs L4 en parallèle qui ont lancé `infra/modal/spike_restyle.py` (0,25 $ et 0,18 $ au relevé ; 15,18 $ sur le mois avant le spike). Rien n'était câblé : le script fait l'image de référence avec l'extension d'édition (smoke `--extension edit`), puis envoie à ComfyUI des graphes du cœur. Résultats dans `s3/restyle-spike/`, hors dépôt (clips, planches, `results.jsonl`, vidéos côte à côte).

| Job | Clip source | Contrôle | Référence | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|---|---|---|
| Édition de la 1re image (Qwen-Image-Edit-2511, 4 pas) | — | — | — | 72 à 82 s, à froid | 22,3 Go | ✅ voiture : soir d'hiver enneigé, cadrage gardé ; danse : décor de studio, figurine à peine en pâte à modeler |
| car-canny-ref | Crash Push de la voiture, 832×480, 81 images | Canny | style à suivre | 239 s, chargement de VACE compris | 20,9 Go | ✅ neige, crépuscule bleu, poussée de caméra identique |
| car-depth-ref | idem | profondeur | style à suivre | 198 s | 20,4 Go | ✅ idem, moins de fleurs au premier plan |
| car-depth-first | idem | profondeur | 1re image | 201 s | 20,4 Go | ✅ la 1re image est la référence, puis la scène suit ; petit saut après la 1re image |
| dance-depth-first | danse du 5B (S2), 480×832, 77 images | profondeur | 1re image | 247 s, chargement compris | 20,9 Go | ✅ poses et poussée exactes, décor repris ; ❌ la pâte à modeler ne tient pas |
| port-canny-prompt | Rise & Push du port, 832×480, 81 images | Canny | texte seul (« aquarelle ») | 187 s | 22,2 Go | ✅ peinture illustrée, mouvement suivi |

- **Réglages** : VACE 14B fp16 converti en fp8 au chargement, LoRA lightx2v T2V, 4 pas, cfg 1, euler, shift 5, `WanVaceToVideo` à force 1, négatif par défaut des templates Wan.
- **Scintillement** (écart moyen de luminance d'une image à la suivante, `tblend` + `signalstats`) : voiture 3,5 à 3,6 contre 2,6 pour la source ; port 5,5 contre 2,7 (la texture peinte bouge un peu) ; danse 14 comme la source.
- **Verdict : go.** Le câblage a retenu la profondeur (Depth Anything 3 Small, Apache-2.0) et les trois chemins (texte seul, style à suivre, 1re image restylisée).

### Validation du chemin câblé (24/10, 19:29)

Avec l'accord de l'utilisateur (≈ 0,30 $) : une `series` de trois runs du vrai smoke dans un conteneur L4, les workflows compilés par `compileRestyle` (profondeur dans les trois cas). 0,32 $ au relevé ; Restyle a coûté 0,80 $ en tout, spike compris (16,13 $ sur le mois). Résultats dans `s3/restyle-validation/`, hors dépôt ; le résultat est le fichier `…__r1-1.mp4` (81 images), `…__r1.mp4` étant le clip d'entrée préparé (80 images). La session locale s'est arrêtée pendant la série, qui a continué sur Modal (`--detach`).

| Job du smoke | Clip source | Chemin | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|---|---|
| `restyle-edit` (« a snowy winter evening ») | Crash Push de la voiture | 1re image du clip | 73 s, à froid | 22,2 Go | ✅ |
| `restyle:first-frame` | idem | 1re image restylisée | 239 s, chargement de VACE compris | 22,5 Go | ✅ soir d'hiver enneigé, phares allumés, poussée suivie image par image |
| `restyle` (« a watercolor painting of a small fishing harbour ») | Rise & Push du port | texte seul | 186 s | 22,3 Go | ⚠️ scène reconstruite et mouvement suivi, mais rendu réaliste : l'aquarelle n'est pas rendue |
| `restyle:look` (personnage cartoon de `sample-character.png`, « a cartoon character dancing in a colorful room ») | danse du 5B | style à suivre, image sans rapport avec le clip | 196 s | 22,2 Go | ✅ la danseuse devient le personnage (veste verte, écharpe rouge) dans une chambre colorée, poses et poussée exactes |

- **Daté** : `gpu_validated: 2026-10-24`. Le texte seul ne sert que sans l'extension d'édition ; un style demandé tient avec la 1re image restylisée (le chemin par défaut) ou une image à suivre.
- Les définitions `/object_info` du GPU (`object_info-extensions.json`) couvrent les classes du workflow.

## 17. Mouvement 30 s, personnage composé, bibliothèque Motion (24/10), remplacement d'objet (25/10)

Sur le compte Modal montagio-2, avec l'accord de l'utilisateur (« Oui, utilise montagio-2 »), lot par lot. Relevé : les 8 apps lancées de 19:40 à 22:04 (heure de Paris) ont coûté 5,15 $, dont 1,70 $ pour la série du transfert de 30 s ; au-delà des ≈ 2 $ visés, ce qui a été dit à l'utilisateur. Le compte affichait 21,13 $ sur le mois le 24/10 au soir. Résultats hors dépôt, sur le volume `montagio-results` (`runs/20261024-…`).

| Job | Entrées | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|---|
| Bibliothèque Motion, un clip de 5 s (Wan 2.1 I2V 480p 14B, depuis une photo Z-Image) | 7 personnages fictifs | 154 s par clip | — | ✅ sept mouvements, dont une danse de 30 s en six clips enchaînés |
| `compose:3refs` personnage + tenue + produit (Qwen-Image-Edit-2511, 4 pas) | garçon cartoon, une tenue, une petite voiture en jouet | — | — | ✅ visage, coiffure et tenue gardés, en pied ; ❌ la voiture devient une bouteille |
| `motion` du personnage composé, 5 s | la danse hip-hop | 425 s | 22,6 Go | ✅ |
| `compose:3refs`, consigne corrigée (« the very object of image 3 ») | les mêmes | 84 s | 21,9 Go | ❌ la voiture devient un téléphone |
| `motion` 30 s (481 images, 9 fenêtres de contexte) | garçon cartoon, hip-hop long de la bibliothèque | 3 425 s | 22,6 Go | ✅ même personnage du début à la fin, poses de la référence suivies image par image jusqu'au bras levé final |

- Comme pour Restyle, le smoke enregistre deux vidéos par job de mouvement : `…__r1.mp4` est le clip d'entrée que le node `LoadVideo` renvoie aussi, `…__r1-1.mp4` le résultat (le nœud de sortie du modèle, celui que l'app prend).
- 30 s prennent 1,86 fois 9 fois le temps d'une fenêtre sur une RTX 4090 (`estimate_s` 205) : l'estimation du Studio et du MCP (une fenêtre fois `motionWindows`) tient.
- **Daté** : le transfert de mouvement l'était déjà (21/10) ; ses 30 s et le personnage composé sont validés le 24/10. Le produit à côté d'une tenue reste une limite écrite.

### Remplacement d'objet : vérifié sur CPU, puis validé sur GPU (25/10)

Sur le ComfyUI v0.41.0 CPU (`../comfyui-cpu-v0.41.0`), le pack `kijai/ComfyUI-segment-anything-2` au commit `0c35fff5`, installé depuis l'archive de ce commit, s'est chargé en 0,9 s sans rien ajouter au venv ; les définitions `/object_info` de ses trois nodes et de `GrowMask` et `ResizeAndPadImage` sont celles du fixture des tests. Les workflows compilés (photo du nouvel objet, texte seul) passent `/prompt`. La partie suivi a tourné pour de bon : 17 images de « Boxe dans le vide », deux points sur les gants, SAM 2.1 base+ en fp32 sur le CPU, 314 s ; les deux gants sont couverts de gris, marge comprise, sur toutes les images, pendant que le boxeur pivote. Coût prévu sur GPU : la reconstruction de l'image Modal (le script d'amorçage a changé) puis deux rendus de 5 s (photo, texte seul), de l'ordre de 0,40 $.

Sur GPU le 25/10, avec l'accord de l'utilisateur (« Oui, lance (≈ 0,45 $) »). Coût réel : 0,27 $ pour les quatre apps (deux téléchargements de poids, dont la reconstruction de l'image Modal : 231 s pour la couche GPU, `bootstrap.sh` ayant changé ; deux séries). Le relevé du mois est à 22,05 $, dont une app `montagio-s2` d'une autre session, lancée à 02:49 et toujours en cours au relevé (0,46 $). Résultats sur le volume `montagio-results` (`runs/20261025-015859-lot4-swap`, `runs/20261025-020707-lot4-swap-fp16`) ; le résultat d'un job est le fichier `…__r1-1.mp4`.

| Job | Entrées | Temps sur la L4 | Pic de VRAM | Verdict |
|---|---|---|---|---|
| `compose:3refs`, le produit en image 2 avant la tenue | garçon cartoon, tenue, petite voiture rouge | 82 s | 22,2 Go | ✅ la petite voiture rouge tenue dans la main, tenue et visage gardés |
| `swap:text`, en fp32 (1er essai) | — | — | — | ❌ « No available kernel » sur `Sam2VideoSegmentationAddPoints` : sur Ada, l'attention de SAM 2 n'autorise que Flash, sans noyau fp32. Corrigé en fp16 (fichier `-fp16` du lock) |
| `swap:text` (« bright yellow boxing gloves »), 2 points | « Boxe dans le vide » de la bibliothèque, 480×832, 81 images | 252 s, chargement de VACE compris | 21,0 Go | ✅ les deux gants jaunes sur toutes les images, crochets et pivot compris ; boxeur, tenue, fond et poses inchangés |
| `swap:photo`, 3 points, photo `sample-character.png` | la danse du 5B (S2), 480×832, 80 images | 207 s | 22,5 Go | ✅ la danseuse devient le garçon cartoon (veste verte, écharpe rouge), poses et poussée de caméra suivies, décor gardé |

- **Daté** : `gpu_validated: 2026-10-25`. L'aperçu `presets/extensions/previews/swap.mp4` (avant et après, côte à côte, 373 Ko) vient du second rendu.

## 18. Banque de visages de départ (25/10)

Un conteneur L4 du compte « montagio-2 » (fonction `series`), le 25/10 à 15 h 13 (heure de Paris), puis une reprise de 5 visages à 15 h 22, avec l'accord de l'utilisateur (environ 0,13 $ annoncés, plafond 0,20 $).

**Méthode.** 28 personnages fictifs (`apps/web/src/lib/character-bank.ts`) : humains hors norme, animaux debout, robots, extraterrestres, quelques-uns en pâte à modeler et en anime. Chacun a son espèce, son style, ses traits (coiffure, proportions, peau, ajouts, yeux), sa description et sa graine. Le texte est celui de l'onglet Personnages (`characterPrompt`), à 720p en 9:16, comme `/api/images`. Avant toute dépense, le smoke en `--dry-run` a compilé les 28 workflows : identiques, après normalisation, à ceux du Studio, et acceptés par le ComfyUI CPU (`node_errors` vide). Le smoke donne sa graine à chaque image (`--t2i "id@9:16#graine=texte"`).

| Mesure | Valeur |
|---|---|
| 1er portrait, chargement compris | 45,9 s |
| Portraits suivants | 8,6 à 9,3 s |
| Pic de VRAM | 20,5 à 22,3 Go |
| Coût | 0,098 $ (28 visages) + 0,033 $ (reprise de 5), soit 0,13 $ |

**Revue, visage par visage.** 23 sur 28 étaient bons du premier coup. Trois montraient trop de peau malgré « a modest outfit » : Inès (veste sans haut dessous), Tavi (veste ouverte sur les rayures de la peau) et Ren (« cropped bomber » rendu en haut court). Deux animaux étaient assis comme de vrais animaux : Duke et Mochi. Leurs descriptions ont été précisées (haut à col roulé, veste fermée, « standing upright on two legs ») puis rendues de nouveau avec les mêmes graines. Inès, Tavi, Ren et Mochi sont corrigés ; Duke reste assis, et il est gardé. Aucun trait ne ressemble à une maladie réelle, et aucun visage ne rappelle une personne connue.

**Livré.** Pour chaque visage, `apps/web/scripts/character-bank.mts ingest` vérifie que le workflow rendu est celui que le Studio compile, puis écrit :
- `demo-assets/faces/<id>.jpg` : 720 × 1280, 1,9 Mo pour les 28, marqué AI-generated ;
- `demo-assets/faces/<id>.recipe.json` : une recette `montagio/recipe@1`, avec la requête `/api/images` qui le refait (texte, 9:16, graine), le workflow, les poids et le sha256 du JPEG ;
- `apps/web/public/characters/faces/<id>.webp` : une vignette de 240 × 320, recadrée depuis le haut, 244 Ko pour les 28.

La vitrine statique n'en montre que 6 (`SHOWCASE_FACES`). Elle copie tout `public/`, donc les 244 Ko des 28 vignettes ; les JPEG de `demo-assets/faces/` n'y vont pas. Planches et sorties brutes : `s3/validation/20261025-151310-character-bank/` et `…-152254-character-bank-retake/`, hors dépôt.
