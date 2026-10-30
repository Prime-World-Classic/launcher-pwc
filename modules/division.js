export class Division {
  static list = {
    10: { name: 'Рядовой', icon: 3 },
    20: { name: 'Капрал', icon: 4 },
    30: { name: 'Сержант', icon: 5 },
    40: { name: 'Лейтенант', icon: 6 },
    50: { name: 'Капитан', icon: 7 },
    60: { name: 'Майор', icon: 8 },
    70: { name: 'Подполковник', icon: 9 },
    80: { name: 'Полковник', icon: 10 },
    90: { name: 'Генерал', icon: 11 },
    100: { name: 'Маршал', icon: 12 },
  };

  static get(id) {
    for (let key in Division.list) {
      if (id <= key) {
        return Division.list[key];
      }
    }

    return { name: 'Не определено', icon: 1 };
  }
}
