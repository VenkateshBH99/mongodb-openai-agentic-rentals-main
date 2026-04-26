"""
Python backend server — serves rental data from Normalized JSON files
and MLP Fusion model recommendations. No MongoDB dependency.

Data sources (all from Normalized/ directory):
  - airbnb_listings.json          → 5,555 listings
  - airbnb_address.json           → addresses with lat/lon
  - airbnb_images.json            → image URLs
  - airbnb_hosts.json             → host info
  - airbnb_amenities.json         → amenities per listing
  - listing_host_map.json         → listing → host mapping
  - eda_outputs_new1/user_listing_interactions.json → user interactions

Embeddings (from recommendation_outputs_new1/):
  - listing_ids.npy               → 4,545 aligned listing IDs
  - emb_struct.npy                → (4545, 101) structured features
  - emb_text.npy                  → (4545, 500) TF-IDF text
  - emb_clip.npy                  → (4545, 512) CLIP image

Model (from model/):
  - mlp_fusion_model.pt           → trained MLP Fusion (BCE)
"""

import json
import os
import time
import math

import numpy as np
import torch
import torch.nn as nn
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# ─────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
NORM_DIR = os.path.join(BASE_DIR, "Normalized")
EMB_DIR = os.path.join(NORM_DIR, "recommendation_outputs_new1")
MODEL_DIR = os.path.join(BASE_DIR, "model")

app = Flask(__name__)
CORS(app)


