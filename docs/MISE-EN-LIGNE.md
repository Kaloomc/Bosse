# Mise en ligne pas à pas

But : BOSSE ! disponible sur **https://teranga-nas.synology.me:8448**, installé sur l'écran d'accueil du téléphone.
Même recette que Repax (3011 / 8444), Argenx (3012 / 8445), Agendix (3013 / 8446) et Brief (3014 / 8447), avec le port **3015** côté NAS et **8448** côté Internet.

---

## 1. Le code sur GitHub

Le conteneur récupère le code depuis https://github.com/Kaloomc/Bosse à chaque démarrage. Le dépôt est **public** : il ne contient ni mot de passe, ni jeton (le dossier `data/` et les fichiers `.env` sont ignorés par Git ; les identifiants de bases Notion qui y figurent ne servent à rien sans le jeton).

1. Sur github.com, crée le dépôt **`Bosse`** (public, sans README, sans .gitignore, sans licence).
2. Dans le dossier du projet (`~/Projet/Bosse`) :

```bash
git remote add origin git@github.com:Kaloomc/Bosse.git
```

```bash
git push -u origin main
```

(L'adresse en `git@github.com:` utilise ta clé SSH ; en `https://`, GitHub demande des identifiants que cet ordinateur n'a pas.)

---

## 2. Notion : le même jeton, une page à partager

BOSSE ! utilise **le même jeton Notion que les autres applis** : reprends **`NOTION_TOKEN`** de Repax (copié depuis le YAML du projet `gestion-repas`).

**Différence avec les autres applis** : les bases de BOSSE ! ne sont **pas dans la page « Gestion »** mais dans la page **« Projet »**, à côté de « Mes projets ». Il y a donc une variable de plus et un partage à faire :

1. Dans Notion, ouvre la page **« Projet »** → **•••** (en haut à droite) → **Connexions** → ajoute **ton intégration** (celle des autres applis, « Gestion des repas »). Sans ça, BOSSE ! ne voit pas ses bases (`Could not find database`).
2. **`NOTION_BASE_PROJETS`** est déjà rempli dans le YAML : c'est l'identifiant de la **base** « Mes projets » (`d5d82250-5a73-4f9b-a4f0-679c73ad9d75`). Attention : l'identifiant `collection://d07ae1e3-…` vu dans Notion est celui de la *source de données* ; l'API utilisée par les applis (version 2022-06-28) attend celui de la *base*.

Les bases suivantes existent déjà dans la page « Projet » et sont retrouvées **par leur titre** :

