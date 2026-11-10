#!/usr/bin/env python3
"""Fabrique les icônes de l'appli à partir du fichier maître public/icons/icon.svg.

Usage : python3 outils/icones.py        (hors production : rien de tout ça ne tourne sur le NAS)

Sorties dans public/icons/ :
  icon-192.png, icon-512.png        coins arrondis, fond transparent aux angles (purpose « any »)
  icon-maskable-512.png             plein cadre, symbole dans les 80 % centraux (purpose « maskable »)
  apple-touch-icon.png (180)        plein cadre : iOS arrondit lui-même
  favicon.svg, favicon-48.png       plein cadre (symbole sur fond plein)

Rendu : le navigateur sans écran livré avec Playwright (ou Chromium / Chrome si CHROMIUM est défini ou trouvé dans le PATH).
Aucune dépendance Python ni Node n'est ajoutée à l'appli.
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile

RACINE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DOSSIER = os.path.join(RACINE, "public", "icons")
RAYON_ARRONDI = 112  # sur 512


def navigateur():
    if os.environ.get("CHROMIUM"):
        return os.environ["CHROMIUM"]
    trouves = glob.glob(os.path.expanduser("~/.cache/ms-playwright/chromium_headless_shell-*/*/chrome-headless-shell"))
    if trouves:
        return sorted(trouves)[-1]
    for nom in ("chromium", "chromium-browser", "google-chrome", "chrome"):
        if shutil.which(nom):
            return shutil.which(nom)
    sys.exit("Aucun navigateur trouvé : définis CHROMIUM=/chemin/vers/chrome.")


def svg(arrondi):
    texte = open(os.path.join(DOSSIER, "icon.svg"), encoding="utf-8").read()
    rx = RAYON_ARRONDI if arrondi else 0
    return texte.replace('id="cadre" width="512" height="512" rx="0"', f'id="cadre" width="512" height="512" rx="{rx}"')


def png(chemin, taille, arrondi):
    with tempfile.TemporaryDirectory() as tmp:
        page = os.path.join(tmp, "p.html")
        with open(page, "w", encoding="utf-8") as f:
            f.write(f'<html><body style="margin:0;background:transparent"><div style="width:{taille}px;height:{taille}px">'
                    f'{svg(arrondi).replace("<svg ", "<svg style=\"display:block;width:100%;height:100%\" ", 1)}</div></body></html>')
        sortie = os.path.join(tmp, "s.png")
        subprocess.run([navigateur(), "--no-sandbox", "--hide-scrollbars", "--default-background-color=00000000",
                        f"--screenshot={sortie}", f"--window-size={taille},{taille}", "file://" + page],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.copy(sortie, chemin)
    print(os.path.relpath(chemin, RACINE))


if __name__ == "__main__":
    png(os.path.join(DOSSIER, "icon-192.png"), 192, True)
    png(os.path.join(DOSSIER, "icon-512.png"), 512, True)
    png(os.path.join(DOSSIER, "icon-maskable-512.png"), 512, False)
    png(os.path.join(DOSSIER, "apple-touch-icon.png"), 180, False)
    png(os.path.join(DOSSIER, "favicon-48.png"), 48, False)
    with open(os.path.join(DOSSIER, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(svg(False))
    print("public/icons/favicon.svg")
