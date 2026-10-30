export class DataBase {
  constructor(name, structure, version = 1) {
    if (!('indexedDB' in window)) {
      throw 'Отсутствует поддержка IndexedDB!';
    }

    this.name = name;

    this.structure = structure;

    this.version = version;
  }

  async init() {
    let request = indexedDB.open(this.name, this.version);

    request.addEventListener('upgradeneeded', async (event) => await this.upgrade(event));

    return new Promise((resolve, reject) => {
      request.addEventListener('success', (event) => {
        this.link = event.target.result;

        resolve();
      });

      request.addEventListener('error', reject);
    });
  }

  async add(name, value, key) {
    let transaction, table, result;

    transaction = this.link.transaction(name, 'readwrite');

    table = transaction.objectStore(name);

    result = table.put(value, key);

    return new Promise((resolve, reject) => {
      result.addEventListener('success', (event) => {
        resolve(event.target.result);
      });

      //transaction.addEventListener('complete',resolve);

      transaction.addEventListener('error', reject);
    });
  }

  async get(name, key) {
    let transaction, table, result;

    transaction = this.link.transaction(name, 'readonly');

    table = transaction.objectStore(name);

    result = table.get(key);

    return await new Promise((resolve, reject) => {
      result.addEventListener('success', (event) => {
        resolve(event.target.result);
      });

      result.addEventListener('error', reject);
    });
  }

  async getAll(name, key) {
    let transaction, table, result;

    transaction = this.link.transaction(name, 'readonly');

    table = transaction.objectStore(name);

    result = table.getAll(key);

    return new Promise((resolve, reject) => {
      result.addEventListener('success', (event) => {
        resolve(event.target.result);
      });

      result.addEventListener('error', reject);
    });
  }

  async getIndexAllSync(name, nameIndex, nameKey, callback) {
    let transaction, table, index, result;

    transaction = this.link.transaction(name, 'readonly');

    table = transaction.objectStore(name);

    index = table.index(nameIndex);

    result = index.getAll(nameKey);

    result.addEventListener('success', (event) => {
      callback(event.target.result);
    });

    result.addEventListener('error', (error) => {
      throw error;
    });

    // нужно работать с курсором для экономии памяти!!!, иначе при большом количестве информации её будет невозможно вытащить... будет ошибка при попытке получения большого массива
    //let request = books.openCursor(); // курсору нужно передать инфу о количестве штук, как я понимаю, по умолчанию он по 1 записи выдает
    // вызывается для каждой найденной курсором книги
    //request.onsuccess = function() {

    //let cursor = request.result;

    //if (cursor) {

    //let key = cursor.key; // ключ книги (поле id)

    //let value = cursor.value; // объект книги

    //console.log(key, value);

    //cursor.continue();

    //} else {

    //console.log("Книг больше нет");

    //}};
  }

  async getIndexAll(name, nameIndex, nameKey) {
    let transaction, table, index, result;

    transaction = this.link.transaction(name, 'readonly');

    table = transaction.objectStore(name);

    index = table.index(nameIndex);

    result = index.getAll(nameKey);

    return new Promise((resolve, reject) => {
      result.addEventListener('success', (event) => {
        resolve(event.target.result);
      });

      result.addEventListener('error', reject);
    });
  }

  async multi(object) {
    let requests = new Array();

    for (let table in object) {
      switch (object[table].method) {
        case 'get':
          requests.push(this.get(table, object[table].id));
          break;

        case 'getIndexAll':
          requests.push(this.getIndexAll(table, object[table].key, object[table].id));
          break;

        default:
          throw `Неизвестный метод ${object[table].method}`;
          break;
      }
    }

    let i = 0,
      result = await Promise.all(requests);

    for (let table in object) {
      object[table] = result[i];

      i++;
    }

    return object;
  }

  async deleteIndexAll(name, nameIndex, nameKey) {
    let keys = await this.getIndexAll(name, nameIndex, nameKey);

    if (!keys) {
      return;
    }

    for (let item of keys) {
      await this.delete(name, 'id');
    }

    return true;
  }

  async delete(name, key) {
    let transaction, table, result;

    transaction = this.link.transaction(name, 'readwrite');

    table = transaction.objectStore(name);

    result = table.delete(key);

    return new Promise((resolve, reject) => {
      result.addEventListener('success', (event) => {
        resolve(event);
      });

      result.addEventListener('error', reject);
    });
  }

  async clear(name) {
    let transaction = this.link.transaction(name, 'readwrite');

    return transaction.objectStore(name).clear();
  }

  async upgrade(event) {
    let db = event.target.result;

    if (!this.structure) {
      throw `Для создания базы-данных, необходима разметка структуры`;
    }

    let objectStore, table, index;

    for (objectStore of this.structure) {
      let find = false;

      try {
        for (let value of db.objectStoreNames) {
          // DOMStringList метод contains нельзя использовать, устарело.

          if (value == objectStore.name) {
            find = true;

            break;
          }
        }

        if (find) {
          if ('clear' in objectStore) {
            db.deleteObjectStore(objectStore.name);
          } else {
            continue;
          }
        }

        table = db.createObjectStore(objectStore.name, objectStore.options);

        if (objectStore.indexes) {
          for (index of objectStore.indexes) {
            table.createIndex(index.name, index.path);
          }
        }
      } catch (e) {
        console.log(`Ошибочка, которую мы скрыли: ${e} :ибо как проверить на наличие таблицы? ;>`);
      }
    }
  }
}