# ─────────────────────────────────────────────────────────────────
# MLP Fusion Model Definition (must match training architecture)
# ─────────────────────────────────────────────────────────────────
class FusionMLP(nn.Module):
    """
    MLP(user_emb || item_emb) -> relevance score.
    Input: 2226-d (1113 user + 1113 item)
    Layers: 512 -> 256 -> 128 -> 1 with BatchNorm + ReLU + Dropout
    """
    def __init__(self, user_dim, item_dim, dropout=0.3):
        super().__init__()
        input_dim = user_dim + item_dim
        self.network = nn.Sequential(
            nn.Linear(input_dim, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(512, 256),
            nn.BatchNorm1d(256),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.Dropout(dropout / 2),
            nn.Linear(128, 1),
            nn.Sigmoid(),
        )

    def forward(self, user_emb, item_emb):
        x = torch.cat([user_emb, item_emb], dim=1)
        return self.network(x).squeeze(-1)


# ─────────────────────────────────────────────────────────────────
# Data Store — loaded once at startup
# ─────────────────────────────────────────────────────────────────
class DataStore:
    def __init__(self):
        self.listings = {}          # listing_id -> full listing dict
        self.listing_ids_list = []  # ordered list of all listing IDs
        self.user_interactions = {} # reviewer_id -> [listing_id, ...]

        # Embeddings (numpy)
        self.emb_listing_ids = None # (4545,) aligned IDs for embeddings
        self.lid_to_idx = {}        # listing_id -> embedding index
        self.item_embeddings = None # (4545, 1113) struct+text+clip
        self.item_dim = 0

        # MLP model
        self.model = None
        self.device = torch.device("cpu")

        # Pre-computed item tensor for inference
        self.item_tensor = None

    def load(self):
        t0 = time.time()
        print("Loading data from Normalized/ directory...")

        # 1. Listings
        with open(os.path.join(NORM_DIR, "airbnb_listings.json")) as f:
            raw_listings = json.load(f)
        print(f"  Listings: {len(raw_listings)}")

        # 2. Addresses
        with open(os.path.join(NORM_DIR, "airbnb_address.json")) as f:
            addresses = {a["listing_id"]: a for a in json.load(f)}
        print(f"  Addresses: {len(addresses)}")

        # 3. Images
        with open(os.path.join(NORM_DIR, "airbnb_images.json")) as f:
            images = {i["listing_id"]: i for i in json.load(f)}
        print(f"  Images: {len(images)}")

        # 4. Hosts
        with open(os.path.join(NORM_DIR, "airbnb_hosts.json")) as f:
            hosts_list = json.load(f)
        hosts = {h["host_id"]: h for h in hosts_list}
        print(f"  Hosts: {len(hosts)}")

        # 5. Host-listing map
        with open(os.path.join(NORM_DIR, "listing_host_map.json")) as f:
            host_map = {m["listing_id"]: m["host_id"] for m in json.load(f)}

        # 6. Amenities (group by listing)
        with open(os.path.join(NORM_DIR, "airbnb_amenities.json")) as f:
            amenities_raw = json.load(f)
        amenities = {}
        for a in amenities_raw:
            lid = a["listing_id"]
            if lid not in amenities:
                amenities[lid] = []
            amenities[lid].append(a["amenity"])
        print(f"  Amenities: {len(amenities)} listings")

        # 7. Merge into unified listing objects
        for listing in raw_listings:
            lid = listing["listing_id"]
            addr = addresses.get(lid, {})
            img = images.get(lid, {})
            hid = host_map.get(lid)
            host = hosts.get(str(hid), {}) if hid else {}

            listing["address"] = {
                "street": addr.get("street", ""),
                "suburb": addr.get("suburb", ""),
                "government_area": addr.get("government_area", ""),
                "market": addr.get("market", ""),
                "country": addr.get("country", ""),
                "country_code": addr.get("country_code", ""),
            }
            listing["location"] = {
                "type": addr.get("location_type", "Point"),
                "coordinates": [
                    addr.get("longitude", 0),
                    addr.get("latitude", 0),
                ],
            }
            listing["images"] = {
                "picture_url": img.get("picture_url", ""),
                "thumbnail_url": img.get("thumbnail_url", ""),
                "medium_url": img.get("medium_url", ""),
                "xl_picture_url": img.get("xl_picture_url", ""),
            }
            listing["host"] = {
                "host_id": host.get("host_id", ""),
                "host_name": host.get("host_name", ""),
                "host_is_superhost": host.get("host_is_superhost", False),
                "host_location": host.get("host_location", ""),
            }
            listing["amenities"] = amenities.get(lid, [])

            self.listings[lid] = listing

        self.listing_ids_list = sorted(self.listings.keys())
        print(f"  Merged listings: {len(self.listings)}")

        # 8. User interactions
        with open(os.path.join(NORM_DIR, "eda_outputs_new1", "user_listing_interactions.json")) as f:
            interactions = json.load(f)
        for inter in interactions:
            rid = inter.get("reviewer_id")
            lid = inter.get("listing_id")
            if rid is None or lid is None:
                continue
            uid = str(int(rid))
            if uid not in self.user_interactions:
                self.user_interactions[uid] = []
            self.user_interactions[uid].append(lid)
        print(f"  User interactions: {len(interactions)} ({len(self.user_interactions)} users)")

        # 9. Load embeddings
        self.emb_listing_ids = np.load(os.path.join(EMB_DIR, "listing_ids.npy"))
        self.lid_to_idx = {int(lid): i for i, lid in enumerate(self.emb_listing_ids)}

        struct_emb = np.load(os.path.join(EMB_DIR, "emb_struct.npy"))
        text_emb = np.load(os.path.join(EMB_DIR, "emb_text.npy"))
        clip_emb = np.load(os.path.join(EMB_DIR, "emb_clip.npy"))

        self.item_embeddings = np.hstack([struct_emb, text_emb, clip_emb]).astype(np.float32)
        self.clip_embeddings = clip_emb.astype(np.float32)
        self.struct_embeddings = struct_emb.astype(np.float32)
        self.text_embeddings = text_emb.astype(np.float32)
        self.item_dim = self.item_embeddings.shape[1]
        print(f"  Item embeddings: {self.item_embeddings.shape} (dim={self.item_dim})")
        print(f"  CLIP embeddings: {self.clip_embeddings.shape}")

        # Pre-compute normalized embeddings for cosine similarity
        norms = np.linalg.norm(self.item_embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1
        self.item_embeddings_normed = self.item_embeddings / norms

        clip_norms = np.linalg.norm(self.clip_embeddings, axis=1, keepdims=True)
        clip_norms[clip_norms == 0] = 1
        self.clip_embeddings_normed = self.clip_embeddings / clip_norms

        # 10. Load MLP Fusion model
        self.model = FusionMLP(self.item_dim, self.item_dim)
        state_dict = torch.load(
            os.path.join(MODEL_DIR, "mlp_fusion_model.pt"),
            map_location=self.device,
            weights_only=True,
        )
        self.model.load_state_dict(state_dict)
        self.model.eval()
        self.item_tensor = torch.from_numpy(self.item_embeddings).to(self.device)
        print(f"  MLP Fusion model loaded (input_dim={self.item_dim * 2})")

        print(f"Data loaded in {time.time() - t0:.1f}s")

    def build_user_embedding(self, listing_ids):
        """Mean-pool item embeddings for a user's interacted listings."""
        idxs = [self.lid_to_idx[lid] for lid in listing_ids if lid in self.lid_to_idx]
        if idxs:
            return self.item_embeddings[idxs].mean(axis=0)
        return self.item_embeddings.mean(axis=0)

    def get_mlp_recommendations(self, user_id, top_k=10):
        """Score all items for a user using the MLP model and return top-K."""
        uid = str(int(float(user_id)))
        user_lids = self.user_interactions.get(uid, [])

        if not user_lids:
            return None, "unknown_user"

        user_emb = self.build_user_embedding(user_lids)
        user_tensor = torch.from_numpy(user_emb.astype(np.float32)).unsqueeze(0).to(self.device)

        # Score all items in chunks
        interacted_set = set(self.lid_to_idx.get(lid, -1) for lid in user_lids)
        n_items = len(self.emb_listing_ids)

        all_scores = np.zeros(n_items, dtype=np.float32)
        CHUNK = 512

        with torch.no_grad():
            for start in range(0, n_items, CHUNK):
                end = min(start + CHUNK, n_items)
                chunk_items = self.item_tensor[start:end]
                batch_user = user_tensor.expand(end - start, -1)
                scores = self.model(batch_user, chunk_items).cpu().numpy()
                all_scores[start:end] = scores

        # Exclude already-interacted items
        for idx in interacted_set:
            if 0 <= idx < n_items:
                all_scores[idx] = -1.0

        # Get top-K indices
        top_indices = np.argsort(all_scores)[::-1][:top_k]

        results = []
        for rank, idx in enumerate(top_indices, 1):
            lid = int(self.emb_listing_ids[idx])
            listing = self.listings.get(lid)
            if listing:
                results.append({
                    "rank": rank,
                    "score": float(all_scores[idx]),
                    "listing": listing,
                })

        return results, "personalized"

    def get_popular_listings(self, top_k=10):
        """Fallback: return listings with most interactions."""
        # Count interactions per listing
        counts = {}
        for uid, lids in self.user_interactions.items():
            for lid in lids:
                counts[lid] = counts.get(lid, 0) + 1
        sorted_lids = sorted(counts, key=counts.get, reverse=True)[:top_k]

        results = []
        for rank, lid in enumerate(sorted_lids, 1):
            listing = self.listings.get(lid)
            if listing:
                results.append({
                    "rank": rank,
                    "score": counts[lid],
                    "listing": listing,
                })
        return results

    def get_similar_listings(self, listing_id, top_k=10):
        """Find listings most similar to a given listing using full embeddings."""
        idx = self.lid_to_idx.get(listing_id)
        if idx is None:
            return []

        query = self.item_embeddings_normed[idx:idx+1]
        sims = query @ self.item_embeddings_normed.T
        sims = sims.flatten()
        sims[idx] = -1  # exclude self

        top_indices = np.argsort(sims)[::-1][:top_k]
        results = []
        for rank, i in enumerate(top_indices, 1):
            lid = int(self.emb_listing_ids[i])
            listing = self.listings.get(lid)
            if listing:
                results.append({
                    "rank": rank,
                    "score": float(sims[i]),
                    "listing": listing,
                })
        return results

    def find_by_clip_embedding(self, clip_vector, top_k=10):
        """Find listings most similar to a CLIP embedding vector."""
        clip_vector = clip_vector.astype(np.float32).reshape(1, -1)
        norm = np.linalg.norm(clip_vector)
        if norm > 0:
            clip_vector = clip_vector / norm
        sims = clip_vector @ self.clip_embeddings_normed.T
        sims = sims.flatten()

        top_indices = np.argsort(sims)[::-1][:top_k]
        results = []
        for rank, i in enumerate(top_indices, 1):
            lid = int(self.emb_listing_ids[i])
            listing = self.listings.get(lid)
            if listing:
                results.append({
                    "rank": rank,
                    "score": float(sims[i]),
                    "listing": listing,
                })
        return results

    def find_multimodal(self, clip_vector=None, text_query=None,
                        struct_filters=None, top_k=10,
                        w_image=0.4, w_text=0.3, w_struct=0.1, w_mlp=0.2):
        """Combined multi-modal search: image + text + struct → full 1113d
        query embedding, scored via both cosine similarity and MLP."""
        n = len(self.emb_listing_ids)
        scores_image = np.zeros(n, dtype=np.float32)
        scores_text = np.zeros(n, dtype=np.float32)
        scores_struct = np.zeros(n, dtype=np.float32)
        scores_mlp = np.zeros(n, dtype=np.float32)
        active_weights = {}

        # ── Image modality ─────────────────────────────────────
        query_clip = np.zeros(self.clip_embeddings.shape[1], dtype=np.float32)
        if clip_vector is not None:
            cv = clip_vector.astype(np.float32).reshape(1, -1)
            norm = np.linalg.norm(cv)
            if norm > 0:
                cv = cv / norm
            scores_image = (cv @ self.clip_embeddings_normed.T).flatten()
            query_clip = cv.flatten()
            active_weights['image'] = w_image

        # ── Text modality ──────────────────────────────────────
        query_text = np.zeros(self.text_embeddings.shape[1], dtype=np.float32)
        if text_query:
            q = text_query.lower()
            matched_idxs = []
            for i, lid in enumerate(self.emb_listing_ids):
                listing = self.listings.get(int(lid))
                if not listing:
                    continue
                searchable = " ".join([
                    listing.get("name", ""),
                    listing.get("summary", ""),
                    listing.get("property_type", ""),
                    listing.get("room_type", ""),
                    listing.get("address", {}).get("market", ""),
                    listing.get("address", {}).get("country", ""),
                    " ".join(listing.get("amenities", [])),
                ]).lower()
                # Match if ANY query word appears in the listing text
                words = q.split()
                if any(w in searchable for w in words):
                    matched_idxs.append(i)

            if matched_idxs:
                # Build a query text embedding from matched listings
                query_text = self.text_embeddings[matched_idxs].mean(axis=0)
                # Normalize
                text_normed = self.text_embeddings.copy()
                tn = np.linalg.norm(text_normed, axis=1, keepdims=True)
                tn[tn == 0] = 1
                text_normed = text_normed / tn
                qt = query_text.reshape(1, -1)
                qtn = np.linalg.norm(qt)
                if qtn > 0:
                    qt = qt / qtn
                scores_text = (qt @ text_normed.T).flatten()
            active_weights['text'] = w_text

        # ── Structural modality ────────────────────────────────
        query_struct = np.zeros(self.struct_embeddings.shape[1], dtype=np.float32)
        if struct_filters:
            matched_struct_idxs = []
            for i, lid in enumerate(self.emb_listing_ids):
                listing = self.listings.get(int(lid))
                if not listing:
                    continue
                match = True
                if struct_filters.get('property_type'):
                    if listing.get('property_type', '').lower() != struct_filters['property_type'].lower():
                        match = False
                if struct_filters.get('min_price') is not None:
                    if (listing.get('price') or 0) < struct_filters['min_price']:
                        match = False
                if struct_filters.get('max_price') is not None:
                    if (listing.get('price') or 0) > struct_filters['max_price']:
                        match = False
                if struct_filters.get('bedrooms') is not None:
                    if (listing.get('bedrooms') or 0) < struct_filters['bedrooms']:
                        match = False
                if match:
                    matched_struct_idxs.append(i)

            if matched_struct_idxs:
                query_struct = self.struct_embeddings[matched_struct_idxs].mean(axis=0)
                struct_normed = self.struct_embeddings.copy()
                sn = np.linalg.norm(struct_normed, axis=1, keepdims=True)
                sn[sn == 0] = 1
                struct_normed = struct_normed / sn
                qs = query_struct.reshape(1, -1)
                qsn = np.linalg.norm(qs)
                if qsn > 0:
                    qs = qs / qsn
                scores_struct = (qs @ struct_normed.T).flatten()
            active_weights['struct'] = w_struct

        # ── MLP modality ───────────────────────────────────────
        # Build a pseudo-user embedding from the three modality vectors
        combined_emb = np.concatenate([query_struct, query_text, query_clip]).astype(np.float32)
        norm_c = np.linalg.norm(combined_emb)
        if norm_c > 0:
            user_tensor = torch.from_numpy(combined_emb).unsqueeze(0).to(self.device)
            CHUNK = 512
            with torch.no_grad():
                for start in range(0, n, CHUNK):
                    end = min(start + CHUNK, n)
                    chunk_items = self.item_tensor[start:end]
                    batch_user = user_tensor.expand(end - start, -1)
                    s = self.model(batch_user, chunk_items).cpu().numpy()
                    scores_mlp[start:end] = s
            active_weights['mlp'] = w_mlp

        # ── Weighted combination ───────────────────────────────
        if not active_weights:
            return []

        total_w = sum(active_weights.values())
        final_scores = np.zeros(n, dtype=np.float32)
        if 'image' in active_weights:
            final_scores += (active_weights['image'] / total_w) * scores_image
        if 'text' in active_weights:
            final_scores += (active_weights['text'] / total_w) * scores_text
        if 'struct' in active_weights:
            final_scores += (active_weights['struct'] / total_w) * scores_struct
        if 'mlp' in active_weights:
            final_scores += (active_weights['mlp'] / total_w) * scores_mlp

        # Hard-filter: exclude listings that violate structural constraints
        if struct_filters:
            for i, lid in enumerate(self.emb_listing_ids):
                listing = self.listings.get(int(lid))
                if not listing:
                    final_scores[i] = -np.inf
                    continue
                price = listing.get('price') or 0
                if struct_filters.get('min_price') is not None and price < struct_filters['min_price']:
                    final_scores[i] = -np.inf
                if struct_filters.get('max_price') is not None and price > struct_filters['max_price']:
                    final_scores[i] = -np.inf
                if struct_filters.get('property_type'):
                    if listing.get('property_type', '').lower() != struct_filters['property_type'].lower():
                        final_scores[i] = -np.inf
                if struct_filters.get('bedrooms') is not None:
                    if (listing.get('bedrooms') or 0) < struct_filters['bedrooms']:
                        final_scores[i] = -np.inf

        top_indices = np.argsort(final_scores)[::-1][:top_k]
        results = []
        modalities_used = list(active_weights.keys())
        for rank, idx in enumerate(top_indices, 1):
            if final_scores[idx] == -np.inf:
                continue
            lid = int(self.emb_listing_ids[idx])
            listing = self.listings.get(lid)
            if listing:
                results.append({
                    "rank": rank,
                    "score": float(final_scores[idx]),
                    "breakdown": {
                        "image": float(scores_image[idx]),
                        "text": float(scores_text[idx]),
                        "struct": float(scores_struct[idx]),
                        "mlp": float(scores_mlp[idx]),
                    },
                    "listing": listing,
                })
        return results, modalities_used


# ─────────────────────────────────────────────────────────────────
# Initialize data store
# ─────────────────────────────────────────────────────────────────
store = DataStore()
store.load()


# ─────────────────────────────────────────────────────────────────
# API Routes
# ─────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "data_source": "Normalized JSON files",
        "total_listings": len(store.listings),
        "total_users": len(store.user_interactions),
        "embeddings": len(store.emb_listing_ids),
        "model": "MLP Fusion (BCE)",
        "model_input_dim": store.item_dim * 2,
    })


