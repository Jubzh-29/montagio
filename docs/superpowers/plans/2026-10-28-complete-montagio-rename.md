# Renommage intégral de Montagio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publier ultérieurement un dépôt Montagio sans aucune occurrence de l’ancien nom dans les fichiers actuels, les chemins, les médias ou les objets Git, tout en conservant un produit entièrement fonctionnel.

**Architecture:** Effectuer une coupure franche dans un worktree dédié : d’abord les workspaces et l’environnement, puis les nodes et schémas, puis les médias et leurs empreintes. Une barrière de marque parcourant les fichiers suivis précède la validation complète ; seule une révision validée est ensuite réécrite sur tous les refs locaux, sans alias ni publication.

**Tech Stack:** TypeScript/npm workspaces, Next.js 16, Python/Comfy SDK, Zod, YAML/JSON, FFmpeg, Vitest, Pytest, Playwright, git-filter-repo.

**Spec:** `docs/superpowers/specs/2026-10-28-complete-montagio-rename-design.md`

## Global Constraints

- Correspondances exactes pendant la migration : `ancien nom` → `Montagio`, `ancien nom` → `MONTAGIO`, `ancien nom` → `montagio` ; aucun alias dans la révision finale.
- Zéro occurrence, quelle que soit la casse, dans les chemins, textes, binaires et objets Git à publier.
- Conserver le durcissement de confidentialité du commit `1e7133f` et tous ses tests.
- Ne pas ajouter de dépendance au produit ; les outils de migration et de réécriture restent hors du dépôt.
- Une seule suite lourde à la fois ; aucune dépense GPU sans accord explicite.
- Aucun push, remote, déploiement ou formulaire dans ce chantier.
- Aucun commit ou fusion sans l’autorisation obtenue avec la validation de ce plan ; une confirmation séparée précède la fusion et la réécriture destructive.
- Ne jamais ajouter d’attribution à un outil ou à une IA dans les fichiers, commits ou messages.

## Review Focus

- **Ancienne recette locale** : elle doit être convertie hors du runtime et rester utilisable ; Task 6 exerce l’historique et Reproduce sur une copie migrée.
- **Média binaire avec ancien tag** : le contenu visuel et audio doit rester identique tandis que le hash change ; Task 4 compare les flux et recalcule les manifestes.
- **Workflow ComfyUI réel** : un identifiant renommé dans TypeScript mais pas dans le pack doit être refusé par le smoke réel ; Tasks 2 et 6 vérifient `/object_info` et `POST /prompt`.
- **Référence cachée dans un document ou un chemin** : la barrière de Task 5 parcourt tous les fichiers suivis et leurs noms, pas seulement le code.
- **Blob binaire uniquement présent dans un ancien commit** : le scan de Task 8 parcourt tous les objets accessibles et retire les blobs résiduels sans toucher à l’arbre final.

---

### Task 1: Workspaces npm et environnement

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `apps/web/package.json`, `packages/*/package.json`, `tools/check-open-stack/package.json`, `infra/{local,runpod}/package.json`
- Modify: `apps/web/src/**`, `packages/*/src/**`, `infra/**`, `tools/**`
- Modify: `.github/workflows/ci.yml`, `.github/workflows/publish-comfy-nodes.yml`
- Test: `apps/web/test/{api,guards,profile,proxy,local-backend}.test.ts`, `packages/mcp/test/client.test.ts`, `infra/local/test/services.test.ts`

**Interfaces:**
- Consumes: les workspaces `@ancien nom/*` et variables `ancien nom_*` existants.
- Produces: les workspaces `@montagio/*` et les mêmes variables préfixées `MONTAGIO_*`, notamment `MONTAGIO_BACKEND`, `MONTAGIO_URL`, `MONTAGIO_PROXY_TOKEN`, `MONTAGIO_ALLOWED_HOSTS` et `MONTAGIO_COMMIT`.

- [ ] **Step 1: Isoler les documents approuvés et la branche**

Créer le worktree via le skill prévu, y déplacer le design et ce plan actuellement non commités, puis rendre le `main` d’origine propre. Vérifier que la branche part de `1e7133f` et qu’aucun autre changement n’est présent.

- [ ] **Step 2: Écrire les assertions de renommage qui échouent**

Dans les tests existants, exiger `@montagio/web`, `MONTAGIO_BACKEND=demo`, `MONTAGIO_URL`, `MONTAGIO_ALLOWED_HOSTS` et les autres variables renommées. Ajouter dans `infra/local/test/services.test.ts` une vérification qu’aucun service ne lit l’ancien préfixe.

