/**
 * MJAPP — Aho-Corasick Multi-Pattern String Matching Algorithm
 *
 * Pure TypeScript implementation with no external dependencies.
 * Builds a trie with failure links for O(n + m + z) matching
 * (n = text length, m = total pattern length, z = total matches).
 */

export interface AcMatch {
  word: string;
  startIndex: number;
  endIndex: number; // exclusive (same as startIndex + word.length)
}

interface AcNode {
  /** Map of next char code -> child node index */
  next: Record<number, number>;
  /** Failure link — points to the longest proper suffix that is a prefix */
  fail: number;
  /** Output: list of pattern indices (as stored in `words`) that end at this node */
  output: number[];
}

export class AcAutomaton {
  private trie: AcNode[] = [];
  private words: string[] = [];
  private built = false;

  /**
   * Build the AC automaton from a list of sensitive words.
   * Call this once after loading words (or re-build after CRUD).
   */
  build(words: string[]): void {
    this.words = words;
    this.trie = [{ next: {}, fail: 0, output: [] }];

    // Step 1: Build the trie
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!word) continue;
      let nodeIndex = 0;
      for (let j = 0; j < word.length; j++) {
        const code = word.charCodeAt(j);
        if (this.trie[nodeIndex].next[code] === undefined) {
          this.trie[nodeIndex].next[code] = this.trie.length;
          this.trie.push({ next: {}, fail: 0, output: [] });
        }
        nodeIndex = this.trie[nodeIndex].next[code];
      }
      this.trie[nodeIndex].output.push(i);
    }

    // Step 2: Build failure links via BFS
    const queue: number[] = [];
    // Depth-1 nodes: fail = root (0)
    for (const code in this.trie[0].next) {
      const child = this.trie[0].next[code];
      this.trie[child].fail = 0;
      queue.push(child);
    }

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const codeStr in this.trie[current].next) {
        const code = Number(codeStr);
        const child = this.trie[current].next[code];

        // Follow failure links
        let fail = this.trie[current].fail;
        while (fail !== 0 && this.trie[fail].next[code] === undefined) {
          fail = this.trie[fail].fail;
        }
        if (this.trie[fail].next[code] !== undefined && this.trie[fail].next[code] !== child) {
          this.trie[child].fail = this.trie[fail].next[code];
        } else {
          this.trie[child].fail = 0;
        }

        // Merge output from failure node
        const failNode = this.trie[child].fail;
        if (failNode !== child && this.trie[failNode].output.length > 0) {
          this.trie[child].output = [
            ...this.trie[child].output,
            ...this.trie[failNode].output,
          ];
        }

        queue.push(child);
      }
    }

    this.built = true;
  }

  /**
   * Search text for all sensitive word matches.
   * Returns deduplicated matches (by word) in order of appearance.
   */
  search(text: string): AcMatch[] {
    if (!this.built || this.words.length === 0) return [];
    const results: AcMatch[] = [];
    let nodeIndex = 0;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      // Follow failure links until we find a match or hit root
      while (nodeIndex !== 0 && this.trie[nodeIndex].next[code] === undefined) {
        nodeIndex = this.trie[nodeIndex].fail;
      }

      if (this.trie[nodeIndex].next[code] !== undefined) {
        nodeIndex = this.trie[nodeIndex].next[code];
      }

      // Check for matches at this node
      if (this.trie[nodeIndex].output.length > 0) {
        for (const wordIdx of this.trie[nodeIndex].output) {
          const word = this.words[wordIdx];
          results.push({
            word,
            startIndex: i - word.length + 1,
            endIndex: i + 1,
          });
        }
      }
    }

    return results;
  }

  /**
   * Check if text contains any sensitive word.
   */
  containsSensitive(text: string): boolean {
    if (!this.built || this.words.length === 0) return false;
    let nodeIndex = 0;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);

      while (nodeIndex !== 0 && this.trie[nodeIndex].next[code] === undefined) {
        nodeIndex = this.trie[nodeIndex].fail;
      }

      if (this.trie[nodeIndex].next[code] !== undefined) {
        nodeIndex = this.trie[nodeIndex].next[code];
      }

      if (this.trie[nodeIndex].output.length > 0) {
        return true;
      }
    }

    return false;
  }

  /**
   * Replace all sensitive words in text with `replace` string.
   */
  filter(text: string, replace = '***'): string {
    if (!this.built || this.words.length === 0) return text;

    const matches = this.search(text);
    if (matches.length === 0) return text;

    // Sort by startIndex, then process segments
    matches.sort((a, b) => a.startIndex - b.startIndex);

    // Merge overlapping ranges
    const mergedRanges: { start: number; end: number }[] = [];
    for (const m of matches) {
      if (mergedRanges.length === 0) {
        mergedRanges.push({ start: m.startIndex, end: m.endIndex });
      } else {
        const last = mergedRanges[mergedRanges.length - 1];
        if (m.startIndex <= last.end) {
          last.end = Math.max(last.end, m.endIndex);
        } else {
          mergedRanges.push({ start: m.startIndex, end: m.endIndex });
        }
      }
    }

    // Build result
    let result = '';
    let lastEnd = 0;
    for (const range of mergedRanges) {
      result += text.slice(lastEnd, range.start);
      result += replace;
      lastEnd = range.end;
    }
    result += text.slice(lastEnd);

    return result;
  }
}