@app.route("/api")
def api_info():
    return jsonify({
        "message": "Rental App API — powered by MLP Fusion Model",
        "version": "2.0.0",
        "data_source": "Local JSON files (no database)",
        "model": "MLP Fusion (BCE) — multi-modal neural recommendation",
        "endpoints": {
            "GET /health": "Health check",
            "GET /rentals": "List rentals (paginated, filterable)",
            "GET /rentals/:id": "Get rental by ID",
            "GET /search": "Search rentals by text",
            "GET /stats": "Dataset statistics",
            "GET /recommendations/:userId": "MLP model recommendations",
            "GET /recommendations": "Model info",
        },
    })


@app.route("/rentals")
def list_rentals():
    page = int(request.args.get("page", 1))
    limit = min(int(request.args.get("limit", 20)), 100)
    property_type = request.args.get("property_type", "")
    room_type = request.args.get("room_type", "")
    min_price = request.args.get("min_price", type=float)
    max_price = request.args.get("max_price", type=float)
    bedrooms = request.args.get("bedrooms", type=int)
    market = request.args.get("market", "")
    country = request.args.get("country", "")
    sort_by = request.args.get("sort", "price_asc")

    results = list(store.listings.values())

    # Apply filters
    if property_type:
        results = [r for r in results if r.get("property_type", "").lower() == property_type.lower()]
    if room_type:
        results = [r for r in results if r.get("room_type", "").lower() == room_type.lower()]
    if min_price is not None:
        results = [r for r in results if (r.get("price") or 0) >= min_price]
    if max_price is not None:
        results = [r for r in results if (r.get("price") or 0) <= max_price]
    if bedrooms is not None:
        results = [r for r in results if (r.get("bedrooms") or 0) >= bedrooms]
    if market:
        results = [r for r in results if market.lower() in (r.get("address", {}).get("market", "") or "").lower()]
    if country:
        results = [r for r in results if country.lower() in (r.get("address", {}).get("country", "") or "").lower()]

    # Sort
    if sort_by == "price_asc":
        results.sort(key=lambda r: r.get("price") or 0)
    elif sort_by == "price_desc":
        results.sort(key=lambda r: r.get("price") or 0, reverse=True)
    elif sort_by == "name":
        results.sort(key=lambda r: (r.get("name") or "").lower())

    total = len(results)
    total_pages = math.ceil(total / limit) if limit > 0 else 1
    start = (page - 1) * limit
    paged = results[start : start + limit]

    return jsonify({
        "success": True,
        "data": paged,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    })