| Base | Ce que fait BOSSE ! |
|---|---|
| **Mes projets** (existante ; propriété `Type` Projet / Activité ajoutée à l'étape 6) | lit les projets et activités « En cours » ; écrit `Temps cumulé (min)`, `Dernière activité`, `Prochaine étape` (si tu l'as changée), `Statut` → Terminé (si tu coches « Projet terminé »), `Objectif de temps hebdo (min)` (si tu le modifies dans l'appli) ; crée une ligne quand tu ajoutes une activité |
| **Tâches** | lit les tâches ; écrit `Temps passé (min)`, `Dernière fois`, `Statut` (Fait / À faire) ; crée les tâches ajoutées dans l'appli |
| **Sessions de travail** | une ligne par séance ; corrigée ou supprimée quand tu le fais dans l'appli (le temps cumulé suit) |
| **Musique** | lit les liens YouTube ; les ajoute, les renomme, les désactive ou les supprime quand tu le fais dans l'appli |

Ne renomme pas ces bases (sinon : `NOTION_BASE_TACHES`, `NOTION_BASE_SESSIONS`, `NOTION_BASE_MUSIQUE` dans le YAML). Sans `NOTION_TOKEN` : mode démo (données fictives, rien n'est lu ni écrit).

---

## 3. Créer le projet dans Container Manager

1. **File Station** → dossier `docker` → crée un dossier **`bosse`**, puis **dedans** un dossier vide **`app`**.
   Il faut les **deux** : sans `/docker/bosse/app`, le démarrage échoue avec `Bind mount failed: ... /app does not exist`.
2. **Container Manager** → **Projet** → **Créer** :
   - Nom du projet : `bosse`
   - Chemin : `/docker/bosse`
   - Source : **Créer un fichier docker-compose.yml**
3. Colle le contenu de [`docker-compose.yml`](../docker-compose.yml) et remplis :
   - `APP_PASSWORD=` un mot de passe à toi — **obligatoire** : sans lui, l'appli refuse d'écouter sur le réseau.
   - `NOTION_TOKEN=` le même que Repax.
   - `NOTION_BASE_PROJETS=` déjà rempli.
4. **Suivant** → (pas besoin de Web Station) → **Terminé**. Le projet démarre.
5. Vérifie : **Conteneur** → `bosse` → **Journal**. Le premier démarrage prend 1 à 2 minutes (installation de `git` puis des dépendances). À la fin tu dois voir :
   `BOSSE ! sur http://localhost:3015 (Notion activé)`
   Si c'est `non configuré : mode démo`, le jeton Notion est vide. Si tu vois `APP_PASSWORD manquant`, le mot de passe n'est pas rempli.

Test sur le réseau de la maison : http://192.168.1.45:3015 → écran de connexion.

**Premier essai avec ton vrai Notion** (c'est la première fois que l'appli parle au vrai Notion) :
1. Connecte-toi → **Réglages** → **Rafraîchir Notion**. Le message doit dire quelque chose comme « 7 projets, 14 tâches et 0 séances de la semaine lus ». Si c'est une erreur, voir le dépannage.
2. **Maintenant** : une action est proposée (avec son logo et sa couleur si le projet en a).
3. Fais une séance courte : **Lancer le chrono** → attends 1 minute → **Terminer** → durée 1 → **Enregistrer**. Dans Notion : une ligne dans « Sessions de travail », et `Temps cumulé (min)` + `Dernière activité` du projet ont bougé. (Tu peux ensuite corriger ces valeurs à la main dans Notion.)
4. Si Notion est injoignable à ce moment-là, **Réglages** montre « 1 séance en attente d'envoi » : elle repart toute seule (toutes les 2 minutes) sans doublon.

Les fichiers de BOSSE ! sont dans `/docker/bosse/app/data` (le chrono en cours, et les séances en attente d'envoi). Rien d'irremplaçable : tout le reste est dans Notion.

---

## 4. Proxy inversé HTTPS (port 8448)

**Panneau de configuration** → **Portail de connexion** → **Avancé** → **Proxy inversé** → **Créer** :

| | Source | Destination |
|---|---|---|
| Protocole | HTTPS | HTTP |
| Nom d'hôte | `teranga-nas.synology.me` | `localhost` |
| Port | `8448` | `3015` |

Nom de la règle : `bosse`. Coche **Activer HSTS** si tu veux (comme pour les autres).

---

## 5. Certificat

**Panneau de configuration** → **Sécurité** → **Certificat** → **Paramètres** :
pour le service **`teranga-nas.synology.me:8448`** (la règle du proxy), choisis le certificat **teranga-nas.synology.me** → **OK**.

---

## 6. Ouvrir le port sur la Freebox

1. http://mafreebox.freebox.fr → **Paramètres de la Freebox** → **Mode avancé** → **Gestion des ports**.
2. **Ajouter une redirection** : IP de destination `192.168.1.45`, redirection active, IP source toutes, protocole **TCP**, port de début / fin **8448**, port de destination **8448**.
3. **Sauvegarder**.

Si le **pare-feu DSM** est activé (**Panneau de configuration** → **Sécurité** → **Pare-feu**), autorise aussi le port TCP **8448**.

Test depuis le téléphone **en 4G (Wi-Fi coupé)** : https://teranga-nas.synology.me:8448 → l'écran de connexion s'affiche.

---

## 7. Mettre l'appli sur l'écran d'accueil

### iPhone (avec Safari, obligatoirement)
1. Ouvre https://teranga-nas.synology.me:8448 dans **Safari** et connecte-toi.
2. Bouton **Partager** → **Sur l'écran d'accueil** → nom : `BOSSE` → **Ajouter**.
3. Ouvre **BOSSE ! depuis l'icône** (pas depuis Safari).

### Android (avec Chrome)
Menu **⋮** → **Installer l'application**.

### La musique quand l'écran s'éteint
Le son d'un lecteur YouTube intégré **s'arrête quand le téléphone se verrouille** ou que l'appli passe en arrière-plan : c'est une règle d'iOS et de YouTube, que l'appli ne peut pas contourner. Pendant un chrono, l'appli garde l'écran allumé (si le téléphone le permet) ; si le son a été coupé par la mise en veille, il **repart tout seul au retour dans l'appli**.

### À vérifier une fois sur ton iPhone (je n'ai pas pu le tester)
- **Musique** : au lancement du chrono, la musique doit démarrer. Safari peut la bloquer : l'appli affiche alors « touche ▶ pour lancer la musique » ; un appui suffit. Si elle ne démarre jamais, dis-le moi.
- **Chrono et écran verrouillé** : le chrono est calculé à partir de l'heure de départ gardée sur le serveur, donc il reste juste même si l'iPhone met l'appli en veille. En revanche, **le bip et la vibration ne sonnent que si l'appli est ouverte** (la vibration n'existe pas sur iPhone ; la notification appli fermée n'est pas encore faite). Le bon réflexe : laisse l'écran allumé pendant la séance (l'appli le demande à iOS).
- **Rechargement en plein chrono** : la page revient sur le chrono en cours.

---

## 8. Mettre à jour l'appli

1. Pousse les changements sur GitHub (`git push`).
2. **Container Manager** → **Projet** → `bosse` → **Action** → **Redémarrer**.
Au redémarrage, le conteneur récupère la dernière version et lance les tests ; s'ils échouent, l'ancienne version est remise. Tes fichiers (`data/`) sont conservés.

Pour changer le mot de passe ou un jeton : **Projet** → `bosse` → **Arrêter** → **Modifier** le YAML → **Enregistrer** → **Démarrer**.

---

## Dépannage

| Problème | Piste |
|---|---|
| `Bind mount failed` | Le dossier `/docker/bosse/app` n'existe pas (étape 3.1) |
| Journal : `APP_PASSWORD manquant` | Remplis `APP_PASSWORD` dans le YAML |
| Journal : `mode démo` | `NOTION_TOKEN` est vide |
| `NOTION_BASE_PROJETS manquant` | La ligne est vide ou supprimée dans le YAML |
| `Notion : Could not find database` (ou « … pas celui de la source de données ») | `NOTION_BASE_PROJETS` n'est pas l'identifiant de la base (pas `collection://…`), ou l'intégration n'est pas connectée à la page « Projet » (étape 2.1) |
| `La base « Tâches » n'est pas dans la même page que « Mes projets »` | La base a été renommée ou déplacée : remets-la dans la page « Projet », ou renseigne `NOTION_BASE_TACHES` |
| `La base « Sessions de travail » n'est pas dans la même page…` | Idem avec `NOTION_BASE_SESSIONS` : les séances restent en attente tant que la base est introuvable |
| `Notion : API token is invalid` | `NOTION_TOKEN` faux (comme pour Repax) |
| Réglages : « N séances en attente d'envoi vers Notion (…) » | Lis l'erreur entre parenthèses ; corrige, puis **Rafraîchir Notion** : les séances partent |
| Musique : « La base « Musique » n'est pas dans la même page… » | Idem avec `NOTION_BASE_MUSIQUE` |
| Musique : « Ces vidéos ne peuvent pas être lues ici » | Les liens de la base « Musique » sont cassés ou interdits à l'intégration : remplace-les |
| Musique : rien ne démarre sur iPhone | Touche ▶ dans le lecteur (Safari exige un appui) |
| Aucune action proposée | Aucun projet « En cours » ni tâche « À faire » : vérifie les statuts dans Notion |
| La page ne s'ouvre pas depuis la 4G | Redirection Freebox (étape 6) ou pare-feu DSM |
| Avertissement de certificat | Étape 5 : le certificat n'est pas associé au port 8448 |
| `fatal: detected dubious ownership` | La ligne `safe.directory` manque dans la commande du YAML |
