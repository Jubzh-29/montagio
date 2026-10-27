# Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Rendre le dépôt, le kit de lancement, les vidéos et la candidature cohérents et prêts à publier, sans effectuer aucune publication.

**Architecture:** Les corrections du dépôt restent dans le worktree isolé `montagio-prepub`, sur une branche dédiée issue de `main`. Le kit privé et le projet HyperFrames existant sont modifiés séparément. Les actions dépendant d'informations personnelles ou d'un compte externe restent explicitement bloquées jusqu'à réponse de l'utilisateur.

**Tech Stack:** Markdown, YAML du manifeste de vitrine, tests Vitest existants, HyperFrames, FFmpeg/ffprobe, scripts de contrôle vidéo existants.

**Spec:** `../docs/lancement/` (`hf-space.md`, `formulaire.md`, `youtube.md`, `vertical.md`, `calendrier.md`) et le cadre validé dans la conversation du 27/10.

## Global Constraints

- Aucun push, aucune fusion, aucune création de compte et aucune publication sans accord explicite.
- Aucun commit git sans demande de l'utilisateur.
- Le nom du concurrent lié au concours n'apparaît que dans le hashtag du concours dans les contenus vidéo et sociaux concernés.
- Ne pas mentionner les assistants de code dans le formulaire sans décision de l'utilisateur.
- Ne pas déclarer la case « personnes réelles » vérifiée sans inspection des rendus et de leurs sources.
- Conserver les MP4 existants ; produire de nouvelles versions plutôt que les écraser.
- Une seule suite lourde à la fois ; privilégier les contrôles ciblés pour ces changements documentaires.

## Review Focus

- Une ancienne valeur `64 entries` ou `24 under MIT` ne doit pas contredire le lock de 65 entrées ; le contrôle final recherche ces valeurs.
- La page `/examples` ne doit pas être présentée comme un upload : le texte doit distinguer clips pré-rendus et entrées utilisateur désactivées.
- Une carte de fin ne doit pas conserver `<owner>`, `<showcase>` ou l'ancien nom du projet ; les images finales sont inspectées.
- Le nom du concours ne doit pas réapparaître en toutes lettres dans les textes qui réservent cette mention au hashtag ; une recherche ciblée le vérifie.
- Un rendu réussi techniquement ne suffit pas : durée, dimensions, audio et contrôle visuel doivent rester conformes aux versions validées.

---

### Task 1: README et carte Hugging Face

**Files:**
- Modify: `README.md:22-34,100-113,126-133`
- Modify: `apps/web/showcase-space/README.md`
- Test: `tools/check-open-stack/test/repo-policy.test.ts`

**Interfaces:**
- Consumes: les 10 entrées de `demo-assets/showcase/manifest.yaml` sous `features` et les 65 entrées de `registry/models.lock.yaml`.
- Produces: un README et une carte du Space décrivant les mêmes 43 clips Studio, 10 exemples et 65 poids.

- [x] **Step 1: Constater les assertions obsolètes avant modification**

Vérifier que `README.md` contient encore `64 entries, 40 under Apache-2.0 and 24 under MIT`, que sa présentation de la vitrine omet `/examples`, et que la carte du Space ne liste pas les modèles des exemples.

- [x] **Step 2: Mettre à jour le README**

Remplacer les nombres par `65 entries, 40 under Apache-2.0 and 25 under MIT`. Ajouter dans « Try it » la page `/examples` et ses dix exemples pré-rendus. Modifier la ligne « Hidden, and why » pour dire que les uploads et les outils interactifs correspondants restent masqués, tout en indiquant que des exemples pré-rendus sont visibles sur `/examples`.

- [x] **Step 3: Remplacer la carte du Space par la version validée du kit**

Reprendre `docs/lancement/hf-space.md`, section 2, dans `apps/web/showcase-space/README.md`. Conserver `short_description` comme seule ligne de la carte nommant le concurrent et vérifier que les dix exemples correspondent toujours au manifeste.

- [x] **Step 4: Relancer le test de politique du dépôt**

Run: `npx vitest run --globals test/repo-policy.test.ts` depuis `tools/check-open-stack`.
Expected: PASS ; aucune occurrence interdite du nom du concurrent dans la carte.

- [x] **Step 5: Vérifier les valeurs documentaires**

Rechercher dans `README.md` et `apps/web/showcase-space/README.md` les anciennes valeurs et les omissions. Vérifier `git diff --check` et relire le diff limité à ces deux fichiers.

### Task 2: Kit de lancement et candidature

**Files:**
- Modify: `../docs/lancement/youtube.md`
- Modify: `../docs/lancement/vertical.md`
- Modify: `../docs/lancement/formulaire.md`
- Modify: `../docs/lancement/hf-space.md`
- Modify: `../docs/lancement/calendrier.md`

**Interfaces:**
- Consumes: les corrections de la Task 1 et l'adresse connue `https://github.com/Jubzh-29/montagio`.
- Produces: un kit cohérent, avec seulement les emplacements qui exigent encore une donnée externe ou personnelle.

- [x] **Step 1: Corriger la mention du concours dans le texte YouTube**

Remplacer la phrase qui cite le concours en toutes lettres par une formulation n'utilisant que le hashtag du concours. Adapter la note explicative pour qu'elle décrive exactement le texte restant.

- [x] **Step 2: Actualiser les consignes après les corrections**

Dans `hf-space.md` et `calendrier.md`, marquer les corrections du dépôt comme préparées sur branche, sans les déclarer fusionnées. Dans `formulaire.md`, remplacer la demande de confirmation générique par l'état réel de la vérification vidéo, ou conserver une case non cochée si cette vérification n'est pas terminée.

