export const Random = {
  /**
   * Generates a random integer between min and max (inclusive).
   */
  Between(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
};

export type Random = typeof Random;
