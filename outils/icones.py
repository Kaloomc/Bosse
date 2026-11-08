#!/usr/bin/env python3
"""Fabrique les icônes de l'appli (public/icons/icon-192.png et icon-512.png).

Usage : python3 outils/icones.py
Un « B » avec un point d'exclamation turquoise et un halo violet sur fond sombre.
Le motif reste dans les 80 % centraux : l'icône est « maskable » (Android peut la rogner en rond).
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

POLICE = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FOND = (11, 13, 22)
VIOLET = (167, 139, 250)
TURQUOISE = (45, 226, 208)
BLANC = (238, 240, 255)


def icone(taille):
    s = taille * 4  # dessin en grand puis réduction : bords lisses
    image = Image.new("RGB", (s, s), FOND)
    police = ImageFont.truetype(POLICE, int(s * 0.5))
    police_point = ImageFont.truetype(POLICE, int(s * 0.5))

    def texte(couche, d, couleur):
        # « B » à gauche du centre, « ! » à droite : l'ensemble est centré
        lb = d.textbbox((0, 0), "B", font=police)
        lp = d.textbbox((0, 0), "!", font=police_point)
        largeur = (lb[2] - lb[0]) + int(s * 0.03) + (lp[2] - lp[0])
        x = (s - largeur) // 2
        hauteur = lb[3] - lb[1]
        y = (s - hauteur) // 2 - lb[1]
        d.text((x - lb[0], y), "B", font=police, fill=couleur[0])
        d.text((x + (lb[2] - lb[0]) + int(s * 0.03) - lp[0], y), "!", font=police_point, fill=couleur[1])

    halo = Image.new("RGB", (s, s), (0, 0, 0))
    texte(halo, ImageDraw.Draw(halo), (VIOLET, TURQUOISE))
    halo = halo.filter(ImageFilter.GaussianBlur(s * 0.035))
    image = Image.blend(image, Image.eval(halo, lambda v: v), 0.0)  # point de départ neutre
    # Le halo s'ajoute au fond (écran) pour rester lumineux sur le sombre
    from PIL import ImageChops
    image = ImageChops.add(image, halo)
    texte(image, ImageDraw.Draw(image), (BLANC, TURQUOISE))
    return image.resize((taille, taille), Image.LANCZOS)


if __name__ == "__main__":
    dossier = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "icons")
    os.makedirs(dossier, exist_ok=True)
    for t in (192, 512):
        icone(t).save(os.path.join(dossier, f"icon-{t}.png"), optimize=True)
        print(f"icon-{t}.png")