@app.route("/rentals/<int:listing_id>")
def get_rental(listing_id):
    listing = store.listings.get(listing_id)
    if not listing:
        return jsonify({"success": False, "error": "Listing not found"}), 404
    return jsonify({"success": True, "data": listing})


@app.route("/search")
def search_rentals():
    q = (request.args.get("q", "") or "").strip().lower()
    page = int(request.args.get("page", 1))
    limit = min(int(request.args.get("limit", 20)), 100)
    min_price = request.args.get("min_price", type=float)
    max_price = request.args.get("max_price", type=float)
    property_type = request.args.get("property_type", "")
    bedrooms = request.args.get("bedrooms", type=int)
    accommodates = request.args.get("accommodates", type=int)

    if not q and not any([min_price, max_price, property_type, bedrooms, accommodates]):
        return jsonify({"success": True, "data": [], "total": 0, "page": 1, "limit": limit, "total_pages": 0})

    results = []
    for listing in store.listings.values():
        # Text search
        if q:
            searchable = " ".join([
                listing.get("name", ""),
                listing.get("summary", ""),
                listing.get("description", ""),
                listing.get("property_type", ""),
                listing.get("room_type", ""),
                listing.get("address", {}).get("market", ""),
                listing.get("address", {}).get("country", ""),
                listing.get("address", {}).get("street", ""),
                " ".join(listing.get("amenities", [])),
            ]).lower()
            if q not in searchable:
                continue

        # Filters
        if min_price is not None and (listing.get("price") or 0) < min_price:
            continue
        if max_price is not None and (listing.get("price") or 0) > max_price:
            continue
        if property_type and listing.get("property_type", "").lower() != property_type.lower():
            continue
        if bedrooms is not None and (listing.get("bedrooms") or 0) < bedrooms:
            continue
        if accommodates is not None and (listing.get("accommodates") or 0) < accommodates:
            continue

        results.append(listing)

    total = len(results)
    total_pages = math.ceil(total / limit) if limit > 0 else 1
    start = (page - 1) * limit
    paged = results[start : start + limit]

    return jsonify({
        "success": True,
        "data": paged,
        "total": total,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    })


