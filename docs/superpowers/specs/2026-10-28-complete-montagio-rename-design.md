# Renommage intégral de Montagio — design

## Intention

Publier pour la première fois un dépôt dont le nom public et tous les identifiants techniques sont Montagio, sans conserver l’ancien nom dans les fichiers actuels, les métadonnées, les chemins ou l’historique Git publié. Le dépôt n’a encore ni remote ni utilisateurs publics : une coupure franche est préférable à une dette de compatibilité.

## Objectifs

- Zéro occurrence résiduelle, quelle que soit la casse, de `ancien nom` dans les chemins, fichiers texte et binaires de la branche publiée.
- Zéro occurrence dans les blobs et chemins de tous les objets Git destinés à être publiés.
- Remplacer les identifiants techniques, pas seulement les textes visibles : `@montagio/*`, `MONTAGIO_*`, `MontagioCameraEmbedding`, `MontagioLoadPreset`, `MontagioPresetFromYAML`, `montagio/recipe@1`, modules Python et noms de fichiers.
- Conserver les fonctions actuelles, les nouvelles protections de confidentialité et la vitrine statique.
- Faire fonctionner les nouvelles recettes, les workflows ComfyUI, le serveur MCP, les installeurs, les scripts, la CI et le pack de nodes avec les seuls nouveaux identifiants.
- Réencoder ou remplacer les médias dont les métadonnées contiennent l’ancien nom, puis mettre à jour les manifestes et empreintes. Vérifier également la piste audio de l’exemple avatar, dont la transcription actuelle dit déjà « Hello, I am a talking avatar made with Montagio. »

## Non-objectifs

- Aucun nouveau rendu créatif, aucune nouvelle fonction et aucun changement visuel du logo Montagio.
- Aucune dépense GPU ou API externe sans accord préalable. Aucun nouvel enregistrement audio n’est prévu sauf si l’écoute contredit la transcription actuelle ; dans ce cas, toute régénération payante demandera un budget.
- Aucun push, déploiement, création de dépôt public ou envoi de candidature dans ce chantier.
- Aucune obligation que chaque ancien commit réécrit puisse exécuter l’application : seule la révision finale doit être entièrement validée. Les anciens binaires inutilisés qui conserveraient l’ancien nom peuvent être retirés de l’historique.

## Anti-objectifs et critères d’échec

- Un remplacement textuel global sans régénération du lock npm, des workflows, des recettes et des empreintes.
- Des alias ou des branches de compatibilité contenant l’ancien nom.
- Une application qui compile mais dont « Open in ComfyUI », Reproduce, les exemples ou l’import des presets échouent.
- Une recherche limitée aux fichiers texte de `main`, qui manquerait les binaires, les chemins ou les anciens commits.
- Une réécriture d’historique sans sauvegarde locale temporaire ni vérification finale.

## Approches considérées

### Compatibilité avec alias

Renommer l’affichage et conserver les anciens identifiants comme alias réduirait le risque de migration, mais laisserait l’ancien nom dans le code et les fichiers. Rejeté : incompatible avec le nettoyage intégral choisi.

### Nouveau dépôt sans historique

Un commit racine unique garantirait facilement l’absence d’anciens blobs, mais détruirait la chronologie du projet. Rejeté : l’utilisateur a choisi de réécrire l’historique existant plutôt que de repartir d’un dépôt vide.

### Renommage franc puis réécriture complète — choisi

Effectuer une coupure cohérente dans l’arbre de travail, régénérer les artefacts dérivés, valider le produit, puis réécrire tous les refs et purger les objets résiduels. C’est le seul choix qui conserve l’historique utile tout en atteignant le zéro référence demandé.

## Conception détaillée

### 1. Inventaire et isolation

- Partir de `main` propre, actuellement `1e7133f`, dans un worktree dédié et une branche de renommage.
- Classer les occurrences par nature : identifiants, variables d’environnement, chemins, textes, workflows/recettes, métadonnées binaires, audio et historique.
- Relever les données locales ignorées qui devront être converties séparément ; elles ne doivent jamais être ajoutées au dépôt.
- Vérifier que les autres worktrees sont propres avant leur détachement, nécessaire à la réécriture finale.

### 2. Renommage cohérent du produit

- Appliquer les correspondances de casse `ancien nom` → `Montagio`, `ancien nom` → `MONTAGIO`, `ancien nom` → `montagio`, avec revue des occurrences plutôt qu’un remplacement aveugle.
- Renommer les workspaces npm, leurs imports et le lockfile ; ne pas ajouter de dépendance au produit.
- Renommer les variables d’environnement dans le code, les scripts, les exemples et la documentation.
- Renommer le package Python `comfy-nodes/ancien nom_nodes`, les classes et identifiants de nodes, les fixtures `object_info`, les workflows d’exemple et le chargeur de presets.
- Renommer le schéma de recette, les tags de workflow et les noms du serveur MCP.
- Renommer `infra/modal/ancien nom_s2.py` et tous les autres chemins concernés, y compris les références dans les scripts de déploiement.

