# eval_metrics.py

> 组委会落地时将本文件中的 Python 源码保存为同目录 `eval_metrics.py` 即可运行。
> （当前以 Markdown 交付，避免非 md 文件写入限制。）

## 用法

```bash
python eval_metrics.py \
  --labels /path/to/solar_flare_dataset_png_Lat60_Lon60_Th1000_test.csv \
  --preds predictions__M1_24h.csv \
  --label-col flare_label_M1.0_24hr \
  --id-col image_filename
```

可选：`--prob-col probability` 以计算 ROC-AUC / PR-AUC。

## 源码

```python
#!/usr/bin/env python3
"""JW-FD track metrics: TSS, HSS, F1, POD, FAR, etc."""

from __future__ import annotations

import argparse
import csv
import math
import sys
from typing import Dict, Iterable, List, Optional, Sequence, Tuple


def _f(x: str) -> Optional[float]:
    if x is None:
        return None
    s = str(x).strip()
    if s == "" or s.lower() in {"nan", "none", "null"}:
        return None
    return float(s)


def _i01(x: str) -> int:
    v = int(float(str(x).strip()))
    if v not in (0, 1):
        raise ValueError(f"expected 0/1, got {x!r}")
    return v


def load_col(path: str, id_col: str, value_col: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if id_col not in reader.fieldnames or value_col not in reader.fieldnames:
            raise SystemExit(
                f"{path}: need columns {id_col!r} and {value_col!r}; "
                f"got {reader.fieldnames}"
            )
        for row in reader:
            k = row[id_col].strip()
            out[k] = row[value_col]
    return out


def confusion(y_true: Sequence[int], y_pred: Sequence[int]) -> Tuple[int, int, int, int]:
    tp = fp = tn = fn = 0
    for t, p in zip(y_true, y_pred):
        if t == 1 and p == 1:
            tp += 1
        elif t == 0 and p == 1:
            fp += 1
        elif t == 0 and p == 0:
            tn += 1
        else:
            fn += 1
    return tp, fp, tn, fn


def safe_div(a: float, b: float) -> float:
    return a / b if b else 0.0


def metrics_from_counts(tp: int, fp: int, tn: int, fn: int) -> Dict[str, float]:
    pod = safe_div(tp, tp + fn)  # recall
    precision = safe_div(tp, tp + fp)
    far = safe_div(fp, tp + fp)
    acc = safe_div(tp + tn, tp + fp + tn + fn)
    f1 = safe_div(2 * precision * pod, precision + pod) if (precision + pod) else 0.0
    tss = pod - safe_div(fp, fp + tn)
    hss_den = (tp + fn) * (fn + tn) + (tp + fp) * (fp + tn)
    hss = safe_div(2 * (tp * tn - fp * fn), hss_den)
    return {
        "TP": float(tp),
        "FP": float(fp),
        "TN": float(tn),
        "FN": float(fn),
        "TSS": tss,
        "HSS": hss,
        "Precision": precision,
        "Recall_POD": pod,
        "F1": f1,
        "FAR": far,
        "Accuracy": acc,
    }


def auc_trapezoid(xs: List[float], ys: List[float]) -> float:
    area = 0.0
    for i in range(1, len(xs)):
        area += (xs[i] - xs[i - 1]) * (ys[i] + ys[i - 1]) / 2.0
    return area


def roc_pr_auc(y_true: Sequence[int], scores: Sequence[float]) -> Tuple[Optional[float], Optional[float]]:
    n_pos = sum(y_true)
    n_neg = len(y_true) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None, None
    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    tp = 0
    fp = 0
    roc_x: List[float] = [0.0]
    roc_y: List[float] = [0.0]
    pr_x: List[float] = [0.0]
    pr_y: List[float] = [1.0]
    for i in order:
        if y_true[i] == 1:
            tp += 1
        else:
            fp += 1
        tpr = tp / n_pos
        fpr = fp / n_neg
        roc_x.append(fpr)
        roc_y.append(tpr)
        rec = tp / n_pos
        prec = tp / (tp + fp)
        pr_x.append(rec)
        pr_y.append(prec)
    return auc_trapezoid(roc_x, roc_y), auc_trapezoid(pr_x, pr_y)


def align(
    labels: Dict[str, str],
    preds: Dict[str, str],
    probs: Optional[Dict[str, str]],
) -> Tuple[List[int], List[int], Optional[List[float]]]:
    missing = [k for k in labels if k not in preds]
    extra = [k for k in preds if k not in labels]
    if missing:
        raise SystemExit(f"predictions missing {len(missing)} label ids, e.g. {missing[:3]}")
    if extra:
        print(f"warning: {len(extra)} pred ids not in labels (ignored)", file=sys.stderr)
    y_true: List[int] = []
    y_pred: List[int] = []
    scores: List[float] = []
    use_prob = probs is not None
    for k, raw in labels.items():
        y_true.append(_i01(raw))
        y_pred.append(_i01(preds[k]))
        if use_prob:
            p = _f(probs.get(k, ""))  # type: ignore[union-attr]
            if p is None:
                use_prob = False
            else:
                scores.append(p)
    return y_true, y_pred, scores if use_prob else None


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Compute TSS/HSS/F1 for JW-FD track")
    ap.add_argument("--labels", required=True, help="label CSV (e.g. official test)")
    ap.add_argument("--preds", required=True, help="prediction CSV")
    ap.add_argument("--label-col", required=True, help="binary label column in labels CSV")
    ap.add_argument("--id-col", default="image_filename")
    ap.add_argument("--pred-col", default="prediction")
    ap.add_argument("--prob-col", default="probability")
    args = ap.parse_args(argv)

    lab = load_col(args.labels, args.id_col, args.label_col)
    pred_map = load_col(args.preds, args.id_col, args.pred_col)
    prob_map = None
    with open(args.preds, newline="", encoding="utf-8") as f:
        fields = csv.DictReader(f).fieldnames or []
    if args.prob_col in fields:
        prob_map = load_col(args.preds, args.id_col, args.prob_col)

    y_true, y_pred, scores = align(lab, pred_map, prob_map)
    tp, fp, tn, fn = confusion(y_true, y_pred)
    m = metrics_from_counts(tp, fp, tn, fn)
    if scores is not None:
        roc, pr = roc_pr_auc(y_true, scores)
        m["ROC_AUC"] = roc if roc is not None else float("nan")
        m["PR_AUC"] = pr if pr is not None else float("nan")

    for k, v in m.items():
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            print(f"{k}\tNA")
        elif isinstance(v, float) and k in {"TP", "FP", "TN", "FN"}:
            print(f"{k}\t{int(v)}")
        else:
            print(f"{k}\t{v:.6f}" if isinstance(v, float) else f"{k}\t{v}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```
