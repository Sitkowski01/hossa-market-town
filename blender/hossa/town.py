"""Centrum miasteczka: gielda, Bank Grosz i sklep sieci Koszyk wokol rynku.

Wspolrzedne lokalne budynku: front patrzy w -y, obrot z layout.json obraca go w strone rynku.
"""

import bpy
from mathutils import Vector

from . import kit


def _place(layout, key):
    at, rot, _, _ = kit.site(layout, key)
    return at, rot


def _facades(b, w, d, y0, z0, rows, cols_front, cols_side, size, row_h, front=True):
    """Okna na czterech scianach bryly o szerokosci w i glebokosci d, z przodem na y0."""
    x, y1 = w / 2, y0 + d
    walls = [((x, y0), (x, y1), cols_side), ((-x, y1), (-x, y0), cols_side), ((x, y1), (-x, y1), cols_front)]
    if front:
        walls.append(((-x, y0), (x, y0), cols_front))
    for a, c, n in walls:
        b.windows(a, c, z0, rows, n, size, "okna", frame="bialy", row_h=row_h)


def exchange(layout, coll):
    at, rot = _place(layout, "GIELDA")
    b = kit.Builder(at, rot)
    b.box((38, 28, 1.2), (0, -1, 0), "beton_sciana", skip=("bottom",))
    for k in range(4):
        b.box((24, 0.45, 1.2 - 0.24 * (k + 1)), (0, -15.225 - 0.45 * k, 0), "beton_sciana", skip=("bottom",))
    b.box((34.3, 20.3, 1.0), (0, 3, 1.2), "beton_sciana", skip=("bottom",))
    b.box((34, 20, 13.5), (0, 3, 2.2), "tynk", skip=("bottom",))
    _facades(b, 34, 20, -7, 3.4, 2, 6, 5, (1.6, 3.4), 5.4, front=False)
    for dx in (-5, 0, 5):
        b.box((2.6, 0.2, 4.8), (dx, -7.1, 1.2), "drewno", skip=("back",))
        b.box((2.0, 0.15, 2.8), (dx, -7.08, 8.0), "okna", skip=("back",))
    # portyk: osiem kolumn, belkowanie z napisem i tympanon
    for i in range(8):
        x = -14 + 4 * i
        b.box((1.7, 1.7, 0.5), (x, -12, 1.2), "beton_sciana")
        b.cyl(0.66, 10.0, (x, -12, 1.7), "tynk", seg=16, r_top=0.56, caps=False)
        b.box((1.8, 1.8, 0.5), (x, -12, 11.7), "beton_sciana")
    b.box((32, 6.2, 1.6), (0, -10, 12.2), "beton_sciana")
    b.text("GIEŁDA", 1.15, (0, -13.12, 12.5), "stal_ciemna")
    b.gable((6.4, 33, 3.6), (0, -10, 13.8), "miedz", rot=90, gable_mat="tynk")
    # gzyms, attyka z pasem notowan i kopula z latarnia
    b.box((34.8, 20.8, 0.6), (0, 3, 15.7), "beton_sciana")
    b.box((33.6, 19.6, 3.8), (0, 3, 16.3), "tynk")
    b.box((34.0, 20.0, 0.4), (0, 3, 20.1), "beton_sciana")
    b.box((33.0, 19.0, 0.06), (0, 3, 20.5), "papa")
    b.cyl(6.0, 2.4, (0, 4, 20.5), "tynk", seg=32)
    b.dome(5.8, (0, 4, 22.9), "miedz", squash=0.85)
    b.cyl(0.9, 1.8, (0, 4, 27.8), "tynk", seg=12)
    b.cyl(1.1, 0.4, (0, 4, 29.6), "miedz", seg=12, r_top=0.1)
    b.cyl(0.05, 4.0, (13, 9, 20.5), "stal")
    obj = b.done("GIELDA", coll)
    _led(obj, coll, b)
    kit.empty("GIELDA_kurs", b.world((0, 4, 33)), coll)
    return obj


