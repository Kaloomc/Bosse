> **Historique des décisions de conception (7 novembre 2026).** Ce document garde la trace du plan tel qu'il a évolué : la première version (stockage Notion de « Mes projets » et activités) a été remplacée par la révision v3 (tout sur Notion, bases « Tâches », « Sessions de travail » et « Musique », nom « BOSSE ! »), placée à la fin. **L'état réel de l'appli est décrit dans [../README.md](../README.md)** ; les chiffres de la première version (pondérations, etc.) ne sont plus à jour.

---

# Plan — appli « Action du moment » (5e appli, 4e du brief)

Statut : PLAN SEULEMENT. Rien n'est créé : ni dossier ~/Projet/ActionDuMoment, ni dépôt GitHub, ni modification de Notion, ni commit.
Rédigé le 2026-11-07 (samedi) après lecture de Repax, Argenx, Agendix, Brief et de la base Notion « Mes projets ».

---------------------------------------------------------------------------------------------------
## 0. Ce que j'ai lu, et ce qui diffère du brief

### Dans les applis sœurs (le style à reprendre)
- Stack : Node ≥ 20, **Express 5 comme seule dépendance**, `node --test` pour les tests, aucun framework côté navigateur (HTML + CSS + JS à la main dans `public/`).
- Fichiers à la racine, en français : `server.js`, `notion.js`, un fichier par sujet (`analyses.js`, `enveloppes.js`…), `test.js`, `demo.js`.
- **Mot de passe** : `APP_PASSWORD` ; cookie signé en HMAC-SHA256 (un an, HttpOnly, SameSite=Lax, Secure derrière le proxy), comparaison en temps constant, 1 s d'attente après un mauvais essai ; toutes les routes `/api` sont protégées sauf `/api/connexion` et `/api/etat`. Sans mot de passe, le serveur n'écoute que sur 127.0.0.1 (Agendix refuse même de démarrer).
- **Notion** (`notion.js`) : API officielle en version `2022-06-28`, `fetch` natif, une requête toutes les 340 ms (limite ~3/s), nouvelle tentative sur 429/5xx, `NOTION_TOKEN` + `NOTION_PAGE_ID` en variables d'environnement, bases retrouvées **par leur titre** dans la page (`child_database`) et créées si elles manquent, colonnes manquantes ajoutées automatiquement. Sans jeton : **mode démo** avec données fictives.
- **PWA** : `manifest.json` (standalone, portrait, icônes 192/512 `any maskable`), `sw.js` « réseau d'abord, copie en cache en secours » (`cache: 'no-cache'`), balises `apple-mobile-web-app-*`, thème sombre pour Brief (tokens de Repax). Icônes Lucide en `<symbol>` SVG dans index.html.
- **Données locales** : fichiers JSON dans `data/` (ignoré par Git), écriture atomique (`.tmp` puis `rename`), variable `DOSSIER_DONNEES` pour les tests.
- **Déploiement** : `docker-compose.yml` (image `node:20-alpine`, `./app:/app`, au démarrage : `git fetch` + `reset --hard`, `npm ci --omit=dev && NOTION_TOKEN= npm test`, et **retour automatique à la version précédente si les tests échouent**), `docs/MISE-EN-LIGNE.md` (Container Manager → proxy inversé HTTPS → certificat → redirection Freebox → écran d'accueil iPhone/Android).
- **Ports** déjà pris : Repax 3011/8444, Argenx 3012/8445 (supposé : seul 8444, 8446 et 8447 sont confirmés dans les docs lues), Agendix 3013/8446, Brief 3014/8447 → **Action du moment : 3015 (NAS) / 8448 (Internet)**, à confirmer.
- **Tests** : `npm test` sans réseau ; Notion est testé avec un faux `fetch` qui vérifie même *quelles* requêtes partent (Brief vérifie qu'il n'écrit que 2 propriétés). Les routes HTTP sont testées avec `app.listen(0)`.

### Dans Notion : « Mes projets » (lue, rien modifié)
Propriétés réelles : Nom, Statut, Catégorie, Priorité, Objectif / résumé, Prochaine étape, Échéance, Dernière activité, Temps cumulé (min), Objectif de temps hebdo (min), Couleur (8 couleurs), Icône (texte), Logo (fichier), Affiches (fichier), Ordre, Style de salle, **et Notes** (pas dans le brief). Tous les champs du brief existent.
7 lignes : Taotl, Tronc commun 42, Montage du dernier vlog, Gorgée, Kalooflix, L'openSpace, « Appli Action du moment (4e appli perso) ».

Points importants pour la suite :
1. **La base n'est PAS dans la page « Gestion »** que partagent Repax/Argenx/Agendix/Brief : son parent est la page **« Projet »**. Les autres applis retrouvent leurs bases dans `NOTION_PAGE_ID` (= Gestion). Il faudra donc **une variable de plus** (`NOTION_BASE_PROJETS`) *et* que l'intégration Notion existante soit connectée à la page « Projet » (je ne peux pas le vérifier d'ici : je n'ai pas le jeton de l'appli, seulement mon accès Notion).
2. L'identifiant `collection://d07ae1e3-…` est celui de la *source de données*. L'API 2022-06-28 utilisée par les applis veut l'identifiant de la **base** : `d5d82250-5a73-4f9b-a4f0-679c73ad9d75` (même situation que Brief).
3. **Aucun projet n'a d'objectif hebdo ni d'échéance** pour l'instant. Seuls Taotl (207 min, dernière activité 16/10) et Gorgée (39 min, 16/10) ont un temps cumulé. Tronc commun 42 : priorité Haute, rien d'autre.
4. **Deux lignes ont un Statut vide** (Kalooflix, L'openSpace) ; Taotl, Tronc commun 42, Montage du dernier vlog et Gorgée sont « En cours » ; « Appli Action du moment » est en « Idée ».
5. Les **logos sont des fichiers hébergés par Notion** : l'API renvoie des liens signés qui **expirent après environ 1 heure**. On ne peut pas les enregistrer tels quels : le serveur les redonnera via une route `/api/logo/:id` (protégée par le mot de passe) qui va chercher un lien frais.
6. « Tronc commun 42 » est **une seule ligne** alors que le brief y range 3 choses avec des échéances différentes (ft_irc, Inception, révisions Exam Rank 05). Question n° 4.
7. Pour *distinguer projets et activités* et *les enveloppes hebdo des activités* : le champ **« Objectif de temps hebdo (min) » existe déjà** → c'est l'enveloppe. Il suffit d'ajouter `Type`.

---------------------------------------------------------------------------------------------------
## 1. Structure Notion proposée (rien n'est fait tant que tu n'as pas validé)

### 1a. Dans « Mes projets » : UNE seule propriété ajoutée
| Propriété | Type | Valeurs | Pourquoi |
|---|---|---|---|
| **Type** | Sélection | `Projet` (défaut si vide), `Activité` | distingue les deux ; une activité (lire, réviser, brainstormer avec Claude) a un chrono, un temps cumulé et un objectif hebdo comme un projet, mais en général pas d'échéance |

Le reste est réutilisé tel quel. L'**enveloppe hebdo d'une activité = « Objectif de temps hebdo (min) »** (ex. Lire = 120). L'appli calcule « ce qu'il reste » en retranchant le temps des sessions de la semaine.
Les champs hérités du prototype Open Space (Style de salle, Affiches, Ordre) sont **ignorés** par l'appli, jamais modifiés.
Mon choix pour la **relation** (voir 1b) : à sens unique, pour ne pas ajouter une colonne « Sessions » dans « Mes projets ».

### 1b. Nouvelle base « Sessions de travail » (une ligne = une séance de chrono)
Créée à côté de « Mes projets » (même page parent « Projet »), retrouvée par son titre, comme les autres applis le font.
| Propriété | Type | Contenu |
|---|---|---|
| **Titre** | Titre | « Taotl · 25 min » (rempli par l'appli, juste pour lire la base) |
| **Début** | Date avec heure (+ fin) | début et fin de la séance, fuseau Paris |
| **Durée (min)** | Nombre | durée réellement travaillée (pauses retirées), modifiable au bilan |
| **Projet ou activité** | Relation → « Mes projets » | un seul élément |
| **Bilan** | Texte | « où j'en suis » saisi à la fin |
| **Prochaine étape** | Texte | ce qui a été noté pour la suite (garde l'historique ; la valeur courante va aussi dans « Mes projets ») |
| **Origine** | Sélection | `Chrono` ou `Ajout manuel` (séance oubliée), plus tard `Roue` |

Pourquoi une base à part et pas juste « Temps cumulé » : le cumul ne dit pas *quand* on a travaillé. Sans les séances, impossible de calculer « 2 h aujourd'hui, 6 h cette semaine, dont 3 h sur ft_irc » ni le retard sur l'objectif hebdo.

### 1c. À chaque fin de séance, l'appli écrit exactement ceci dans Notion
1. **crée** une ligne dans « Sessions de travail » ;
2. dans le projet : `Temps cumulé (min)` **+= durée**, `Dernière activité` = aujourd'hui, `Prochaine étape` = ce que tu as noté (si tu l'as changé), et `Statut` seulement si tu coches « terminé ».
Rien d'autre n'est jamais écrit (un test le vérifiera, comme dans Brief). Lecture : tous les projets/activités + les séances de la semaine en cours (une requête filtrée sur la date).
Le temps de la semaine = **somme des séances** (pas le cumul). Le cumul existant (207 et 39 min) reste le point de départ.

### 1d. Plus tard (étape 3 b) : base « Étapes » pour découper un gros chantier
`Étape` (titre), `Projet` (relation), `Durée estimée (min)` (≈ 30), `Statut` (À faire / Fait), `Ordre`. L'action du moment affiche alors la prochaine étape « À faire » du projet. C'est aussi là que je rangerais la liste de tâches de Gorgée (agent générateur de questions, agent testeur, hébergement + gorgee.fr, tests 8-10 téléphones, rôles secrets, page d'accueil + alcool + mentions légales, contenu). Pas à créer maintenant.

---------------------------------------------------------------------------------------------------
## 2. Choisir « l'action du moment »

Principe : chaque élément candidat reçoit un **score de 0 à 100**, on affiche le premier ; le calcul est *expliqué* à l'écran (« Examen dans 3 jours · 0 h sur 4 h cette semaine »). Fonction pure dans `choix.js`, donc facile à tester.

**Candidats** : `Statut = En cours` (les projets) et les activités non en pause. Idée / En pause / Terminé sont exclus. (Statut vide : voir question 2.)

**Quatre ingrédients** (chacun entre 0 et 1), pondérés :
| Ingrédient | Poids | Calcul |
|---|---|---|
| Échéance | **40** | pas d'échéance → 0 ; dépassée ou aujourd'hui → 1 ; ≤ 3 j → 0,9 ; ≤ 7 j → 0,7 ; ≤ 14 j → 0,4 ; ≤ 30 j → 0,15 ; sinon 0,05 |
| Retard sur l'objectif hebdo | **35** | si objectif O (min) : attendu = O × (jour de la semaine ÷ 7), lundi = 1/7 … dimanche = 7/7 ; retard = max(0, attendu − fait) ÷ O. Sans objectif → 0 |
| Ancienneté de la dernière activité | **15** | jours depuis « Dernière activité » ÷ 14, plafonné à 1 ; jamais travaillé = 1 |
| Priorité | **10** | Haute 1 · Moyenne 0,5 · Basse/vide 0 |

Ajustements :
- **Objectif de la semaine atteint** → score − 50 (il reste choisissable, mais passe derrière ceux qui ont du retard).
- **Déjà travaillé aujourd'hui ≥ 60 min** → score − 20 (on tourne, sauf si l'échéance est dépassée).
- **« Autre chose »** : bouton discret sous l'action ; passe au 2ᵉ du classement (mémorisé jusqu'à minuit, pour ne pas revoir celui qu'on vient de refuser). Un seul élément visible à la fois, comme le brief le demande.
- Égalité : ancienneté la plus grande, puis ordre alphabétique (résultat stable).

Exemple chiffré (examen Rank 05 dans 5 jours, objectif 240 min, mercredi, rien fait, jamais révisé, priorité Haute) : échéance 0,7×40 = 28 + retard (103−0)/240 = 0,43×35 = 15 + ancienneté 1×15 = 15 + priorité 10 = **68**. Taotl (22 jours sans toucher, pas d'objectif, pas de priorité) : 15. L'examen gagne nettement.
Avec les données Notion d'aujourd'hui (aucune échéance, aucun objectif) : Tronc commun 42 = 25 (Haute + jamais travaillé), Taotl = 15, Gorgée = 15 → l'appli proposerait Tronc commun. Cohérent, mais ça montre qu'**il faut renseigner échéances et objectifs** pour qu'elle soit vraiment utile.

Taille de la séance : par défaut **30 min** (réglable). Le chrono compte en avant ; à 30 min un signal discret (vibration/son si l'appli est ouverte). Pas de compte à rebours bloquant.

---------------------------------------------------------------------------------------------------
## 3. La roue pondérée (étape 4)
- Mêmes candidats que ci-dessus.
- **Poids** w = 1 + 4 × retard hebdo + 2 × ancienneté + 2 × échéance ; objectif atteint → w = 0,3 ; sans aucun signal → 1. Un élément en gros retard a donc jusqu'à ~5 fois plus de chances qu'un élément à jour.
- Tirage **côté serveur** : on tire un nombre au hasard entre 0 et la somme des poids, on parcourt la liste en cumulant (fonction avec générateur aléatoire injectable → tests reproductibles).
- La roue est dessinée avec des **parts proportionnelles aux poids** (une part plus large = plus de chances, c'est honnête et lisible). Le client anime la rotation jusqu'à la part tirée.
- Résultat → même écran que l'action du moment (« Lancer le chrono » / « Relancer la roue »).

---------------------------------------------------------------------------------------------------
## 4. Bilan et encouragements

**Chrono** (état gardé côté serveur dans `data/chrono.json`, avec l'heure de départ) : si l'iPhone suspend l'appli ou si tu changes d'appareil, le chrono continue ; le temps affiché = heure actuelle − début − pauses. Actions : démarrer, pause/reprendre, terminer, annuler. Si le chrono a tourné plus de 3 h (oubli), le bilan demande de corriger la durée.
**Bilan** (écran unique, 3 champs) : durée (corrigeable), « où j'en suis » (texte), « prochaine étape » (pré-remplie avec l'actuelle) + case « projet terminé ».
**Encouragement** : texte calculé par des règles et des phrases, **sans modèle d'IA** (gratuit, instantané, jamais faux). Il prend : temps du jour, temps de la semaine, détail par projet, reste vers l'objectif. Exemples :
- « Bien joué : 2 h aujourd'hui, 6 h cette semaine, dont 3 h sur ft_irc. »
- « Plus que 40 min pour atteindre ton objectif de la semaine sur Gorgée. »
- « Objectif de la semaine atteint sur Taotl 🎯 — tout le reste est du bonus. »
- « Première séance de la journée, c'est la plus dure. Bravo. »
Priorité des messages : objectif atteint > objectif proche (≤ 45 min) > première séance du jour > total du jour/semaine. Quelques variantes de formulation par cas pour ne pas lire toujours la même phrase.
Jour = fuseau Europe/Paris ; semaine = **lundi → dimanche** (comme Argenx).

---------------------------------------------------------------------------------------------------
## 5. Écrans (mobile d'abord, barre de navigation en bas)
1. **Maintenant** (accueil) : logo + couleur du projet, nom, **raison** du choix, prochaine étape, gros bouton « Lancer le chrono », lien « Autre chose » ; en dessous une ligne « aujourd'hui / cette semaine ».
2. **Chrono** (plein écran, écran maintenu allumé quand c'est possible) : temps en grand avec halo, pause, terminer ; plus tard : lecteur radio.
3. **Bilan** : voir ci-dessus, puis le message d'encouragement.
4. **Semaine** : un élément par ligne (logo, couleur, barre de progression vers l'objectif hebdo, « il reste 1 h 20 »), séparés Projets / Activités ; temps du jour et de la semaine. Le détail d'un élément : prochaine étape, temps cumulé, dernières séances.
5. **Roue** (étape 4).
6. **Réglages** : durée de séance, état de Notion, bouton « Rafraîchir Notion » (comme Argenx), ajout manuel d'une séance oubliée, déconnexion.
Visuel : fond sombre (#0b0d16 environ), accents bleu / violet / turquoise, halo (`box-shadow` coloré) réservé au chrono et aux barres de progression, couleur de chaque projet = sa propriété « Couleur » traduite en teinte néon. Même système de variables CSS que Repax. Contrastes vérifiés pour la lisibilité.

---------------------------------------------------------------------------------------------------
## 6. Routes de l'API (noms en français, protégées par le mot de passe sauf les deux premières)
| Route | Rôle | Étape |
|---|---|---|
| `POST /api/connexion`, `GET /api/etat` | mot de passe / mode (notion ou démo) | 1 |
| `GET /api/maintenant` | l'action choisie + raisons + 2ᵉ choix (pour « Autre chose ») | 1 |
| `GET /api/projets` | éléments avec temps du jour / semaine / reste | 1 (simple) → 2 |
| `GET /api/chrono`, `POST /api/chrono/demarrer`, `/pause`, `/reprendre`, `/terminer` (= le bilan), `DELETE /api/chrono` | chrono | 1 |
| `POST /api/sessions` (séance oubliée), `GET /api/sessions?du=&au=` | séances | 1 / 2 |
| `PATCH /api/projets/:id` | prochaine étape, statut, objectif hebdo | 3 |
| `GET /api/logo/:id` | logo avec lien Notion frais | 2 |
| `POST /api/notion/rafraichir` | relit Notion | 1 |
| `POST /api/roue/tirer` | tirage pondéré | 4 |
| `GET/POST /api/etapes` | découpage en étapes | 3 b |
| `GET /api/radio` | bibliothèque YouTube | 5 |
Fichiers : `server.js` (routes, mot de passe), `notion.js` (API Notion), `projets.js` (lecture/normalisation), `temps.js` (jour/semaine Paris), `choix.js` (score + roue), `encouragements.js`, `chrono.js`, `demo.js`, `test.js`, `public/` (index.html, style.css, app.js, sw.js, manifest.json, icônes), `docs/MISE-EN-LIGNE.md`, `README.md`, `docker-compose.yml`.
Cache : projets et séances gardés 60 s en mémoire, invalidés à chaque écriture ; si Notion est injoignable en fin de séance, la séance est **gardée dans un fichier d'attente** et renvoyée plus tard (le temps n'est jamais perdu).

---------------------------------------------------------------------------------------------------
## 7. Découpage en étapes (une étape à la fois, ta validation entre chaque)
- **Étape 0 — validation** (maintenant) : ce plan + structure Notion. Après ton OK seulement : je crée le dossier, j'ajoute `Type` dans Notion et crée « Sessions de travail » (je te montre exactement ce que je change avant), et je remplis avec toi échéances/objectifs.
- **Étape 1a — socle + action du moment (lecture seule)** : squelette Express, mot de passe, PWA, lecture de « Mes projets », algorithme de choix, écran « Maintenant », mode démo, tests. *Rien n'est écrit dans Notion.*
- **Étape 1b — chrono + bilan + écriture** : chrono serveur, bilan, séance + temps cumulé + dernière activité dans Notion, fichier d'attente, test « n'écrit que ces champs ». C'est la **version minimale demandée**.
- *(Mise en ligne sur le NAS conseillée ici : `docker-compose.yml` + `docs/MISE-EN-LIGNE.md`, pour commencer à enregistrer de vraies séances.)*
- **Étape 2 — encouragements + visuel** : messages, écran Semaine avec barres de progression, thème néon, logos et couleurs, icônes.
- **Étape 3 — activités + enveloppes** : écran des activités, « il reste X » par enveloppe, ajout/édition d'objectifs ; **3 b** : base « Étapes » et affichage de la prochaine étape de ~30 min.
- **Étape 4 — la roue.**
- **Étape 5 — la radio YouTube** (bibliothèque de playlists/vidéos, lecteur intégré, démarre avec le chrono, bouton « suivante »). Contrainte à connaître : sur iPhone la lecture automatique d'une vidéo YouTube intégrée est limitée par Safari (elle doit être déclenchée par un appui) ; le bouton « Lancer le chrono » est justement un appui, donc ça devrait passer, mais je le testerai avant de promettre.

Chaque étape = code + tests (`npm test`) + une explication complète de ce qui a été fait. Ni commit ni push sans ta demande ; quand tu voudras pousser sur GitHub (dépôt `Kaloomc/ActionDuMoment`), ce sera par SSH (le HTTPS ne marche pas sur cet ordinateur).

---------------------------------------------------------------------------------------------------
## 8. Variables d'environnement prévues (docker-compose)
`PORT=3015`, `TZ=Europe/Paris`, `APP_PASSWORD` (obligatoire), `NOTION_TOKEN` (le même que les autres), **`NOTION_BASE_PROJETS`** (id ou lien de la base « Mes projets » ; la base « Sessions de travail » est cherchée/créée dans la page parente de celle-ci, donc pas besoin de `NOTION_PAGE_ID` ici), optionnel `WIDGET_TOKEN` (widget iPhone, plus tard).

---------------------------------------------------------------------------------------------------
## 9. Questions ouvertes (avec ma proposition par défaut ; réponds juste « ok » si ça te va)
1. **Accès Notion** : l'intégration que tu utilises pour Repax/Argenx est-elle connectée à la page **« Projet »** (celle qui contient « Mes projets ») ? Sinon : sur cette page, ••• → Connexions → ajoute-la. *Défaut : « Sessions de travail » est créée dans la page « Projet », à côté de « Mes projets ».*
2. **Statuts vides** : Kalooflix et L'openSpace n'ont pas de Statut. L'appli ne propose que les « En cours ». *Défaut : Kalooflix → En pause, L'openSpace (le prototype abandonné) → Terminé, « Appli Action du moment » → En cours dès qu'on commence ; « Montage du dernier vlog » reste En cours (sans objectif ni échéance, il sera rarement choisi). À toi de corriger.*
3. **Objectifs hebdo et échéances de départ** : aucun n'existe. Pour Tronc commun 42, Gorgée, Taotl (et les révisions d'examen), combien de minutes par semaine, et quelles dates (Exam Rank 05, publication de Gorgée, fin des animations de Taotl) ? Sans ça, l'ordre n'est décidé que par l'ancienneté et la priorité.
4. **Tronc commun 42** : une seule ligne, ou une ligne par sujet (`ft_irc`, `Inception`, `Révisions Exam Rank 05`) ? *Défaut : une ligne par sujet (échéances et temps séparés ; l'appli peut dire « révise l'Exam Rank 05 » plutôt que « Tronc commun »), et « Tronc commun 42 » devient leur regroupement/est mis en pause.*
5. **Activités de départ** : lesquelles et avec quelle enveloppe hebdo ? Exemples du brief : Brainstormer avec Claude, Lire (2 h/semaine), Réviser. « Réviser » fait-il doublon avec les révisions d'examen ?
6. **Semaine de travail** : l'attendu hebdo croît-il sur 7 jours (par défaut) ou seulement du lundi au vendredi ? Travailles-tu le week-end (c'est samedi aujourd'hui) ?
7. **Fin de séance** : chrono qui compte en avant avec un signal à 30 min (par défaut), ou vrai compte à rebours de 30 min qui sonne ? Notification quand l'appli est fermée (Web Push, comme le rappel de Brief) : maintenant ou plus tard ?
8. **Découpage des gros chantiers** : (a) tu me demandes de découper « Gorgée » dans une conversation avec Claude et je range les étapes dans la base « Étapes » de Notion, l'appli les affiche (recommandé : pas de clé d'API, pas de coût, aucune dépendance) ; ou (b) un bouton dans l'appli appelle l'API Claude (clé secrète + facturation à l'usage).
9. **Liste de tâches de Gorgée** (agent générateur de questions, agent testeur, hébergement/gorgee.fr, tests 8-10 téléphones…) : je les range dans la future base « Étapes » rattachée à Gorgée (elles apparaîtront comme actions) ou dans une page Notion à part, hors de l'appli ?
10. **Le prototype Open Space** lit-il encore « Mes projets » (Style de salle, Affiches…) ? Si oui, ajouter `Type` n'y change rien, mais je préfère le savoir.
11. **Nom et port** : « Action du moment » (nom court sur l'écran d'accueil : « Maintenant » ou « Action » ?), port 3015 / 8448 — OK ?

---------------------------------------------------------------------------------------------------
## RÉVISION v2 (7 nov. 2026) — demande de l'utilisateur : « pour l'intégration des projets on verra plus tard ; pour l'instant plutôt une base de to-do list avec chrono, musique, etc. »

Conséquence : l'intégration de « Mes projets » / « Sessions de travail » (sections 1 et 7 ci-dessus) est REPORTÉE. Rien n'est lu ni écrit dans Notion au départ.
- Stockage : fichiers JSON locaux dans data/ (comme Argenx), derrière un `store.js` à deux modes (local maintenant, Notion plus tard : même schéma qu'Agendix). Route de sauvegarde/restauration JSON.
- Modèle : Tâche { titre, liste (étiquette libre + couleur), échéance?, priorité (haute/moyenne/basse), durée estimée (30 min par défaut), statut à faire/fait, temps passé, dernière fois, étapes (cases à cocher) } ; Séance { tâche, début, durée, bilan, prochaine étape }.
- Action du moment = la tâche à faire au meilleur score : échéance 40, priorité 25, ancienneté (créée/touchée il y a longtemps) 20, durée estimée compatible avec la séance 15 ; « Autre chose » passe à la suivante.
- Étapes : 1 socle + to-do + action du moment ; 2 chrono + bilan + temps par tâche ; 3 musique YouTube (bibliothèque de playlists/vidéos, lecteur intégré, démarre avec le chrono, bouton suivante) ; 4 encouragements + visuel néon + barres ; 5 roue ; 6 mise en ligne NAS ; 7 plus tard : Notion (Mes projets, Sessions de travail), activités et enveloppes hebdo.
- Musique : YouTube IFrame Player, sans clé d'API ; « suivante » = vidéo suivante de la playlist ou autre élément de la bibliothèque tiré au hasard. Sur iPhone, le démarrage doit venir d'un appui (le bouton « Lancer le chrono »). Le contenu exact d'une playlist n'est pas lisible sans clé YouTube Data API : on se contente de la lire.

---------------------------------------------------------------------------------------------------
## RÉVISION v3 (7 nov. 2026) — remplace la v2 (stockage local abandonné)
Décisions de l'utilisateur : tout repose sur Notion ; dans l'appli, une partie « Projets » (couleur + logo lus dans « Mes projets ») et une partie to-do simple hors projet ; départ rempli avec ses vrais sujets ; chrono en COMPTE À REBOURS ; musique : commencer par des mix Mac Miller (YouTube) ; nom de l'appli : « BOSSE ! ».

Notion (à valider avant toute modification) :
- « Mes projets » : AUCUN changement de structure. Lu : Nom, Statut (seuls « En cours » affichés), Couleur, Logo, Priorité, Échéance, Prochaine étape, Dernière activité, Temps cumulé, Objectif hebdo. Écrit en fin de séance : Temps cumulé (+durée), Dernière activité, Prochaine étape.
- Nouvelle base « Tâches » (page « Projet », à côté de « Mes projets ») : Tâche (titre), Projet (relation → Mes projets, VIDE = to-do hors projet), Statut (À faire / Fait), Priorité, Échéance, Durée estimée (min, 30 par défaut), Temps passé (min), Dernière fois, Notes.
- Nouvelle base « Sessions de travail » : Titre, Début, Durée (min), Tâche (relation), Projet (relation), Bilan, Prochaine étape, Origine.
- Étape musique : base « Musique » (Titre, Lien YouTube, Type playlist/vidéo, Actif) pour ajouter des mix depuis le téléphone.
- Activités / enveloppes (propriété Type dans « Mes projets ») : plus tard.

Action du moment : candidats = tâches « À faire » (elles héritent du projet : priorité, échéance la plus proche, ancienneté de la dernière activité, retard sur l'objectif hebdo s'il existe) + projets « En cours » sans tâche ouverte (action = leur « Prochaine étape », ex. Taotl : finir les animations). Poids indicatifs : échéance 40, ancienneté 20, priorité 20, retard hebdo 20 (si objectif). « Autre chose » = suivant.
Chrono : compte à rebours (durée de la tâche, 30 min par défaut), état côté serveur (heure de départ + durée prévue), signal à zéro (son/vibration), « +10 min », « terminer plus tôt » ; durée réelle = temps écoulé ; puis bilan.
Départ rempli : Tronc commun 42 → ft_irc (partie réseau en binôme), Inception, Réviser l'Exam Rank 05 ; Gorgée → finaliser + checklist avant publication (agent générateur de questions, agent testeur, hébergement + serveur temps réel, gorgee.fr OVH, tests 8-10 téléphones + reconnexion, rôles secrets non visibles sur la TV, page d'accueil + avertissement alcool + mentions légales, assez de contenu) ; Taotl → finir les animations.
Étapes : 0 validation → 1a socle + lecture Notion + action du moment (lecture seule) + écrans Projets/Tâches → 1b ajout/coche de tâches + compte à rebours + bilan + écriture Notion → 2 musique Mac Miller → 3 encouragements + visuel néon → 4 roue → 5 mise en ligne NAS → 6 activités, enveloppes, découpage en 30 min.
Nom : « BOSSE ! » (manifest name « BOSSE ! », short_name « BOSSE »). Dossier proposé : ~/Projet/Bosse, dépôt Kaloomc/Bosse (à confirmer).
