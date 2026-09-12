export const Random = {
  Between(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  Boolean(): boolean {
    return Math.random() >= 0.5;
  },

  Array<T>(array: T[]): T {
    return array[Math.floor(Math.random() * array.length)];
  },

  String(length: number): string {
    return Math.random()
      .toString(36)
      .substring(2, length + 2);
  },
};

export type Random = typeof Random;