def _led(parent, coll, b):
    """Pas notowan na attyce: osobny obiekt z UV 0..1, scena rysuje na nim przewijane kursy."""
    w, d, y0, z0, h = 33.62, 19.62, 3 - 9.81, 17.6, 1.6
    path = [(-w / 2, y0 + d), (-w / 2, y0), (w / 2, y0), (w / 2, y0 + d)]  # lewy bok, front, prawy bok
    total = sum(((path[i + 1][0] - path[i][0]) ** 2 + (path[i + 1][1] - path[i][1]) ** 2) ** 0.5 for i in range(3))
    mesh = bpy.data.meshes.new("GIELDA_led")
    verts, faces, uvs, run = [], [], [], 0.0
    for i in range(3):
        (ax, ay), (bx, by) = path[i], path[i + 1]
        length = ((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5
        n = len(verts)
        corners = [(ax, ay, z0), (bx, by, z0), (bx, by, z0 + h), (ax, ay, z0 + h)]
        verts += [tuple(b.base.to_3x3() @ Vector(c)) for c in corners]  # obrot budynku, rodzic go nie ma
        faces.append((n, n + 1, n + 2, n + 3))
        u0, u1 = run / total, (run + length) / total
        uvs += [(u0, 0), (u1, 0), (u1, 1), (u0, 1)]
        run += length
    mesh.from_pydata(verts, [], faces)
    layer = mesh.uv_layers.new(name="UVMap")
    for loop in mesh.loops:
        layer.data[loop.index].uv = uvs[loop.vertex_index]
    mesh.materials.append(kit.materials.get("led"))
    obj = bpy.data.objects.new("GIELDA_led", mesh)
    obj.parent = parent
    coll.objects.link(obj)
    return obj


def bank(layout, coll):
    at, rot = _place(layout, "GRS")
    b = kit.Builder(at, rot)
    b.box((20.4, 13.4, 4.2), (0, 0, 0), "beton_sciana", skip=("bottom",))
    b.box((20, 13, 10.2), (0, 0, 4.2), "tynk_szary", skip=("bottom",))
    b.box((20.6, 13.6, 1.6), (0, 0, 14.4), "granat_grs")
    b.text("BANK GROSZ", 0.95, (0, -6.88, 14.7), "bialy")
    b.box((19.8, 12.8, 0.06), (0, 0, 16.0), "papa")
    _facades(b, 20, 13, -6.5, 5.2, 3, 6, 4, (1.7, 2.2), 3.2)
    for x in (-7.5, -4.5, 4.5, 7.5):
        b.box((2.4, 0.15, 2.8), (x, -6.78, 0.6), "okna", skip=("back",))
    b.box((4.4, 0.3, 3.6), (0, -6.8, 0), "szklo", skip=("back",))
    b.box((6.5, 2.2, 0.35), (0, -7.9, 3.8), "granat_grs")
    b.box((0.9, 0.5, 1.6), (9.2, -6.95, 0), "stal_ciemna")  # bankomat
    for x in (-9.6, 9.6):
        b.box((0.4, 0.4, 14.4), (x, -6.6, 0), "granat_grs")
    obj = b.done("GRS", coll)
    kit.empty("GRS_kurs", b.world((0, 0, 21)), coll)
    return obj


def shop(layout, coll):
    at, rot = _place(layout, "KSZ")
    b = kit.Builder(at, rot)
    b.box((22, 14, 6.5), (0, 0, 0), "bialy", skip=("bottom",))
    b.box((22.2, 14.2, 0.5), (0, 0, 6.5), "stal_ciemna")
    for x, y in ((-6, 2), (-2, 3), (5, -1)):  # klimatyzatory na dachu
        b.box((2.2, 1.6, 1.2), (x, y, 7.0), "stal")
    b.box((4, 0.2, 3.6), (4, 7.05, 0), "stal_ciemna", skip=("back",))  # brama dostaw od zaplecza
    b.box((20, 0.2, 3.6), (0, -7.05, 0.2), "szklo", skip=("back",))
    for x in range(-10, 11, 4):
        b.box((0.25, 0.3, 3.8), (x, -7.1, 0), "stal_ciemna")
    b.box((22.4, 0.6, 2.2), (0, -7.25, 4.0), "zielony_ksz")
    b.text("KOSZYK", 1.3, (0, -7.6, 4.4), "bialy")
    b.box((7, 3, 0.3), (0, -8.5, 3.6), "zielony_ksz")
    for i in range(6):
        b.box((0.55, 0.9, 0.95), (8.5 - 0.35 * i, -9.6, 0), "stal")
    b.box((6.0, 0.5, 2.2), (0, -5.5, 7.0), "zielony_ksz")  # szyld na dachu nad wejsciem
    # boki i zaplecze widac z ujecia startowego: cokol, zebra okladziny, pas swietlikow pod dachem
    b.box((22.3, 14.3, 0.6), (0, 0, 0), "stal_ciemna", skip=("bottom", "top"))
    for side in (-1, 1):
        b.box((0.12, 11, 0.8), (side * 11.02, 0, 4.9), "szklo")
        for y in range(-6, 7, 2):
            b.box((0.2, 0.3, 5.9), (side * 11.05, y, 0.6), "stal")
    for x in range(-10, 11, 2):
        if not 1 <= x <= 7:  # bez zebra na bramie dostaw
            b.box((0.3, 0.2, 5.9), (x, 7.05, 0.6), "stal")
    b.box((7, 2.6, 0.25), (4, 8.3, 4.1), "stal_ciemna")  # daszek nad rampa
    b.box((7, 2.0, 1.1), (4, 8.0, 0), "chodnik")  # rampa dostaw
    for side in (-1, 1):  # zielona listwa attyki na bokach, jak pas nad witryna
        b.box((0.1, 14.2, 0.5), (side * 11.15, 0, 6.5), "zielony_ksz")
    obj = b.done("KSZ", coll)
    kit.empty("KSZ_kurs", b.world((0, 0, 14)), coll)
    return obj
