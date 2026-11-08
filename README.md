# BOSSE !

Appli perso (PWA) qui dit **la seule action à faire maintenant**, lance un compte à rebours, demande un bilan, et range tout dans Notion.
Cinquième appli de la suite (avec Repax, Argenx, Agendix et Brief) : même style technique (Express 5, mot de passe d'accès, jeton Notion en variable d'environnement, déploiement Docker sur le NAS).

**État : étape 4.** L'action du moment, les projets (couleur, logo) et les tâches sont lus dans Notion ; on peut ajouter et cocher des tâches, lancer un compte à rebours (pause, +10 min), faire le bilan, et la séance part dans Notion. Une petite radio (mix YouTube de la base « Musique ») démarre avec le chrono, chaque séance se termine par un message d'encouragement avec le temps du jour et de la semaine, et une roue tire un projet au sort quand on ne sait pas quoi faire. Plan complet : [docs/PLAN.md](docs/PLAN.md). Bases Notion : [docs/NOTION.md](docs/NOTION.md).

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
- **Mes projets** : `Temps cumulé (min)` (+ durée), `Dernière activité`, `Prochaine étape` (seulement si tu l'as changée), et `Statut` → Terminé si tu coches « Projet terminé ».
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
