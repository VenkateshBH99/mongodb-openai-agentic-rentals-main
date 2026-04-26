import { readFileSync } from 'fs';
import { resolve } from 'path';

class RecommendationService {
  constructor() {
    this.recommendations = new Map(); // user_id -> [rental_id, ...]
    this.defaultRecs = [];
    this.loaded = false;
  }

  load() {
    if (this.loaded) return;

    const csvPath = resolve('model', 'recommendations_all_users_als.csv');
    const raw = readFileSync(csvPath, 'utf-8');
    const lines = raw.trim().split('\n');

    // Skip header: user_id,rec_1,rec_2,rec_3,rec_4,rec_5
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const userId = cols[0].replace('.0', '');
      const recs = cols.slice(1).map(id => parseInt(id, 10)).filter(id => !isNaN(id));

      if (userId) {
        this.recommendations.set(userId, recs);
      } else {
        // Row with empty user_id = default/fallback recommendations
        this.defaultRecs = recs;
      }
    }

    this.loaded = true;
    console.log(`✅ ALS recommendations loaded: ${this.recommendations.size} users, ${this.defaultRecs.length} default recs`);
  }

  getForUser(userId) {
    if (!this.loaded) this.load();

    const userKey = String(userId).replace('.0', '');
    const recs = this.recommendations.get(userKey);

    if (recs && recs.length > 0) {
      return { source: 'personalized', rentalIds: recs };
    }

    return { source: 'popular', rentalIds: this.defaultRecs };
  }

  hasUser(userId) {
    if (!this.loaded) this.load();
    return this.recommendations.has(String(userId).replace('.0', ''));
  }

  get totalUsers() {
    if (!this.loaded) this.load();
    return this.recommendations.size;
  }
}

export const recommendationService = new RecommendationService();
