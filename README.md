# BOSSE !

Appli perso (PWA) qui dit **la seule action à faire maintenant**, lance un compte à rebours, demande un bilan, et range tout dans Notion.
Cinquième appli de la suite (avec Repax, Argenx, Agendix et Brief) : même style technique (Express 5, mot de passe d'accès, jeton Notion en variable d'environnement, déploiement Docker sur le NAS).

**État : étape 6, et tout est modifiable dans l'appli.** L'action du moment, les projets (couleur, logo) et les tâches sont lus dans Notion ; on peut ajouter et cocher des tâches, lancer un compte à rebours (pause, +10 min), faire le bilan, et la séance part dans Notion. Une petite radio (mix YouTube de la base « Musique ») démarre avec le chrono, chaque séance se termine par un message d'encouragement avec le temps du jour et de la semaine, une roue tire un projet au sort quand on ne sait pas quoi faire, les activités (lire, réviser…) ont leur enveloppe de temps par semaine, et un gros chantier se découpe en étapes d'environ 30 minutes. Plan complet : [docs/PLAN.md](docs/PLAN.md). Bases Notion : [docs/NOTION.md](docs/NOTION.md).

## Lancer en local

```bash
npm install
APP_PASSWORD=un-mot-de-passe npm start
```

Puis ouvrir http://localhost:3015. Sans `NOTION_TOKEN` : **mode démo** (données fictives). Sans `APP_PASSWORD`, le serveur n'écoute que sur 127.0.0.1.
Tests : `npm test` (aucun réseau ; Notion est testé avec un faux `fetch`).

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `APP_PASSWORD` | Mot de passe demandé une fois par téléphone (cookie signé, un an). |
| `NOTION_TOKEN` | Jeton de l'intégration Notion (le même que les autres applis). Vide : mode démo. |
| `NOTION_BASE_PROJETS` | Identifiant de la **base** « Mes projets » : `d5d82250-5a73-4f9b-a4f0-679c73ad9d75` (pas l'identifiant `collection://…`). La base « Tâches » est retrouvée par son titre dans la même page (« Projet »). L'intégration doit être connectée à cette page. |
| `NOTION_BASE_TACHES` | Facultatif : identifiant de la base « Tâches » si on ne veut pas la chercher par son titre. |
| `NOTION_BASE_SESSIONS`, `NOTION_BASE_MUSIQUE` | Facultatifs : identifiants des bases « Sessions de travail » et « Musique » (sinon retrouvées par leur titre). |
| `PORT` | 3015 par défaut. |
| `DOSSIER_DONNEES` | Dossier de `chrono.json` (le chrono en cours) et `attente.json` (séances pas encore envoyées à Notion). `data/` par défaut, ignoré par Git. |

## Ce que BOSSE ! écrit dans Notion (et rien d'autre)

- **Sessions de travail** : une ligne par séance (début, fin, durée, tâche, projet, bilan, prochaine étape, origine « Chrono »).
- **Mes projets** : tout champ modifié dans l'appli (nom, statut, couleur, logo par lien…), `Temps cumulé (min)` (+ durée), `Dernière activité`, `Prochaine étape` (seulement si tu l'as changée), `Statut` → Terminé si tu coches « Projet terminé », `Objectif de temps hebdo (min)` si tu le modifies dans l'appli, et une nouvelle ligne quand tu ajoutes une activité (avec la propriété `Type`, ajoutée à la base si elle manque).
- **Tâches** : `Temps passé (min)`, `Dernière fois`, `Statut` (Fait / À faire), et les tâches créées dans l'appli.

Si Notion est injoignable en fin de séance, la séance est gardée dans `attente.json` et renvoyée toutes les 2 minutes, sans doublon. Des tests vérifient les champs écrits.

## Comment l'action est choisie

Score de 0 à 100 : échéance (40) + ancienneté de la dernière fois (20) + priorité (20) + retard sur l'objectif hebdo (20, calculé avec les séances de la semaine). Ajustements : objectif de la semaine atteint −50 ; déjà une heure ou plus aujourd'hui sur le projet −20 (sauf échéance dépassée). Une tâche hérite de son projet (échéance la plus proche, priorité, dernière activité). Seuls les projets « En cours » comptent ; un projet en cours sans tâche ouverte est proposé avec sa « Prochaine étape ». « Autre chose » passe au meilleur choix d'un autre projet. Code : [choix.js](choix.js).

