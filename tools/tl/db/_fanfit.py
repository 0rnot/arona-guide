"""動画の扇の予告線とドローンの影から、水ハナコと奥のドローンの距離を盤の単位で出す（穴 11）。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_fanfit.py

コマは `fr_ches_QnKBiKMMUQE`（ケセド。00016 ＝ 戦闘 10.10 秒の扇の予告線、
00022 ＝ 12.10 秒のドローン 8 体）。どちらも同じカメラ。

- 盤 → 画面の写し（ホモグラフィ 8 個）
- 水ハナコの位置 (hx, hy) と扇の向き
- ドローンの足元が胴と影の間のどこか（k。1 ＝ 影）

を一緒に解く。拘束は 影 7 体（湧き点の座標）／ 扇の頂点／ 扇の 2 辺（60 度）／ 弧（半径 8.5）。
**影は胴の真下 72〜78 画素**に揃っている（丸い影。光の向きでずれていない）。
湧き点 (0, 25.5) の 1 体は歩いているので外し、答え合わせにだけ使う。
"""
import numpy as np
from PIL import Image

FR = '/home/pebkac/arona/tl-work/fr_ches_QnKBiKMMUQE/'

# 00022 の影（画面）と湧き点（盤）、同じ体の胴の中心（画面）
DRONES = [((755, 325), (-3, 24.5), (762, 252)), ((853, 307), (-3, 26), (855, 232)),
          ((953, 342), (-1.5, 26.5), (955, 268)), ((1037, 375), (0, 27), (1042, 301)),
          ((1077, 432), (1.5, 26.5), (1082, 356)), ((1098, 488), (3, 26), (1103, 410)),
          ((998, 512), (3, 24.5), (1000, 440))]
WALKED = ((900, 415), (0.07, 24.81))    # 核の 12.27 秒の座標
APEX = (360, 485)                       # 00016 の 2 辺の交点
LO = [(x, 0.0944 * x + 451.3) for x in range(400, 1040, 40)]      # 下の辺（青い線を拾った直線）
UP = ([(x, -0.4692 * x + 654.2) for x in range(400, 600, 40)]
      + [(690, 332), (720, 314), (740, 302), (762, 289), (780, 280)])
FAR = {'C': (-1.5, 26.5), 'D': (0, 27), 'E': (1.5, 26.5), 'F': (3, 26)}


def arc_points():
    """00016 の弧。各行でいちばん右の白い画素（255 行より上は射程の円が混ざる）"""
    im = np.asarray(Image.open(FR + '00016.jpg').convert('RGB')).astype(int)
    out = []
    for y in range(285, 545, 15):
        w = np.where(im[y, 700:1080].min(axis=1) > 215)[0]
        out.append((700 + w.max(), y))
    return out


def proj(H, b):
    q = H @ np.array([b[0], b[1], 1.0])
    return q[:2] / q[2]


def dlt(pairs):
    A = []
    for (u, v), (x, y) in pairs:
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    h = np.linalg.svd(np.array(A, float))[2][-1].reshape(3, 3)
    return h / h[2, 2]


def to_line(pt, a, b):
    d = b - a
    n = np.array([-d[1], d[0]]) / np.linalg.norm(d)
    return (np.array(pt) - a) @ n


def residuals(p, arc, R=8.5, deg=60):
    H = np.append(p[:8], 1).reshape(3, 3)
    hx, hy, ph, k = p[8:12]
    RR = p[12] if len(p) > 12 else R
    r = []
    for s, b, body in DRONES:
        bd = np.array(body, float)
        r += list(proj(H, b) - (bd + k * (np.array(s, float) - bd)))
    c = np.array([hx, hy])
    r += list(proj(H, c) - APEX)
    for sgn, obs in ((1, LO), (-1, UP)):     # 盤の +x 側が画面の右下（下の辺）
        a = np.radians(ph + sgn * deg / 2)
        A, B = proj(H, c), proj(H, c + 8 * np.array([np.sin(a), np.cos(a)]))
        r += [to_line(o, A, B) for o in obs]
    Hi = np.linalg.inv(H)
    for o in arc:
        r.append(50 * (np.hypot(*(proj(Hi, o) - c)) - RR))   # 1 単位 ≈ 50 画素で重みを揃える
    return np.array(r)


def lm(p, f, it=300):
    lam = 1e-3
    for _ in range(it):
        r = f(p)
        J = np.zeros((len(r), len(p)))
        for j in range(len(p)):
            dp = np.zeros_like(p)
            dp[j] = 1e-6 * max(1, abs(p[j]))
            J[:, j] = (f(p + dp) - r) / dp[j]
        A, g = J.T @ J, J.T @ r
        while True:
            step = np.linalg.solve(A + lam * np.diag(np.diag(A) + 1e-12), -g)
            if (f(p + step) ** 2).sum() < (r ** 2).sum():
                p, lam = p + step, lam * 0.3
                break
            lam *= 10
            if lam > 1e12:
                return p
    return p


def report(name, p, arc):
    r = residuals(p, arc)
    n = 2 * len(DRONES)
    H = np.append(p[:8], 1).reshape(3, 3)
    hx, hy = p[8], p[9]
    walked = proj(np.linalg.inv(H), WALKED[0])
    print(f'{name}: 影 最大 {np.abs(r[:n]).max():.1f} 画素 ／ 頂点 {np.abs(r[n:n + 2]).max():.1f} ／ '
          f'辺 最大 {np.abs(r[n + 2:n + 2 + len(LO) + len(UP)]).max():.1f} ／ '
          f'弧 最大 {np.abs(r[-len(arc):]).max() / 50:.2f} 単位')
    print(f'    水ハナコ ({hx:.2f}, {hy:.2f}) 向き {p[10]:.1f} 度 ／ k {p[11]:.2f}'
          + (f' ／ 半径 {p[12]:.2f}' if len(p) > 12 else '')
          + f' ／ 歩いた 1 体 {np.round(walked, 2)}（核 {WALKED[1]}）')
    print('    水ハナコから ' + ' ／ '.join(
        f'{nm} {b} {np.hypot(b[0] - hx, b[1] - hy):.2f}' for nm, b in FAR.items()))


def main():
    arc = arc_points()
    H0 = dlt([(s, b) for s, b, _ in DRONES])
    p0 = np.concatenate([H0.flatten()[:8], [-1.0, 18.0, 0.0, 1.0]])
    p = lm(p0, lambda q: residuals(q, arc))
    report('半径 8.5・60 度', p, arc)
    p = lm(np.append(p, 8.5), lambda q: residuals(q, arc))
    report('半径も解く', p, arc)


if __name__ == '__main__':
    main()
