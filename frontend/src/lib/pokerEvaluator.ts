/**
 * Poker Hand Evaluator
 * 
 * Evaluates the best 5-card poker hand from 7 cards (2 hole + 5 community).
 * Supports all standard Texas Hold'em hand rankings.
 * 
 * Hand Rankings (low to high):
 * 0 = High Card
 * 1 = Pair
 * 2 = Two Pair
 * 3 = Three of a Kind
 * 4 = Straight
 * 5 = Flush
 * 6 = Full House
 * 7 = Four of a Kind
 * 8 = Straight Flush
 * 9 = Royal Flush
 */

export interface HandResult {
  rank: number;        // 0-9
  rankName: string;    // Human-readable name
  bestCards: string[];  // The 5 cards forming the best hand
  score: number[];     // Composite score array for comparison [rank, ...tiebreakers]
}

// Card rank values: 2=2, 3=3, ..., T=10, J=11, Q=12, K=13, A=14
const RANK_VALUES: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
  '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
};

const RANK_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'
];

function parseCard(card: string): { rank: number; suit: string; raw: string } {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return { rank: RANK_VALUES[rank] || 0, suit, raw: card };
}

/**
 * Generate all C(n,5) combinations of 5 cards from n cards.
 */
function combinations5(cards: ReturnType<typeof parseCard>[]): ReturnType<typeof parseCard>[][] {
  const result: ReturnType<typeof parseCard>[][] = [];
  const n = cards.length;
  for (let i = 0; i < n - 4; i++) {
    for (let j = i + 1; j < n - 3; j++) {
      for (let k = j + 1; k < n - 2; k++) {
        for (let l = k + 1; l < n - 1; l++) {
          for (let m = l + 1; m < n; m++) {
            result.push([cards[i], cards[j], cards[k], cards[l], cards[m]]);
          }
        }
      }
    }
  }
  return result;
}

/**
 * Evaluate a 5-card hand and return its score array.
 * The score array allows lexicographic comparison: higher is better.
 */
function evaluate5(cards: ReturnType<typeof parseCard>[]): { rank: number; score: number[] } {
  const ranks = cards.map(c => c.rank).sort((a, b) => b - a); // descending
  const suits = cards.map(c => c.suit);

  // Count rank frequencies
  const freq: Record<number, number> = {};
  for (const r of ranks) {
    freq[r] = (freq[r] || 0) + 1;
  }

  const freqEntries = Object.entries(freq)
    .map(([r, c]) => ({ rank: Number(r), count: c }))
    .sort((a, b) => {
      // Sort by count desc, then rank desc
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

  // Check flush
  const isFlush = suits.every(s => s === suits[0]);

  // Check straight
  let isStraight = false;
  let straightHigh = 0;

  // Normal straight check (e.g. 10-J-Q-K-A)
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);
  if (uniqueRanks.length === 5 && uniqueRanks[0] - uniqueRanks[4] === 4) {
    isStraight = true;
    straightHigh = uniqueRanks[0];
  }

  // Ace-low straight (A-2-3-4-5, "the wheel")
  if (!isStraight && uniqueRanks.length === 5) {
    const sorted = [...uniqueRanks].sort((a, b) => a - b);
    if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 4 && sorted[3] === 5 && sorted[4] === 14) {
      isStraight = true;
      straightHigh = 5; // Ace counts as 1 in this context
    }
  }

  // Determine hand rank
  const counts = freqEntries.map(e => e.count);

  // Royal Flush / Straight Flush
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return { rank: 9, score: [9, 14] }; // Royal Flush
    }
    return { rank: 8, score: [8, straightHigh] }; // Straight Flush
  }

  // Four of a Kind
  if (counts[0] === 4) {
    const quadRank = freqEntries[0].rank;
    const kicker = freqEntries[1].rank;
    return { rank: 7, score: [7, quadRank, kicker] };
  }

  // Full House
  if (counts[0] === 3 && counts[1] === 2) {
    const tripRank = freqEntries[0].rank;
    const pairRank = freqEntries[1].rank;
    return { rank: 6, score: [6, tripRank, pairRank] };
  }

  // Flush
  if (isFlush) {
    return { rank: 5, score: [5, ...ranks] };
  }

  // Straight
  if (isStraight) {
    return { rank: 4, score: [4, straightHigh] };
  }

  // Three of a Kind
  if (counts[0] === 3) {
    const tripRank = freqEntries[0].rank;
    const kickers = freqEntries.slice(1).map(e => e.rank).sort((a, b) => b - a);
    return { rank: 3, score: [3, tripRank, ...kickers] };
  }

  // Two Pair
  if (counts[0] === 2 && counts[1] === 2) {
    const highPair = Math.max(freqEntries[0].rank, freqEntries[1].rank);
    const lowPair = Math.min(freqEntries[0].rank, freqEntries[1].rank);
    const kicker = freqEntries[2].rank;
    return { rank: 2, score: [2, highPair, lowPair, kicker] };
  }

  // Pair
  if (counts[0] === 2) {
    const pairRank = freqEntries[0].rank;
    const kickers = freqEntries.slice(1).map(e => e.rank).sort((a, b) => b - a);
    return { rank: 1, score: [1, pairRank, ...kickers] };
  }

  // High Card
  return { rank: 0, score: [0, ...ranks] };
}

