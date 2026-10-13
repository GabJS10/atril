#!/usr/bin/env python3
"""Agrega los resultados del spike R0.1 (carpeta out/, ignorada por git).

Lee out/books.tsv, out/results/*.jsonl, out/time/*.time, out/build-times.tsv y escribe:
  - out/summary.json  (todas las cifras agregadas, para depurar)
  - stdout            (tablas en Markdown, para pegar en REPORT.md)

Mediana y máximo se calculan sobre las repeticiones (procesos distintos) de cada libro.
"""
import json
import os
import re
import statistics
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "out")
TAGS = ["r1", "r2", "r3"]
ENGINES = ["mupdf", "pdfium"]
WIDTHS = [1240, 2480]
PASSES = ["first", "second"]
SEARCH_BOOK_REL = "estudio-de-fe/La fe explicada.pdf"


def load_books():
    books = []
    with open(os.path.join(OUT, "books.tsv"), encoding="utf-8") as f:
        for line in f:
            bid, size, rel = line.rstrip("\n").split("\t")
            books.append({"id": bid, "bytes": int(size), "rel": rel})
    return books


def load_jsonl(path):
    recs = []
    if not os.path.exists(path):
        return recs
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line.startswith("{"):
                try:
                    recs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return recs


def parse_time(path):
    """Extrae RSS máximo (MB), tiempo de pared (s) y estado de /usr/bin/time -v."""
    if not os.path.exists(path):
        return None
    txt = open(path, encoding="utf-8", errors="replace").read()
    rss = re.search(r"Maximum resident set size \(kbytes\): (\d+)", txt)
    el = re.search(r"Elapsed \(wall clock\) time .*?: ([0-9:.]+)", txt)
    status = re.search(r"Exit status: (\d+)", txt)
    if not rss or not el:
        return None
    secs = 0.0
    for part in el.group(1).split(":"):
        secs = secs * 60 + float(part)
    return {
        "rss_mb": int(rss.group(1)) / 1024.0,
        "wall_s": secs,
        "exit": int(status.group(1)) if status else None,
    }