## La radio

Un lecteur YouTube intégré (youtube-nocookie.com) qui pioche dans la base Notion « Musique » (un lien YouTube par ligne : vidéo ou playlist ; case « Désactivé » pour en écarter un). Il démarre avec le chrono, se met en pause avec lui et s'arrête au bilan. Boutons : lecture/pause, suivante (morceau suivant d'une playlist, ou autre élément de la bibliothèque), couper le son. Une playlist est lue en ordre aléatoire ; une vidéo, jusqu'au bout, puis une autre est tirée. Vidéo supprimée ou non intégrable : la radio en passe une autre. Interrupteur dans Réglages. Sur iPhone, Safari peut exiger un appui sur ▶ : l'écran le dit. Code : [public/radio.js](public/radio.js), [musique.js](musique.js).

## Les encouragements

À la fin de chaque séance, un message construit par des règles (pas d'IA : instantané, gratuit, chiffres toujours exacts) : [encouragements.js](encouragements.js). Priorité : objectif de la semaine atteint avec cette séance > objectif tout proche (45 min ou moins : « Plus que 40 min pour atteindre ton objectif de la semaine sur Gorgée. ») > première séance du jour > simple bravo. Il ajoute toujours « Tu as travaillé 2 h aujourd'hui, 6 h cette semaine, dont 3 h sur ft_irc. » et, s'il y a un objectif, ce qu'il reste. Plusieurs formulations par cas, choisies de façon stable pour une même séance. La carte « Cette semaine » (une barre par projet vers son objectif) s'affiche aussi sur l'écran Maintenant.

## La roue

Quand tu ne sais pas quoi faire : l'onglet Roue tire un **projet** au sort (ou « Hors projet » pour les tâches sans projet), puis propose la meilleure tâche de ce projet. La roue a une part par projet, large comme ses chances de sortir. Poids d'une part : `1 + 4 × retard sur l'objectif hebdo + 2 × ancienneté + 2 × échéance` (un projet en gros retard a jusqu'à 5 fois plus de chances qu'un projet à jour) ; un projet qui a atteint son objectif de la semaine garde 0,3. Le tirage est fait par le serveur (`crypto.randomInt`) : [choix.js](choix.js) (`groupes`, `tirer`), routes `GET /api/roue` et `POST /api/roue/tirer`. Une séance lancée depuis la roue est enregistrée dans Notion avec l'origine « Roue ». Avec « réduire les animations » activé sur le téléphone, la roue s'arrête sans tourner.

## Activités et enveloppes

Une **activité** (lire, réviser, brainstormer avec Claude…) est une ligne de « Mes projets » dont la propriété **`Type`** vaut `Activité` (vide ou `Projet` : un projet). Elle fonctionne comme un projet : chrono, temps cumulé, séances. Son **enveloppe** est son « Objectif de temps hebdo (min) » : l'écran Projets montre « 1 h sur 2 h cette semaine · il reste 1 h », comme les enveloppes d'Argenx. Une activité sans tâche est proposée sous son nom (ou sa « Prochaine étape »), peut sortir de la roue, et n'a pas de case « terminé » au bilan. Boutons : « + Activité » (nom, enveloppe, couleur), « Fixer / Modifier » sur chaque carte pour changer l'objectif ou l'enveloppe d'un projet ou d'une activité.

## Découper un gros chantier

Onglet Tâches → **Découper** : une étape par ligne (puces et numéros acceptés), avec une durée facultative entre parenthèses (`Brancher le serveur (2 h)`, `(15 min)`, `(1h30)`). Chaque étape devient une tâche d'environ 30 minutes ; les étapes de plus de 45 minutes sont coupées en blocs (`… (1/4)` à `(4/4)`), si la case est cochée. Un aperçu en direct montre le résultat. Jusqu'à 30 tâches à la fois, créées dans l'ordre (les tâches sont lues dans l'ordre de création : à score égal, la première écrite passe d'abord). L'appli n'appelle aucun modèle : tu peux écrire la liste toi-même, ou la demander à Claude dans une conversation et la coller. Code : [public/etapes.js](public/etapes.js).

## Tout modifier dans l'appli (sans repasser par Notion)

- **Tâches** : touche une tâche pour la modifier (titre, projet, durée, priorité, échéance, notes, terminée ou non) ou la supprimer ; « Voir les tâches terminées » pour les rétablir.
- **Projets et activités** : le crayon de chaque carte ouvre tous les champs (nom, type, statut, objectif de la semaine ou enveloppe, prochaine étape, échéance, priorité, catégorie, couleur, initiales, résumé, **logo par lien vers une image**) ; « Nouveau » en crée ; les filtres En cours / En pause / Idées / Terminés / Tous retrouvent tout. Le logo se règle par un **lien** : envoyer un fichier depuis le téléphone n'est pas géré (un logo déjà posé dans Notion reste affiché).
- **Séances** (Réglages → Séances) : historique des 60 derniers jours, séance oubliée, correction de la durée, du jour ou du bilan, suppression. Le temps cumulé du projet et de la tâche est ajusté de la différence ; la « dernière activité » ne recule jamais.
- **Musique** (Réglages → Musique) : ajouter, renommer, désactiver (la case) ou supprimer des liens YouTube.
- Les suppressions mettent la page à la **corbeille de Notion** (récupérable) et demandent une confirmation. Un champ qu'on ne touche pas n'est jamais réécrit.
- Contrôles : [edition.js](edition.js) (formats, longueurs, listes de choix) ; chaque écriture vers Notion passe par une liste de champs autorisés (testée).

## Tes bases existantes (Tâches, Sessions de travail) : l'appli s'adapte

La page Notion « Projet » contenait déjà des bases **« Tâches »** et **« Sessions de travail »** (prototype Open Space) avec leurs propres colonnes : `Nom`, `Estimation (min)`, `Terminée le`, statuts `À faire / En cours / Fait / Bloquée` pour les tâches ; `Nom`, `Fin`, `Note`, `Source`, `Tâches faites` pour les séances. BOSSE ! ne leur impose donc pas ses noms de colonnes : il lit le **schéma réel** de chaque base et, pour chaque information, prend la première colonne qui existe parmi plusieurs noms possibles (voir `CHERCHE` dans [notion.js](notion.js)). Le titre est la colonne de type « titre », quel que soit son nom. Ce qui n'a pas de colonne (par ex. « Temps passé » ou « Notes » sur les tâches de l'ancienne base) n'est ni lu ni écrit, et l'écran ne le propose pas.

