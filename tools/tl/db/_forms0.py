"""`Formations[].SectionIndex` の 0 番が何なのかを、束の盤ぜんぶで数える。

    /home/pebkac/arona/tl-work/venv/bin/python tools/tl/db/_forms0.py

出すもの:
  - 盤ごとの「節の数」と `SectionIndex` の並び（味方側だけ）
  - 0 番を持つ盤が何面あるか、その 0 番と 1 番の座標の差
  - 節 0 の `GroundConditionArea` の帯（`Position.z` と `Rect.Height`）
"""
import glob
import gzip
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def area_of(sec):
    """その節の `GroundConditionArea` を（z, 高さ）で返す（最初の 1 つ）。"""
    for ev in sec.get('Events', []):
        for c in ev.get('Conditions', []):
            if 'GroundConditionArea' in c.get('$type', '') and c.get('Position'):
                rect = c.get('Rect') or {}
                return (c['Position'].get('z'), rect.get('Height'))
    return None


def main():
    pat = 0
    rows = []
    for path in sorted(glob.glob(os.path.join(HERE, 'boss', '*.json.gz'))):
        with gzip.open(path, 'rt', encoding='utf-8') as fh:
            doc = json.load(fh)
        for name, bd in (doc.get('board') or {}).items():
            secs = bd.get('Sections') or []
            fms = [f for f in (bd.get('Formations') or []) if not f.get('IsEnemy')]
            idx = sorted({f.get('SectionIndex', 0) for f in fms})
            if not idx:
                continue
            zero = [f for f in fms if f.get('SectionIndex', 0) == 0]
            one = [f for f in fms if f.get('SectionIndex', 0) == 1]
            rows.append({
                'name': name, 'secs': len(secs), 'idx': idx,
                'has0': bool(zero),
                'z0': zero[0].get('Position', {}).get('y') if zero else None,
                'z1': one[0].get('Position', {}).get('y') if one else None,
                'area0': area_of(secs[0]) if secs else None,
            })
            pat += 1
    with0 = [r for r in rows if r['has0']]
    print('盤', pat, '面 ／ `SectionIndex 0` を持つ盤', len(with0), '面')
    print('節の数と添字の並びの型（味方側だけ）:')
    shapes = {}
    for r in rows:
        key = (r['secs'], tuple(r['idx']))
        shapes[key] = shapes.get(key, 0) + 1
    for key in sorted(shapes, key=lambda k: -shapes[k])[:20]:
        print('   節', key[0], '／ 添字', list(key[1]), '→', shapes[key], '面')
    print()
    print('0 番と 1 番の z、節 0 の帯（先頭 25 面）:')
    for r in with0[:25]:
        print('   {:60s} 節{} z0={} z1={} 帯={}'.format(
            r['name'][:60], r['secs'], r['z0'], r['z1'], r['area0']))
    same = [r for r in with0 if r['z1'] is not None and r['z0'] == r['z1']]
    diff = [r for r in with0 if r['z1'] is not None and r['z0'] != r['z1']]
    print()
    print('0 番と 1 番が同じ座標', len(same), '面 ／ 違う座標', len(diff), '面')


if __name__ == '__main__':
    main()
