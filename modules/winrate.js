export class Winrate {
  static icon(number) {
    if (number <= 25) {
      return 3;
    } else if (number <= 50) {
      return 2;
    } else {
      return 1;
    }
  }
}
