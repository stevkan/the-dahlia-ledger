"""Offline triplet-loss training of a linear projection on top of frozen DINOv2 embeddings.

This never runs in the Node/Azure backend -- it's a standalone offline tool. Its only output that
crosses into the app is a plain JSON file (a matrix of numbers), imported via
`npm run import:learned-projection --prefix backend -- --in <output> [--activate]`.

Usage:
    python train_projection.py --in ../backend/scripts/fixtures/training-embeddings.json \
        --out output/learned-projection.json
"""
import argparse
import json
import random
import time
from collections import defaultdict
from pathlib import Path

import torch
from torch import nn


def normalize_cultivar_key(value):
    return (value or "").strip().lower()


def load_dataset(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    by_cultivar = defaultdict(list)
    for photo in data["photos"]:
        key = normalize_cultivar_key(photo.get("cultivarName"))
        embedding = photo.get("embedding")
        if not key or not embedding:
            continue
        by_cultivar[key].append(torch.tensor(embedding, dtype=torch.float32))

    return data, by_cultivar


# Cultivars need >= 2 photos to form an anchor/positive pair at all; >= MIN_FOR_VAL to additionally
# hold one out for validation (mirrors MIN_PHOTOS_FOR_HOLDOUT in backend/scripts/build-photo-eval-set.js).
MIN_FOR_TRAINING = 2
MIN_FOR_VAL = 3


def split_train_val(by_cultivar, seed):
    rng = random.Random(seed)
    train, val = defaultdict(list), {}
    for key, vectors in by_cultivar.items():
        if len(vectors) < MIN_FOR_TRAINING:
            continue
        shuffled = vectors[:]
        rng.shuffle(shuffled)
        if len(shuffled) >= MIN_FOR_VAL:
            val[key] = shuffled[0]
            train[key] = shuffled[1:]
        else:
            train[key] = shuffled
    return train, val


def sample_triplets(train, batch_size, rng):
    keys = [k for k, v in train.items() if len(v) >= 2]
    if len(keys) < 2:
        raise ValueError("Need at least 2 cultivars with >= 2 photos each to train triplets.")

    anchors, positives, negatives = [], [], []
    for _ in range(batch_size):
        pos_key = rng.choice(keys)
        neg_key = rng.choice(keys)
        while neg_key == pos_key:
            neg_key = rng.choice(keys)

        a, p = rng.sample(train[pos_key], 2)
        n = rng.choice(train[neg_key])
        anchors.append(a)
        positives.append(p)
        negatives.append(n)

    return torch.stack(anchors), torch.stack(positives), torch.stack(negatives)


def evaluate_top1(projection, train, val):
    """For each held-out validation photo, predict its cultivar as the nearest per-cultivar mean of the
    (projected) training photos, and report accuracy. Used to compare identity vs. trained projection."""
    if not val:
        return None

    centroids = {}
    with torch.no_grad():
        for key, vectors in train.items():
            projected = nn.functional.normalize(projection(torch.stack(vectors)), dim=-1)
            centroids[key] = nn.functional.normalize(projected.mean(dim=0), dim=0)

    keys = list(centroids.keys())
    centroid_matrix = torch.stack([centroids[k] for k in keys])

    correct = 0
    with torch.no_grad():
        for true_key, vector in val.items():
            if true_key not in centroids:
                continue
            projected = nn.functional.normalize(projection(vector.unsqueeze(0)), dim=-1)
            sims = projected @ centroid_matrix.T
            predicted = keys[sims.argmax().item()]
            correct += int(predicted == true_key)

    return correct / len(val)


def train(args):
    data, by_cultivar = load_dataset(args.input)
    input_dim = len(next(iter(by_cultivar.values()))[0])

    train_set, val_set = split_train_val(by_cultivar, args.seed)
    print(f"Training on {sum(len(v) for v in train_set.values())} photos across {len(train_set)} cultivars "
          f"({len(val_set)} held out for validation).")

    projection = nn.Linear(input_dim, input_dim, bias=False)
    nn.init.eye_(projection.weight)  # start as a no-op so training only moves away from identity if it helps

    top1_before = evaluate_top1(projection, train_set, val_set)
    if top1_before is not None:
        print(f"Validation top-1 accuracy before training (identity projection): {top1_before:.3f}")

    optimizer = torch.optim.Adam(projection.parameters(), lr=args.lr)
    loss_fn = nn.TripletMarginLoss(margin=args.margin, p=2)
    rng = random.Random(args.seed)

    final_loss = None
    for epoch in range(args.epochs):
        epoch_loss = 0.0
        for _ in range(args.steps_per_epoch):
            anchors, positives, negatives = sample_triplets(train_set, args.batch_size, rng)
            a = nn.functional.normalize(projection(anchors), dim=-1)
            p = nn.functional.normalize(projection(positives), dim=-1)
            n = nn.functional.normalize(projection(negatives), dim=-1)

            loss = loss_fn(a, p, n)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()

        final_loss = epoch_loss / args.steps_per_epoch
        if (epoch + 1) % max(1, args.epochs // 10) == 0 or epoch == args.epochs - 1:
            print(f"epoch {epoch + 1}/{args.epochs}  loss={final_loss:.4f}")

    top1_after = evaluate_top1(projection, train_set, val_set)
    if top1_after is not None:
        print(f"Validation top-1 accuracy after training: {top1_after:.3f}")

    matrix = projection.weight.detach().tolist()
    output = {
        "projectionVersion": f"v{int(time.time())}",
        "matrix": matrix,
        "inputDim": input_dim,
        "outputDim": input_dim,
        "trainedAtPhotoCount": data.get("photoCount"),
        "trainedAtCultivarCount": data.get("cultivarCount"),
        "metrics": {
            "epochs": args.epochs,
            "finalLoss": final_loss,
            "valTop1Before": top1_before,
            "valTop1After": top1_after,
        },
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(f"Wrote {out_path}")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--in", dest="input", default="../backend/scripts/fixtures/training-embeddings.json")
    parser.add_argument("--out", dest="output", default="output/learned-projection.json")
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--steps-per-epoch", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--margin", type=float, default=0.2)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=1755202600)
    return parser.parse_args()


if __name__ == "__main__":
    train(parse_args())
