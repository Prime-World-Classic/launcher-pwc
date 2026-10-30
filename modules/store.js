import { DataBase } from './database.js';

export class Store {
  static async init() {
    Store.db = new DataBase(
      'Storage',
      [
        {
          name: 'keys',
          options: { keyPath: 'identify' },
          indexes: [{ name: 'objects', path: 'object' }],
        },
      ],
      5,
    );

    return await Store.db.init();
  }

  static async get(object, key) {
    let result = await Store.db.get('keys', `${object}.${key}`);

    return result ? result.value : false;
  }

  static async getAll(object) {
    let keys = await Store.db.getIndexAll('keys', 'objects', object);

    if (!keys.length) {
      return keys;
    }

    let result = new Object();

    for (let item of keys) {
      result[item.key] = item.value;
    }

    return result;
  }

  constructor(object) {
    this.object = object;

    this.local = new Object();
  }

  async init(defaultObject) {
    let result, object;

    result = await Store.db.getIndexAll('keys', 'objects', this.object);

    if (result.length) {
      for (object of result) {
        this.local[object.key] = object.value;
      }
    } else {
      await this.set(defaultObject);
    }
  }

  get data() {
    return this.local;
  }

  async set(object) {
    for (let key in object) {
      await Store.db.add('keys', {
        identify: `${this.object}.${key}`,
        object: this.object,
        key: key,
        value: object[key],
      });

      this.local[key] = object[key];
    }
  }

  async getAll(object) {
    let keys = await Store.db.getIndexAll('keys', 'objects', object);

    if (!keys.length) {
      return false;
    }

    let result = new Object();

    for (let item of keys) {
      result[item.key] = item.value;
    }

    return result;
  }

  static async delete(object) {
    let keys = await Store.db.getIndexAll('keys', 'objects', object);

    if (!keys) {
      return;
    }

    for (let item of keys) {
      await Store.db.delete('keys', item.identify);
    }
  }
}