- [x] **Step 3: Préparer la verticale avec l'adresse connue**

Dans `vertical.md`, indiquer que la nouvelle version utilise `github.com/Jubzh-29/montagio` et référencer le nouveau nom de fichier produit par la Task 3. Ne pas renommer les anciens rendus.

- [x] **Step 4: Auditer les emplacements et affirmations**

Rechercher tous les `{{…}}` dans `../docs/lancement/`. Vérifier que le pitch recommandé reste inférieur à 100 caractères, que les nombres 19/65/40/25 sont cohérents et que les assistants de code ne sont pas mentionnés. Consigner les seuls champs restant à renseigner dans le compte rendu final, sans créer un nouveau document.

### Task 3: Vérification et nouvelles versions des vidéos

**Files:**
- Modify: `C:/Users/Julil/usine-video/productions/2026-10-22_tech-ia_montagio-demo-video/09_montage/montagio-demo/index.html`
- Modify: `C:/Users/Julil/usine-video/productions/2026-10-22_tech-ia_montagio-demo-video/09_montage/montagio-demo/compositions/p11-end.html`
- Modify: `C:/Users/Julil/usine-video/productions/2026-10-22_tech-ia_montagio-demo-video/09_montage/montagio-vertical/index.html`
- Modify: `C:/Users/Julil/usine-video/productions/2026-10-22_tech-ia_montagio-demo-video/09_montage/montagio-vertical/compositions/v5-end.html`
- Create: nouveaux MP4 et captures de contrôle dans `09_montage/rendus/` et les sorties HyperFrames existantes.

**Interfaces:**
- Consumes: les compositions HyperFrames et leurs scripts de rendu existants ; `Jubzh-29/montagio` ; le compte Hugging Face à fournir pour l'URL directe du Space.
- Produces: une verticale avec l'adresse GitHub définitive, puis une 16:9 avec les adresses GitHub et Space définitives.

- [x] **Step 1: Lire les règles HyperFrames et les commandes existantes**

Charger le skill `hyperframes`, lire les `AGENTS.md` des deux compositions, leurs `meta.json`, `package.json` et les rapports de contrôle existants. Identifier la commande de rendu déjà utilisée au lieu d'inventer un nouveau pipeline.

- [x] **Step 2: Vérifier visuellement les personnes et scènes**

Extraire une planche d'images couvrant toutes les scènes des deux MP4 avec FFmpeg, l'inspecter avec l'outil média et rapprocher les visages des sources générées déjà identifiées. Si une personne réelle ou une source incertaine apparaît, laisser la case du formulaire non validée et le signaler.

- [x] **Step 3: Refaire la verticale sans attendre le Space**

Remplacer dans la composition et sa carte de fin `github.com/<owner>/montagio` par `github.com/Jubzh-29/montagio`. Produire `montagio-demo-video_vertical_en_v2.mp4`, sans écraser `v1`.

- [x] **Step 4: Contrôler la nouvelle verticale**

Vérifier avec ffprobe 1080×1920, 30 i/s et environ 38 s, contrôler l'audio avec le script existant, inspecter la carte de fin et une planche représentative. Rechercher les anciens emplacements dans la composition active.

- [x] **Step 5: Demander le compte Hugging Face et calculer l'URL du Space**

Conserver le nom de Space `montagio`. Le compte `jubzh` est créé et l'URL prévisionnelle est `jubzh-montagio.hf.space`. Le Space reste à créer : contrôler l'URL active après déploiement.

- [x] **Step 6: Refaire et contrôler la 16:9**

Remplacer les deux emplacements dans `montagio-demo` par les adresses définitives. Produire `montagio-demo-video_long_en_v5.mp4`, sans écraser `v4`. Vérifier 1920×1080, 30 i/s, environ 80 s, l'audio, la carte de fin et une planche représentative avec les mêmes outils qu'à l'étape 4.

### Task 4: Contrôles finaux et reliquat

**Files:**
- Modify: `../docs/lancement/youtube.md`
- Modify: `../docs/lancement/vertical.md`
- Modify: `../docs/lancement/formulaire.md`
- Modify: `../docs/lancement/calendrier.md`

**Interfaces:**
- Consumes: les fichiers et résultats des Tasks 1 à 3.
- Produces: un état final distinguant clairement « prêt », « en attente d'une donnée personnelle » et « à publier par l'utilisateur ».

- [x] **Step 1: Référencer les rendus effectivement contrôlés**

Mettre à jour les chemins, dimensions et résultats dans `youtube.md` et `vertical.md` uniquement à partir des nouveaux rapports. Ne pas recopier les mesures audio des anciennes versions si elles n'ont pas été revérifiées.

- [x] **Step 2: Exécuter les vérifications finales ciblées**

Relancer `repo-policy`, `git diff --check`, les recherches d'anciennes valeurs et d'emplacements interdits. Vérifier le statut git pour énumérer tous les fichiers modifiés et confirmer l'absence de commit, fusion ou push.

- [x] **Step 3: Fournir la liste courte des décisions restantes**

Dans la réponse finale, demander uniquement ce qui reste réellement nécessaire : compte Hugging Face, nom affiché, niveau ComfyUI, email Comfy, profils et pseudos, identifiant Registry, choix sur les assistants de code, et validation de la branche avant fusion. Ne pas présenter le travail comme totalement terminé si la 16:9 ou une vérification reste bloquée.