/**
 * Compare two score arrays. Returns:
 *  > 0 if a wins
 *  < 0 if b wins
 *  = 0 if tie
 */
function compareScores(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/**
 * Evaluate the best possible 5-card hand from hole cards + community cards.
 */
export function evaluateHand(holeCards: string[], communityCards: string[]): HandResult {
  const allCards = [...holeCards, ...communityCards].map(parseCard);
  const combos = combinations5(allCards);

  let bestResult: { rank: number; score: number[] } | null = null;
  let bestCombo: ReturnType<typeof parseCard>[] | null = null;

  for (const combo of combos) {
    const result = evaluate5(combo);
    if (!bestResult || compareScores(result.score, bestResult.score) > 0) {
      bestResult = result;
      bestCombo = combo;
    }
  }

  if (!bestResult || !bestCombo) {
    return { rank: 0, rankName: 'High Card', bestCards: [], score: [0] };
  }

  return {
    rank: bestResult.rank,
    rankName: RANK_NAMES[bestResult.rank],
    bestCards: bestCombo.map(c => c.raw),
    score: bestResult.score
  };
}

/**
 * Determine the winner(s) among multiple players for a given set of community cards.
 * Returns the winning player IDs and all evaluation results.
 * 
 * @param playerHands - Map of playerId -> [card1, card2]
 * @param communityCards - The 5 community cards
 * @param eligiblePlayerIds - Optional subset of player IDs eligible for this pot
 * @returns winners (player IDs) and per-player results
 */
export function determineWinners(
  playerHands: Record<string, string[]>,
  communityCards: string[],
  eligiblePlayerIds?: string[]
): { winners: string[]; results: Record<string, HandResult> } {
  const results: Record<string, HandResult> = {};
  const playerIds = eligiblePlayerIds || Object.keys(playerHands);

  for (const pid of playerIds) {
    const holeCards = playerHands[pid];
    if (!holeCards || holeCards.length < 2) continue;
    results[pid] = evaluateHand(holeCards, communityCards);
  }

  // Find the best score
  let bestScore: number[] | null = null;
  for (const pid of Object.keys(results)) {
    if (!bestScore || compareScores(results[pid].score, bestScore) > 0) {
      bestScore = results[pid].score;
    }
  }

  if (!bestScore) {
    return { winners: [], results };
  }

  // All players with the best score are winners (split pot)
  const winners = Object.keys(results).filter(
    pid => compareScores(results[pid].score, bestScore!) === 0
  );

  return { winners, results };
}