@app.route("/stats")
def stats():
    prices = [l.get("price", 0) for l in store.listings.values() if l.get("price")]
    property_types = {}
    markets = {}
    for l in store.listings.values():
        pt = l.get("property_type", "Unknown")
        property_types[pt] = property_types.get(pt, 0) + 1
        m = l.get("address", {}).get("market", "Unknown")
        markets[m] = markets.get(m, 0) + 1

    return jsonify({
        "success": True,
        "total_listings": len(store.listings),
        "total_users": len(store.user_interactions),
        "total_interactions": sum(len(v) for v in store.user_interactions.values()),
        "listings_with_embeddings": len(store.emb_listing_ids),
        "price_stats": {
            "min": min(prices) if prices else 0,
            "max": max(prices) if prices else 0,
            "avg": round(sum(prices) / len(prices), 2) if prices else 0,
            "median": sorted(prices)[len(prices) // 2] if prices else 0,
        },
        "property_types": dict(sorted(property_types.items(), key=lambda x: -x[1])),
        "markets": dict(sorted(markets.items(), key=lambda x: -x[1])[:15]),
        "model": {
            "name": "MLP Fusion (BCE)",
            "type": "Multi-modal Neural Recommendation",
            "input_dim": store.item_dim * 2,
            "modalities": ["Structured (101d)", "TF-IDF Text (500d)", "CLIP Image (512d)"],
            "architecture": "2226 -> 512 -> 256 -> 128 -> 1",
        },
    })


@app.route("/recommendations/<user_id>")
def get_recommendations(user_id):
    top_k = min(int(request.args.get("top_k", 10)), 50)

    results, source = store.get_mlp_recommendations(user_id, top_k=top_k)

    if results is None:
        # Unknown user — return popular listings
        popular = store.get_popular_listings(top_k)
        return jsonify({
            "success": True,
            "source": "popular",
            "model": "MLP Fusion (BCE)",
            "message": f"User {user_id} not found. Showing popular listings.",
            "data": popular,
            "total": len(popular),
        })

    return jsonify({
        "success": True,
        "source": source,
        "model": "MLP Fusion (BCE)",
        "user_id": user_id,
        "interactions": len(store.user_interactions.get(str(int(float(user_id))), [])),
        "data": results,
        "total": len(results),
    })


@app.route("/recommendations")
def recommendation_info():
    return jsonify({
        "success": True,
        "model": "MLP Fusion (BCE)",
        "description": "Multi-modal neural recommendation model combining structured, text (TF-IDF), and image (CLIP) features",
        "architecture": {
            "input": "user_embedding(1113d) || item_embedding(1113d) = 2226d",
            "layers": "2226 -> 512 -> 256 -> 128 -> 1",
            "activation": "BatchNorm + ReLU + Dropout",
            "output": "Sigmoid (relevance score 0-1)",
        },
        "modalities": {
            "structured": "101 features (price, amenities, location, host)",
            "text": "500d TF-IDF (listing description + reviews)",
            "image": "512d CLIP embeddings",
        },
        "total_users": len(store.user_interactions),
        "total_items": len(store.emb_listing_ids),
        "total_listings": len(store.listings),
    })


@app.route("/users/<user_id>")
def get_user(user_id):
    uid = str(int(float(user_id)))
    lids = store.user_interactions.get(uid, [])
    if not lids:
        return jsonify({"success": False, "error": "User not found"}), 404

    history = []
    for lid in lids:
        listing = store.listings.get(lid)
        if listing:
            history.append({
                "listing_id": lid,
                "name": listing.get("name", ""),
                "price": listing.get("price"),
                "property_type": listing.get("property_type", ""),
                "image": listing.get("images", {}).get("picture_url", ""),
                "market": listing.get("address", {}).get("market", ""),
            })

    return jsonify({
        "success": True,
        "user_id": uid,
        "total_interactions": len(lids),
        "history": history,
    })


@app.route("/similar/<int:listing_id>")
def get_similar(listing_id):
    top_k = min(int(request.args.get("top_k", 10)), 50)
    results = store.get_similar_listings(listing_id, top_k=top_k)
    if not results:
        return jsonify({"success": False, "error": "Listing not found or no embeddings available"}), 404
    return jsonify({
        "success": True,
        "source": "cosine_similarity",
        "model": "MLP Fusion Embeddings (Struct + TF-IDF + CLIP)",
        "reference_listing": listing_id,
        "data": results,
        "total": len(results),
    })


@app.route("/upload-search", methods=["POST"])
def upload_search():
    """Multi-modal search: combine image + text + structural features.
    All inputs are optional but at least one must be provided."""
    from PIL import Image
    import io

    top_k = min(int(request.form.get("top_k", 10)), 50)
    text_query = (request.form.get("text", "") or "").strip()
    property_type = (request.form.get("property_type", "") or "").strip()
    min_price = request.form.get("min_price", type=float)
    max_price = request.form.get("max_price", type=float)
    bedrooms = request.form.get("bedrooms", type=int)

    # ── Image feature extraction ───────────────────────────
    clip_vector = None
    has_image = "image" in request.files and request.files["image"].filename
    if has_image:
        file = request.files["image"]
        try:
            img = Image.open(io.BytesIO(file.read())).convert("RGB")
        except Exception:
            return jsonify({"success": False, "error": "Invalid image file"}), 400

        img_resized = img.resize((224, 224))
        img_arr = np.array(img_resized, dtype=np.float32) / 255.0

        features = []
        for c in range(3):
            hist, _ = np.histogram(img_arr[:, :, c], bins=64, range=(0, 1))
            features.append(hist.astype(np.float32))
        h, w = img_arr.shape[:2]
        for gi in range(4):
            for gj in range(4):
                patch = img_arr[gi*h//4:(gi+1)*h//4, gj*w//4:(gj+1)*w//4]
                features.append(patch.mean(axis=(0, 1)))
        gray = img_arr.mean(axis=2)
        gx = np.diff(gray, axis=1)
        gy = np.diff(gray, axis=0)
        mag = np.sqrt(gx[:gray.shape[0]-1, :]**2 + gy[:, :gray.shape[1]-1]**2)
        edge_hist, _ = np.histogram(mag, bins=64, range=(0, 1))
        features.append(edge_hist.astype(np.float32))
        for gi in range(4):
            for gj in range(4):
                patch = gray[gi*h//4:(gi+1)*h//4, gj*w//4:(gj+1)*w//4]
                features.append(np.array([patch.var()]))

        clip_vector = np.concatenate(features)
        clip_dim = store.clip_embeddings.shape[1]
        if len(clip_vector) < clip_dim:
            clip_vector = np.pad(clip_vector, (0, clip_dim - len(clip_vector)))
        else:
            clip_vector = clip_vector[:clip_dim]

    # ── Structural filters ─────────────────────────────────
    struct_filters = {}
    if property_type:
        struct_filters['property_type'] = property_type
    if min_price is not None:
        struct_filters['min_price'] = min_price
    if max_price is not None:
        struct_filters['max_price'] = max_price
    if bedrooms is not None:
        struct_filters['bedrooms'] = bedrooms

    # ── Must have at least one modality ────────────────────
    if clip_vector is None and not text_query and not struct_filters:
        return jsonify({"success": False, "error": "Provide at least an image, text query, or structural filters"}), 400

    results, modalities = store.find_multimodal(
        clip_vector=clip_vector,
        text_query=text_query or None,
        struct_filters=struct_filters or None,
        top_k=top_k,
    )

    return jsonify({
        "success": True,
        "source": "multimodal_fusion",
        "model": "MLP Fusion + Multi-Modal Similarity",
        "modalities_used": modalities,
        "data": results,
        "total": len(results),
    })


IMAGES_DIR = os.path.join(NORM_DIR, "images")


@app.route("/images/<int:listing_id>.jpg")
def serve_image(listing_id):
    filename = f"{listing_id}.jpg"
    filepath = os.path.join(IMAGES_DIR, filename)
    if not os.path.isfile(filepath):
        return "", 404
    return send_from_directory(IMAGES_DIR, filename, mimetype="image/jpeg")


if __name__ == "__main__":
    print("\n🚀 Starting Python API server on http://localhost:5001")
    app.run(host="0.0.0.0", port=5001, debug=False)