- [ ] **Step 3: Vérifier l’échec ciblé**

Run: `npx vitest run --globals test/guards.test.ts test/profile.test.ts test/local-backend.test.ts` depuis `apps/web`, et `npm test -w @ancien nom/infra-local`.
Expected: FAIL sur les nouveaux noms encore absents.

- [ ] **Step 4: Renommer workspaces, imports et variables**

Appliquer la correspondance aux manifestes, imports, code, scripts, workflows CI et tests. Renommer la propriété racine du package en `montagio`. Régénérer uniquement les métadonnées du lock avec `npm install --package-lock-only`, sans changer les versions des dépendances.

- [ ] **Step 5: Valider la tâche**

Run: `npm ci`, puis `npm run typecheck`, `npm run lint -w @montagio/web`, `npm test -w @montagio/infra-local` et les tests web ciblés.
Expected: PASS ; `npm query .name` ne retourne que des workspaces Montagio.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json apps packages tools infra .github
git commit -m "refactor: rename workspaces and environment"
```

### Task 2: Pack ComfyUI et identifiants de nodes

**Files:**
- Rename: `comfy-nodes/ancien nom_nodes/` → `comfy-nodes/montagio_nodes/`
- Modify: `comfy-nodes/{__init__.py,README.md,pyproject.toml}`, `comfy-nodes/montagio_nodes/*.py`
- Modify: `comfy-nodes/tests/*.py`, `comfy-nodes/scripts/smoke_comfyui.py`
- Modify: `registry/{extensions.yaml,allowed-nodes.yaml}`, `tools/check-open-stack/allowed-nodes.yaml`
- Modify: `infra/runpod/test/fixtures/object_info-v0.41.0.json`, `infra/{runpod,modal}/**`
- Test: `comfy-nodes/tests/{test_nodes,test_camera,test_smoke_prompt,test_host_guard}.py`

**Interfaces:**
- Consumes: les nouvelles variables `MONTAGIO_*` de Task 1.
- Produces: les IDs `MontagioLoadPreset`, `MontagioPresetFromYAML`, `MontagioCameraEmbedding`, `MontagioTranscribeWords`, la classe `MontagioExtension` et le module Python `montagio_nodes`.

- [ ] **Step 1: Écrire les assertions de nouveaux IDs**

Modifier les tests pour exiger les cinq noms ci-dessus, les nouvelles classes et `from montagio_nodes.nodes import …`. Faire assembler l’ancien nom dynamiquement dans le smoke si un message de diagnostic doit encore être évité, sans conserver d’alias fonctionnel.

- [ ] **Step 2: Vérifier l’échec ciblé**

Run: `python -m pytest comfy-nodes/tests/test_nodes.py comfy-nodes/tests/test_smoke_prompt.py -q`.
Expected: FAIL sur l’ancien module et les anciens IDs.

- [ ] **Step 3: Renommer le pack et ses consommateurs**

Renommer le dossier Python, les classes, `node_id`, imports, fixtures, listes autorisées, scripts et graphes d’exemple. Conserver les noms affichés déjà en Montagio et les calculs numériques inchangés.

- [ ] **Step 4: Valider le pack hors ligne**

Run: `npm run test:nodes` et `npm test -w @montagio/infra-runpod`.
Expected: PASS ; les définitions `/object_info` simulées exposent uniquement les nouveaux IDs.

- [ ] **Step 5: Commit**

```bash
git add comfy-nodes registry tools infra
git commit -m "refactor: rename ComfyUI node identifiers"
```

### Task 3: Recettes, schémas, tags et workflows

**Files:**
- Modify: `packages/recipe/src/{types,parse,compact,stack}.ts`
- Modify: `packages/captions/src/types.ts`, `packages/sequence/src/tags.ts`
- Modify: `packages/{mcp,presets,showcase,comfy-adapter}/**`, `apps/web/src/**`
- Modify: `workflows/*.json`, `demo-assets/**/*.json`, `comfy-hub/workflows/*.json`, `comfy-nodes/example_workflows/*.json`
- Test: `packages/recipe/test/*.test.ts`, `packages/captions/test/*.test.ts`, `packages/sequence/test/ffmpeg.test.ts`, `apps/web/test/recipe*.test.ts`

**Interfaces:**
- Consumes: les nouveaux IDs de nodes de Task 2.
- Produces: `RECIPE_SCHEMA = 'montagio/recipe@1'`, `WORDS_SCHEMA = 'montagio/words@1'`, `RECIPE_TAG.image = 'Montagio-Recipe'`, et le type suivant :

```ts
export type RecipeStack = {
  montagio: { version: string; commit: string | null };
  comfyui: { tag: string; commit: string };
  proxy: string;
  nodes: { name: string; version?: string; repo?: string; commit?: string }[];
};
```

- [ ] **Step 1: Écrire les tests de schéma et de tags**

Exiger les trois constantes et `stack.montagio` dans les recettes complètes et compactes. Vérifier que le parseur Zod accepte une recette nouvelle et que l’export PNG utilise la nouvelle clé.

- [ ] **Step 2: Vérifier l’échec ciblé**

Run: `npm test -w @montagio/recipe`, `npm test -w @montagio/captions` et `npm test -w @montagio/sequence`.
Expected: FAIL sur les anciennes constantes et la propriété de stack.

- [ ] **Step 3: Renommer les producteurs et consommateurs**

Modifier les types, parseurs, builders, exports, commandes Reproduce et interfaces web. Convertir tous les JSON/YAML suivis, y compris `filename_prefix`, `stack`, `schema`, tags et class types. Ne pas introduire de branche acceptant les anciens schémas.

- [ ] **Step 4: Valider les recettes et l’application**

Run: `npm test` et `npm run typecheck`.
Expected: PASS ; les exports produisent exclusivement les nouveaux schémas.

- [ ] **Step 5: Commit**

```bash
git add packages apps workflows demo-assets comfy-hub comfy-nodes
git commit -m "refactor: rename recipe and workflow schemas"
```

### Task 4: Médias, métadonnées et empreintes

**Files:**
- Modify: les binaires suivis sous `demo-assets/`, `apps/web/public/`, `presets/` et `docs/` dont le scan détecte l’ancien nom
- Modify: `demo-assets/showcase/manifest.yaml`, recettes et manifestes associés
- Create outside repository: `../montagio-rename-tools/rewrite-media.py`
- Test: `packages/showcase/test/verify.test.ts`, `packages/sequence/test/ffmpeg.test.ts`

**Interfaces:**
- Consumes: `RECIPE_TAG` et les schémas de Task 3.
- Produces: des médias avec uniquement des tags Montagio, des flux audio/vidéo inchangés lorsque le conteneur le permet, et des SHA-256 de manifeste égaux aux nouveaux fichiers.

- [ ] **Step 1: Inventorier les binaires et enregistrer les références**

Avec un script hors dépôt, lire chaque fichier suivi en octets et rechercher les trois variantes de casse. Pour chaque média, enregistrer SHA-256, tags, hash des flux décodés et dimensions avant modification. Écouter `demo-assets/examples/avatar.mp4` et confirmer la phrase déjà transcrite « Hello, I am a talking avatar made with Montagio. »

- [ ] **Step 2: Ajouter les assertions de tags et d’intégrité**

Dans les tests existants, exiger la nouvelle clé de recette et l’absence de l’ancienne clé assemblée dynamiquement. Vérifier que le manifeste strict accepte uniquement les nouveaux SHA-256.

- [ ] **Step 3: Réécrire les métadonnées**

Pour MP4/FLAC, utiliser FFmpeg avec copie des flux et nouvelle table de tags ; pour PNG, réécrire les chunks textuels sans réencoder les pixels. Recréer les recettes compactes avec les nouveaux schémas. Ne pas toucher au contenu audible déjà correct.

- [ ] **Step 4: Recalculer les artefacts dérivés**

Mettre à jour chaque `sha256`, recette `output`, manifeste et copie publique du média. Comparer dimensions, durée, fps, nombre de canaux et hash des flux décodés aux références de Step 1.

- [ ] **Step 5: Valider la vitrine et les médias**

Run: `npm run showcase -- verify --strict`, `npm run showcase:build -w @montagio/web`, et le scan d’octets de Step 1.
Expected: PASS, zéro binaire courant restant à convertir, aucune différence de flux non expliquée.

- [ ] **Step 6: Commit**

```bash
git add demo-assets apps/web/public presets docs
git commit -m "chore: refresh media metadata and hashes"
```

### Task 5: Documentation et barrière zéro référence

**Files:**
- Create: `tools/check-open-stack/test/brand-rename.test.ts`
- Modify: `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/**`, `comfy-hub/**`, `packages/*/README.md`, `infra/*/README.md`
- Modify: `docs/superpowers/specs/2026-10-28-complete-montagio-rename-design.md`
- Modify: `docs/superpowers/plans/2026-10-28-complete-montagio-rename.md`
- Modify outside repository: `../docs/lancement/*.md`

**Interfaces:**
- Consumes: tous les fichiers renommés des Tasks 1 à 4.
- Produces: un test de non-régression qui échoue sur tout chemin ou contenu suivi contenant l’ancienne marque, construite dynamiquement pour ne pas se détecter elle-même.

- [ ] **Step 1: Écrire le test de barrière**

Le test exécute `git ls-files -z`, compare chaque chemin en minuscules à la marque assemblée, puis parcourt chaque fichier par chunks avec chevauchement pour détecter les trois variantes d’octets, y compris à une frontière de chunk. Il rapporte tous les chemins fautifs et n’exclut ni documentation ni lockfile.

- [ ] **Step 2: Vérifier que la barrière échoue encore**

Run: `npx vitest run --globals test/brand-rename.test.ts` depuis `tools/check-open-stack`.
Expected: FAIL, avec les références documentaires restantes, dont ce plan et le design.

- [ ] **Step 3: Nettoyer les derniers textes et chemins**

Remplacer les exemples de commandes, noms de volumes/apps, textes historiques et anciens plans par Montagio. Aligner aussi les commandes du kit privé `../docs/lancement/`, sans le faire entrer dans Git. Dans le design et le plan, remplacer ensuite les littéraux de l’ancienne marque par « ancien nom » afin que les documents finaux passent eux-mêmes la barrière.

- [ ] **Step 4: Vérifier l’arbre courant complet**

Run: le test de barrière, `git diff --check`, puis une recherche insensible à la casse sur les chemins et le contenu.
Expected: PASS et aucune occurrence ; aucun fichier suivi ne porte l’ancien nom.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "docs: complete the Montagio naming cleanup"
```

### Task 6: Migration locale et parcours réels

**Files:**
- Create outside repository: `../montagio-rename-tools/migrate-local-data.py`
- Modify only ignored local data after backup: `data/`, `apps/web/data/` si présente
- Test: `apps/web/test/{history,recipe,data-purge}.test.ts`, `apps/web/e2e/{history-purge,share,recipe}.spec.ts`

**Interfaces:**
- Consumes: les nouveaux schémas et IDs des Tasks 2 et 3.
- Produces: des données locales converties sans code de compatibilité dans le dépôt, et une installation ComfyUI CPU utilisant uniquement les nouveaux IDs.

- [ ] **Step 1: Sauvegarder et migrer une copie**

Localiser les données locales ignorées, créer une sauvegarde datée hors du dépôt, puis convertir une copie : schémas, propriétés de stack, class types, tags et recettes. Le script temporaire refuse d’écraser la source tant que la copie n’a pas passé les parseurs.

- [ ] **Step 2: Vérifier les parcours sur la copie migrée**

Lancer l’app contre cette copie ; ouvrir l’historique, une recette, Reproduce, un export de partage et la purge de données de test. Vérifier que les réponses HTTP et fichiers n’utilisent que les nouveaux schémas et que la purge conserve les codes `data-busy`, `data-purging` et `remote-purge-incomplete`.

- [ ] **Step 3: Valider avec le ComfyUI CPU réel**

Relier le pack renommé dans `../comfyui-cpu-v0.41.0/custom_nodes/montagio`, démarrer ce ComfyUI selon sa procédure existante, puis exécuter :

```bash
MONTAGIO_COMFYUI_DIR="$PWD/../comfyui-cpu-v0.41.0" npm run test:nodes
python comfy-nodes/scripts/smoke_comfyui.py http://127.0.0.1:8188
```

Expected: les comparaisons au node cœur passent ; `/object_info` expose les nouveaux IDs ; le prompt réel finit en `success`. Aucun rendu GPU n’est lancé.

- [ ] **Step 4: Appliquer la migration validée**

Après succès sur la copie, appliquer le même script aux données locales sauvegardées, rouvrir l’historique et Reproduce, puis supprimer les outils temporaires contenant l’ancienne marque. Ne jamais ajouter les données ou sauvegardes à Git.

### Task 7: Validation complète et fusion autorisée

**Files:**
- Verify: toute la branche et `main`
- No product change expected

**Interfaces:**
- Consumes: les Tasks 1 à 6.
- Produces: une révision finale validée, prête pour la réécriture d’historique.

- [ ] **Step 1: Rejouer les contrôles standards, un à la fois**

```bash
npm ci
npm run typecheck
npm run lint -w @montagio/web
npm test
npm run test:nodes
npm run test:modal
npm run check:open-stack
npm run showcase -- verify --strict
npm run showcase:build -w @montagio/web
npm audit
```

Expected: toutes les commandes PASS, zéro vulnérabilité npm connue, aucune régression des protections précédentes.

- [ ] **Step 2: Rejouer les e2e**

```bash
npm run e2e -w @montagio/web
npm run e2e:local -w @montagio/web
cd apps/web && npx playwright test e2e/history-purge.spec.ts e2e/share.spec.ts
```

Expected: PASS ; la vitrine reste statique, sans upload, compte, analytics ou requête de rendu.

- [ ] **Step 3: Contrôler la révision et obtenir la fusion**

Exécuter la barrière de marque, `git diff --check`, `git status --short` et une revue complète de branche. Présenter les résultats à l’utilisateur et obtenir l’autorisation explicite de fusionner dans `main`.

- [ ] **Step 4: Fusionner sans publier**

Fusionner en fast-forward si possible, vérifier le nouveau commit et l’état propre de `main`. Ne configurer aucun remote et ne pousser aucun ref.

### Task 8: Réécriture et preuve de tout l’historique

**Files:**
- Create outside repository: `../montagio-pre-history-rewrite.bundle`
- Create outside repository: `../montagio-history-tools/{rewrite-rules.txt,scan-history.py,residual-blobs.txt}`
- Modify: tous les objets et refs Git locaux ; aucun changement attendu dans l’arbre final

**Interfaces:**
- Consumes: le `main` validé de Task 7 et les branches `main`, `fix/privacy-hardening` ; aucun tag actuel.
- Produces: les mêmes arbres finaux avec des IDs de commit réécrits, zéro occurrence dans les objets accessibles, et une sauvegarde locale non publiée.

- [ ] **Step 1: Confirmer, sauvegarder et figer les références**

Obtenir la confirmation explicite de réécrire l’historique. Vérifier tous les worktrees propres, enregistrer `HEAD^{tree}`, créer `git bundle create ../montagio-pre-history-rewrite.bundle --all`, puis vérifier le bundle avec `git bundle verify`.

- [ ] **Step 2: Préparer l’outillage isolé**

Détacher les worktrees secondaires sans supprimer de travail non commité. Installer `git-filter-repo` dans un venv hors dépôt. Créer les règles de remplacement des messages, le callback de chemins et un callback de blobs qui ne modifie que les blobs décodables en UTF-8. Les binaires ne doivent jamais subir de remplacement de longueur variable ; ils seront traités séparément aux Steps 4 et 5.

- [ ] **Step 3: Réécrire tous les refs**

Exécuter `git filter-repo --force --blob-callback … --replace-message … --filename-callback …` sur le dépôt principal, sans limiter aux seuls fichiers actuels. Vérifier que `main` et `fix/privacy-hardening` existent et que le hash de l’arbre final est identique à celui enregistré.

- [ ] **Step 4: Scanner tous les objets accessibles**

Le scanner énumère les objets via `git rev-list --objects --all`, lit chaque blob avec `git cat-file --batch`, recherche les trois variantes en octets et contrôle aussi chemins et messages. Tout blob binaire résiduel non présent dans l’arbre final est listé dans `residual-blobs.txt`. Un résidu dans l’arbre final est un échec bloquant, jamais une suppression automatique.

- [ ] **Step 5: Retirer les anciens binaires résiduels**

Si la liste est non vide, exécuter `git filter-repo --force --strip-blobs-with-ids ../montagio-history-tools/residual-blobs.txt`, puis répéter Step 4. Expected: zéro contenu, chemin ou message restant ; arbre final toujours inchangé.

- [ ] **Step 6: Purger les objets locaux après preuve**

Après deux scans vides, expirer les reflogs et exécuter `git gc --prune=now`. Réénumérer tous les objets accessibles et vérifier le résultat zéro. Conserver le bundle hors dépôt ; sa suppression demande une autorisation séparée.

- [ ] **Step 7: Revalider la révision réécrite**

Run: la barrière de marque, `npm run typecheck`, `npm test`, `npm run test:nodes`, `npm run showcase -- verify --strict`, `git diff --check` et `git status --short`.
Expected: PASS, arbre propre, mêmes fonctionnalités et aucune référence dans l’arbre ou l’historique.

- [ ] **Step 8: Restituer sans publier**

Donner les nouveaux IDs de `main` et de la branche secondaire, les compteurs de tests, le chemin du bundle et le résultat du scan complet. Ne pas créer de remote, ne pas pousser et ne pas déployer.