### 3. Données et compatibilité locale sans alias publié

- Toutes les recettes et tous les workflows suivis par Git utilisent exclusivement les nouveaux identifiants.
- Les anciennes données locales éventuellement conservées sur la machine sont sauvegardées puis converties par un outil temporaire hors du dépôt. Cet outil est supprimé après migration ; aucune chaîne d’ancien nom ne reste dans le runtime publié.
- Après migration, ouvrir l’historique, Reproduce, un export de recette et un graphe ComfyUI pour vérifier le comportement réel.

### 4. Médias, exemples et empreintes

- Identifier les PNG, MP4 et autres binaires portant l’ancien nom dans leurs métadonnées par une lecture d’octets et par les outils média, pas seulement par `grep`.
- Réécrire les métadonnées sans modifier l’image ou la vidéo lorsque c’est possible ; recalculer ensuite les SHA-256 et les manifestes.
- Écouter l’exemple avatar et contrôler sa transcription : le texte actuel est déjà « Hello, I am a talking avatar made with Montagio. » Ne régénérer que si ce contrôle révèle une divergence.
- Reconstruire la vitrine et exécuter `npm run showcase -- verify --strict`.

### 5. Documentation et lancement

- Nettoyer README, SECURITY, CONTRIBUTING, guides, build notes, anciens plans/specs et cartes Comfy Hub.
- Conserver l’adresse publique prévue `Jubzh-29/montagio` et le nom du Space `jubzh/montagio`.
- Aligner les noms de commandes et de workspaces dans le kit de lancement lorsque celui-ci cite les anciens identifiants.
- Ne pas réintroduire de mention de l’ancien nom pour expliquer le renommage dans le dépôt final.

### 6. Validation du produit avant réécriture

Exécuter une suite lourde à la fois :

1. installation propre à partir du lockfile et contrôle des workspaces ;
2. `npm run typecheck` et lint web ;
3. `npm test` ;
4. `npm run test:nodes` et `npm run test:modal` ;
5. `npm run check:open-stack` ;
6. vérification stricte et build de la vitrine ;
7. e2e vitrine, démo locale, historique/purge et partage ;
8. parcours réel de chargement d’un workflow dans ComfyUI et de reproduction depuis la nouvelle recette ;
9. recherche insensible à la casse dans les fichiers, chemins et binaires suivis.

### 7. Réécriture de l’historique

- Après validation et autorisation de fusionner, créer une sauvegarde locale temporaire du dépôt, hors du contenu à publier.
- Détacher proprement les worktrees secondaires et utiliser `git-filter-repo` dans un environnement outillé local isolé, sans modifier les dépendances du projet.
- Réécrire les deux branches locales existantes, `main` et `fix/privacy-hardening`, ainsi que tout tag qui serait créé avant la réécriture. Aucun tag n’existe actuellement. Aucun ancien ref ne sera laissé publiable avec l’ancien nom.
- Réécrire les messages de commit, les blobs texte et les chemins. Retirer de l’historique les anciens binaires qui contiennent encore le nom et qui ne sont pas nécessaires à la révision finale.
- Conserver les auteurs et dates, sans ajouter d’attribution.
- Vérifier tous les objets accessibles avec `git rev-list --objects --all`, une recherche sur chaque révision et un scan d’octets des blobs binaires. Le résultat attendu est zéro chemin et zéro contenu correspondant.
- Expirer les reflogs et collecter les anciens objets seulement après réussite des contrôles. Garder la sauvegarde jusqu’à validation finale ; sa suppression ultérieure fera l’objet d’une confirmation séparée.
- Rejouer les contrôles essentiels sur le `main` réécrit. Aucun remote ne sera configuré et aucun push effectué par ce chantier.

## Ce qui reste à l’appréciation de l’implémenteur

- Découper le renommage en petites étapes vérifiables sans laisser de commit final intermédiaire non nettoyé.
- Choisir les commandes FFmpeg/outils PNG qui préservent les flux média lors du changement de métadonnées.
- Adapter les tests aux nouveaux noms sans affaiblir leurs assertions.

## Definition of Done

- Tous les identifiants publics et internes sont Montagio.
- Les tests, audits, builds et parcours réels ci-dessus sont verts.
- Les workflows, recettes, exemples et médias fonctionnent sans alias.
- La recherche finale retourne zéro occurrence dans l’arbre courant, les chemins, les binaires et tous les objets Git à publier.
- L’utilisateur reçoit les nouveaux identifiants de commit et l’état de la sauvegarde ; rien n’est publié.