def med(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def mx(vals):
    vals = [v for v in vals if v is not None]
    return max(vals) if vals else None


def spread(vals):
    """Mediana y máximo de una lista de valores por repetición."""
    return {"med": med(vals), "max": mx(vals), "n": len([v for v in vals if v is not None])}


def render_points(recs, n):
    """Por una repetición: tiempos de página 1, central y media de 5 seguidas."""
    from_common_mid = n // 2 if n else 0
    out = {}
    rr_all = [r for r in recs if r.get("kind") == "render" and r.get("ok")]
    for w in WIDTHS:
        for ps in PASSES:
            rr = {r["page"]: r for r in rr_all if r["width"] == w and r["pass"] == ps}
            out[f"{w}_{ps}_p1"] = rr[0]["ms"] if 0 in rr else None
            out[f"{w}_{ps}_mid"] = rr[from_common_mid]["ms"] if from_common_mid in rr else None
            five = [rr[p]["ms"] for p in range(from_common_mid + 1, min(from_common_mid + 6, n)) if p in rr]
            out[f"{w}_{ps}_seq5"] = (sum(five) / len(five)) if five else None
    return out


def page_sizes(recs):
    pr = next((r for r in recs if r.get("kind") == "pages"), None)
    if not pr:
        return None
    sizes = [tuple(s) for s in pr.get("sizes", [])]
    if not sizes:
        return {"n": pr.get("n", 0), "distinct": 0}
    counts = {}
    for s in sizes:
        counts[s] = counts.get(s, 0) + 1
    top = max(counts.values())
    ws = [s[0] for s in sizes]
    hs = [s[1] for s in sizes]
    return {
        "n": pr.get("n"),
        "distinct": len(counts),
        "w_min": min(ws), "w_max": max(ws),
        "h_min": min(hs), "h_max": max(hs),
        "top_share": round(top / len(sizes), 3),
        "top_size": max(counts, key=counts.get),
        "size_errors": pr.get("errors", 0),
    }


def book_result(engine, book):
    bid = book["id"]
    per_run = {}
    time_main, time_par = [], []
    for tag in TAGS:
        recs = load_jsonl(os.path.join(OUT, "results", f"{engine}-{bid}-{tag}.jsonl"))
        if recs:
            per_run[tag] = recs
        t = parse_time(os.path.join(OUT, "time", f"{engine}-{bid}-{tag}.time"))
        if t:
            time_main.append(t)
    par_runs = {}
    for tag in TAGS:
        recs = load_jsonl(os.path.join(OUT, "results", f"{engine}-{bid}-par-{tag}.jsonl"))
        if recs:
            par_runs[tag] = recs
        t = parse_time(os.path.join(OUT, "time", f"{engine}-{bid}-par-{tag}.time"))
        if t:
            time_par.append(t)

    res = {"engine": engine, "book": bid, "rel": book["rel"], "bytes": book["bytes"], "runs": len(per_run)}
    if not per_run:
        res["missing"] = True
        return res

    first = per_run.get("r1", next(iter(per_run.values())))
    open_ok = [r for recs in per_run.values() for r in recs if r.get("kind") == "open"]
    res["open_ok"] = all(r.get("ok") for r in open_ok) if open_ok else False
    res["open_error"] = next((r.get("error") for r in open_ok if not r.get("ok")), None)
    res["open_ms"] = spread([r.get("ms") for r in open_ok if r.get("ok")])
    n = next((r["n"] for r in first if r.get("kind") == "pages"), 0)
    res["pages"] = n
    res["sizes"] = page_sizes(first)

    # Render por repetición y luego agregado.
    pts = {}
    for tag, recs in per_run.items():
        for k, v in render_points(recs, n).items():
            pts.setdefault(k, []).append(v)
    res["render"] = {k: spread(v) for k, v in pts.items()}

    # Codificación (página 1 y central) en la primera pasada.
    enc = {}
    for tag, recs in per_run.items():
        for r in recs:
            if r.get("kind") == "encode":
                key = f"{r['width']}_p{r['page']}"
                enc.setdefault(key, {}).setdefault("pack_ms", []).append(r["pack_ms"])
                enc[key].setdefault("jpeg_ms", []).append(r["jpeg85_ms"])
                enc[key].setdefault("jpeg_bytes", []).append(r["jpeg85_bytes"])
                enc[key].setdefault("bmp_ms", []).append(r["bmp_ms"])
                enc[key].setdefault("bmp_bytes", []).append(r["bmp_bytes"])
                enc[key].setdefault("w_px", []).append(r["w_px"])
                enc[key].setdefault("h_px", []).append(r["h_px"])
    res["encode"] = {k: {m: med(v) for m, v in d.items()} for k, d in enc.items()}

    # Texto con cajas, todas las páginas.
    texts = [r for recs in per_run.values() for r in recs if r.get("kind") == "text"]
    if texts:
        res["text"] = {
            "ms": spread([r["ms_total"] for r in texts]),
            "chars": texts[0]["chars"],
            "pages_with_text": texts[0]["pages_with_text"],
            "errors": max(r["errors"] for r in texts),
        }
        per_page = [x for x in texts[0].get("per_page_ms", [])]
        if per_page:
            res["text"]["page_ms_median"] = round(statistics.median(per_page), 3)
            res["text"]["page_ms_max"] = round(max(per_page), 3)

    # Búsqueda (solo en La fe explicada).
    searches = [r for recs in per_run.values() for r in recs if r.get("kind") == "search"]
    if searches:
        res["search"] = {
            "term": searches[0]["term"],
            "hits": searches[0]["hits"],
            "hits_all_runs": sorted({s["hits"] for s in searches}),
            "pages_hit": searches[0]["pages_hit"],
            "ref_count_text": searches[0]["ref_count_text"],
            "errors": max(s["errors"] for s in searches),
            "ms": spread([s["ms_total"] for s in searches]),
        }

    # Barrido a 300 px (solo la primera repetición): errores, páginas en blanco, proporciones.
    sweeps = [r for r in first if r.get("kind") == "sweep"]
    if sweeps:
        s = sweeps[0]
        res["sweep"] = {
            "errors": len(s["errors"]),
            "error_samples": s["errors"][:5],
            "blank": s["blank"],
            "ms": s["ms_total"],
            "ratios": s["ratios"],
        }

    res["rss_mb"] = spread([t["rss_mb"] for t in time_main])
    res["wall_s"] = spread([t["wall_s"] for t in time_main])
    res["exit_codes"] = sorted({t["exit"] for t in time_main if t["exit"] is not None})

    # Paralelo (solo libros con prueba en paralelo).
    pars = [r for recs in par_runs.values() for r in recs if r.get("kind") == "parallel"]
    if pars:
        res["parallel"] = {
            "k": pars[0]["k"],
            "pps_seq": spread([p["pps_seq"] for p in pars]),
            "pps_par": spread([p["pps_par"] for p in pars]),
            "speedup": spread([p["speedup"] for p in pars]),
            "rss_mb": spread([t["rss_mb"] for t in time_par]),
            "wall_s": spread([t["wall_s"] for t in time_par]),
        }
    res["done_ms"] = spread([r.get("ms_total") for recs in per_run.values() for r in recs if r.get("kind") == "done"])
    return res


def compare_sweeps(a, b):
    """Compara los barridos de dos motores página a página."""
    ra, rb = a["ratios"], b["ratios"]
    n = min(len(ra), len(rb))
    blank_mismatch, delta_big, both_err, one_err = [], [], 0, []
    for i in range(n):
        x, y = ra[i], rb[i]
        if x < 0 and y < 0:
            both_err += 1
            continue
        if x < 0 or y < 0:
            one_err.append(i)
            continue
        if (x < 0.0005) != (y < 0.0005):
            blank_mismatch.append(i)
        elif abs(x - y) > 0.02:
            delta_big.append(i)
    return {
        "pages": n,
        "blank_mismatch": blank_mismatch,
        "delta_gt_2pp": delta_big,
        "both_error": both_err,
        "one_error": one_err,
    }


def fmt(v, digits=1):
    if v is None:
        return "–"
    if isinstance(v, float):
        return f"{v:.{digits}f}"
    return str(v)


def med_str(d, digits=1):
    if not d or d.get("med") is None:
        return "–"
    return f"{d['med']:.{digits}f} ({d['max']:.{digits}f})"


def short(rel, n=34):
    name = os.path.basename(rel)
    return name if len(name) <= n else name[: n - 1] + "…"


def main():
    books = load_books()
    results = {e: {b["id"]: book_result(e, b) for b in books} for e in ENGINES}
    comparisons = {}
    for b in books:
        a, c = results["mupdf"][b["id"]], results["pdfium"][b["id"]]
        if "sweep" in a and "sweep" in c:
            comparisons[b["id"]] = compare_sweeps(a["sweep"], c["sweep"])

    with open(os.path.join(OUT, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(
            {"results": results, "sweep_comparison": comparisons},
            f, ensure_ascii=False, indent=1, default=str,
        )

    # --- Tablas: apertura, tamaño de páginas y render (mediana y máximo entre repeticiones) ---
    print("## Apertura y render (ms, mediana (máximo) de las repeticiones)\n")
    print("| id | libro | págs | abre MuPDF | abre PDFium | 1240 p1 1ª MU | 1240 p1 1ª PD | 1240 p1 2ª MU | 1240 p1 2ª PD | 2480 p1 1ª MU | 2480 p1 1ª PD | 2480 p1 2ª MU | 2480 p1 2ª PD |")
    print("|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for b in books:
        m, p = results["mupdf"][b["id"]], results["pdfium"][b["id"]]
        if m.get("missing") and p.get("missing"):
            print(f"| {b['id']} | {short(b['rel'])} | sin datos | | | | | | | | | | |")
            continue
        def g(r, k):
            return med_str(r.get("render", {}).get(k))
        print(
            f"| {b['id']} | {short(b['rel'])} | {m.get('pages', '–')}/{p.get('pages', '–')} "
            f"| {med_str(m.get('open_ms'))} | {med_str(p.get('open_ms'))} "
            f"| {g(m, '1240_first_p1')} | {g(p, '1240_first_p1')} "
            f"| {g(m, '1240_second_p1')} | {g(p, '1240_second_p1')} "
            f"| {g(m, '2480_first_p1')} | {g(p, '2480_first_p1')} "
            f"| {g(m, '2480_second_p1')} | {g(p, '2480_second_p1')} |"
        )

    print("\n## Render: páginas centrales y 5 seguidas (media de las 5), ms mediana (máximo)\n")
    print("| id | MU 1240 central 1ª | PD 1240 central 1ª | MU 1240 seq5 1ª | PD 1240 seq5 1ª | MU 2480 central 1ª | PD 2480 central 1ª | MU 2480 seq5 1ª | PD 2480 seq5 1ª |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|")
    for b in books:
        m, p = results["mupdf"][b["id"]], results["pdfium"][b["id"]]
        if m.get("missing") and p.get("missing"):
            continue
        cells = []
        for w in WIDTHS:
            for k in ("mid", "seq5"):
                key = f"{w}_first_{k}"
                cells.append(med_str(m.get("render", {}).get(key)))
                cells.append(med_str(p.get("render", {}).get(key)))
        print(f"| {b['id']} | " + " | ".join(cells) + " |")

    print("\n## Codificación (página 1, 1240 px y 2480 px): pack RGB, JPEG q85, BMP (ms y bytes)\n")
    print("| id | motor | ancho | w×h | pack ms | JPEG85 ms | JPEG85 KB | BMP ms | BMP MB |")
    print("|---|---|---:|---|---:|---:|---:|---:|---:|")
    for b in books:
        for e in ENGINES:
            r = results[e][b["id"]]
            for w in WIDTHS:
                d = r.get("encode", {}).get(f"{w}_p0")
                if not d:
                    continue
                print(
                    f"| {b['id']} | {e} | {w} | {int(d['w_px'])}×{int(d['h_px'])} | {fmt(d['pack_ms'], 2)} "
                    f"| {fmt(d['jpeg_ms'], 1)} | {fmt(d['jpeg_bytes'] / 1024, 0)} | {fmt(d['bmp_ms'], 1)} | {fmt(d['bmp_bytes'] / 1048576, 1)} |"
                )

    print("\n## Texto con cajas (todas las páginas) y búsqueda\n")
    print("| id | MU ms total | PD ms total | MU ms/pág mediana | PD ms/pág mediana | MU chars | PD chars | MU págs con texto | PD págs con texto | MU err | PD err |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for b in books:
        m, p = results["mupdf"][b["id"]], results["pdfium"][b["id"]]
        mt, pt = m.get("text", {}), p.get("text", {})
        if not mt and not pt:
            continue
        print(
            f"| {b['id']} | {med_str(mt.get('ms'))} | {med_str(pt.get('ms'))} "
            f"| {fmt(mt.get('page_ms_median'), 2)} | {fmt(pt.get('page_ms_median'), 2)} "
            f"| {mt.get('chars', '–')} | {pt.get('chars', '–')} "
            f"| {mt.get('pages_with_text', '–')} | {pt.get('pages_with_text', '–')} "
            f"| {mt.get('errors', '–')} | {pt.get('errors', '–')} |"
        )
    for e in ENGINES:
        for b in books:
            s = results[e][b["id"]].get("search")
            if s:
                print(f"\nBúsqueda «{s['term']}» en {b['rel']} ({e}): hits={s['hits']} (repeticiones: {s['hits_all_runs']}), "
                      f"páginas con acierto={s['pages_hit']}, recuento en texto={s['ref_count_text']}, "
                      f"tiempo={med_str(s['ms'])} ms, errores={s['errors']}")

    print("\n## Barrido a 300 px: errores, páginas en blanco (<0,05 % píxeles no blancos) y RSS\n")
    print("| id | págs | MU err | PD err | MU blancas | PD blancas | págs con discrepancia (blanco / Δ>2 pp) | MU RSS MB | PD RSS MB | MU s | PD s |")
    print("|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|")
    for b in books:
        m, p = results["mupdf"][b["id"]], results["pdfium"][b["id"]]
        if m.get("missing") and p.get("missing"):
            continue
        ms_, ps_ = m.get("sweep", {}), p.get("sweep", {})
        cmp_ = comparisons.get(b["id"])
        disc = f"{len(cmp_['blank_mismatch'])} / {len(cmp_['delta_gt_2pp'])} (+{len(cmp_['one_error'])} solo-error)" if cmp_ else "–"
        print(
            f"| {b['id']} | {m.get('pages', '–')} | {ms_.get('errors', '–')} | {ps_.get('errors', '–')} "
            f"| {len(ms_.get('blank', [])) if ms_ else '–'} | {len(ps_.get('blank', [])) if ps_ else '–'} "
            f"| {disc} | {med_str(m.get('rss_mb'), 0)} | {med_str(p.get('rss_mb'), 0)} "
            f"| {med_str(m.get('wall_s'), 1)} | {med_str(p.get('wall_s'), 1)} |"
        )

    print("\n## Paralelo (4 hilos frente a secuencial, 32 páginas a 1240 px)\n")
    print("| id | motor | pág/s secuencial | pág/s 4 hilos | aceleración | RSS MB (4 hilos) |")
    print("|---|---|---:|---:|---:|---:|")
    for b in books:
        for e in ENGINES:
            par = results[e][b["id"]].get("parallel")
            if not par:
                continue
            print(
                f"| {b['id']} | {e} | {med_str(par['pps_seq'], 2)} | {med_str(par['pps_par'], 2)} "
                f"| {med_str(par['speedup'], 2)} | {med_str(par['rss_mb'], 0)} |"
            )

    print("\n## Memoria y tiempo totales por ejecución (primer proceso de cada libro)\n")
    print("| motor | RSS máx. MB (mediana de todos los libros) | RSS máx. MB (peor libro) | tiempo de pared s (mediana) | códigos de salida |")
    print("|---|---:|---:|---:|---|")
    for e in ENGINES:
        rss = [results[e][b["id"]]["rss_mb"]["max"] for b in books if "rss_mb" in results[e][b["id"]]]
        wall = [results[e][b["id"]]["wall_s"]["med"] for b in books if "wall_s" in results[e][b["id"]]]
        codes = sorted({c for b in books for c in results[e][b["id"]].get("exit_codes", [])})
        if rss:
            print(f"| {e} | {statistics.median(rss):.0f} | {max(rss):.0f} | {statistics.median(wall):.1f} | {codes} |")

    print("\n## Muestras de la comparación de barridos (páginas con discrepancia)\n")
    for bid, c in comparisons.items():
        if c["blank_mismatch"] or c["delta_gt_2pp"] or c["one_error"]:
            print(f"- {bid}: blanco-distinto={c['blank_mismatch'][:10]} Δ>2pp={c['delta_gt_2pp'][:10]} "
                  f"solo-un-motor-error={c['one_error'][:10]} (páginas comparadas {c['pages']})")


if __name__ == "__main__":
    sys.exit(main())