- Une tâche terminée reçoit la date dans « Terminée le » (si la colonne existe) ; rétablie, elle est vidée. Une tâche « Bloquée » n'est jamais proposée comme action.
- Une séance est écrite dans `Nom`, `Début` + `Fin`, `Durée (min)`, `Projet`, `Tâches faites`, `Note` et `Source` (Assis = chrono, Manuel = séance oubliée). L'historique existant (séances d'octobre) est lu et apparaît dans Réglages → Séances.
- **Bases du même nom en double** : si la page contient plusieurs bases « Tâches » (ou « Sessions de travail », « Musique »), c'est la **première** qui est utilisée ; Réglages le signale. Pour en choisir une autre : `NOTION_BASE_TACHES`, `NOTION_BASE_SESSIONS`, `NOTION_BASE_MUSIQUE` dans le YAML.
- **Cause du bug « tâches sans nom »** : les bases créées par BOSSE ! le 7 novembre portaient les mêmes titres que les anciennes ; la recherche par titre prenait les anciennes (les premières), dont le titre est dans `Nom` et non `Tâche`, d'où « Sans titre » partout (et des séances qui n'arrivaient pas à s'écrire : elles restaient « en attente » et partent maintenant, sans doublon).

## Onglet Musique

Un lecteur YouTube **indépendant du chrono** : touche une playlist ou une vidéo de la bibliothèque pour l'écouter, ou « Une musique au hasard » ; lecture/pause, suivante, coupe-son. Le chrono peut toujours lancer la musique, et le même lecteur continue (il n'est jamais déplacé dans la page : cela le relancerait). Limites de YouTube, dites dans l'écran : sur iPhone le son s'arrête quand l'écran se verrouille ou quand tu quittes l'appli (il repart au retour) ; la musique s'arrête aussi quand tu quittes l'onglet Musique et l'écran du chrono, car l'intégration YouTube demande que le lecteur reste visible ; Safari peut exiger un appui sur ▶. La bibliothèque se gère dans Musique → Gérer la bibliothèque.

## Rapidité

Les données de Notion sont gardées 60 secondes ; passé ce délai, l'écran est servi **tout de suite** avec ce qu'on a et Notion est relu en arrière-plan (plus d'attente de 1 à 2 secondes à chaque visite).
