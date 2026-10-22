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
| Changement de voix (Chatterbox VC) | 2,6 s | 21,2 Go | ❌ arrêt au chargement : il manque `t3_cfg.safetensors` et `tokenizer.json` |

- **Changement de voix** : le node `ChatterboxVC` ouvre le pack par le chargeur « classique », qui construit aussi le TTS anglais à côté du convertisseur. Il lui faut donc le T3 anglais et son tokenizer, deux fichiers du même dépôt Resemble AI (MIT, 2,1 Go). Ils sont ajoutés au lock dans le dossier du pack. La voix multilingue de l'avatar n'est pas touchée : elle choisit son T3 par son nom. Un nouveau passage sur le GPU reste à faire.
- **Définition du node** : la série garde maintenant les `/object_info` des nodes qu'elle emploie (`object_info-extensions.json`). Celle de `ChatterboxVC` est identique, infobulles mises à part, à la fixture écrite d'après le code source épinglé.
- Les photos d'entrée sont fictives : le port et la personne viennent de Z-Image, la petite voiture aussi. Le dessin a été fait pour ce test.
